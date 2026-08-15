-- Reorder points with real confirmed lead time (INVENTORY-EXPANSION-PLAN §2).
-- Velocity from shopify_orders; lead time from po_timeline_events (sent→shipped, closed POs).
-- Synthetic Shopify test orders are flagged — never silent with real customer demand.

alter table public.shopify_orders
  add column if not exists tags text[] not null default '{}',
  add column if not exists is_synthetic_test boolean not null default false,
  add column if not exists note text;

comment on column public.shopify_orders.is_synthetic_test is
  'True when order tagged requisly_synthetic_test (Bogus/QA). Confirms mechanism only — NOT real customer-driven velocity.';

create table if not exists public.reorder_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  safety_stock_units integer not null default 0,
  -- Merchant-entered estimate used ONLY when no confirmed closed-PO lead history exists.
  fallback_supplier_stated_days numeric(8,2),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, product_variant_id)
);

create index if not exists reorder_settings_workspace_idx
  on public.reorder_settings (workspace_id);

alter table public.reorder_settings enable row level security;

drop policy if exists "reorder_settings member select" on public.reorder_settings;
create policy "reorder_settings member select"
  on public.reorder_settings for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "reorder_settings member write" on public.reorder_settings;
create policy "reorder_settings member write"
  on public.reorder_settings for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.reorder_settings to authenticated;
grant all on public.reorder_settings to service_role;

-- Daily units sold per variant (from synced Orders). Synthetic days included but flagged upstream.
create or replace view public.product_consumption_summary as
select
  li.workspace_id,
  li.product_variant_id,
  (o.processed_at at time zone 'utc')::date as period_date,
  sum(li.quantity)::numeric as units_per_day,
  bool_or(coalesce(o.is_synthetic_test, false)) as includes_synthetic_test
from public.shopify_order_line_items li
join public.shopify_orders o on o.id = li.order_id
where li.product_variant_id is not null
  and o.processed_at is not null
group by 1, 2, 3;

grant select on public.product_consumption_summary to authenticated;
grant select on public.product_consumption_summary to service_role;

create or replace view public.reorder_recommendations as
with velocity as (
  select
    pcs.workspace_id,
    pcs.product_variant_id,
    avg(pcs.units_per_day)::numeric as units_per_day,
    bool_or(pcs.includes_synthetic_test) as velocity_includes_synthetic
  from public.product_consumption_summary pcs
  where pcs.period_date > (now() at time zone 'utc')::date - 30
  group by 1, 2
),
on_hand as (
  select
    product_variant_id,
    sum(coalesce(on_hand, 0))::integer as on_hand
  from public.inventory_levels
  group by product_variant_id
),
lead_times as (
  select
    pv.workspace_id,
    pv.id as product_variant_id,
    avg(extract(epoch from (ship.occurred_at - sent.occurred_at)) / 86400.0)
      filter (where ship.occurred_at is not null and sent.occurred_at is not null)
      as avg_confirmed_lead_days,
    count(*) filter (where ship.occurred_at is not null and sent.occurred_at is not null)
      as confirmed_po_count
  from public.product_variants pv
  join public.supplier_products sp on sp.product_variant_id = pv.id
  join public.po_line_items pli on pli.supplier_product_id = sp.id
  join public.purchase_orders po on po.id = pli.po_id and po.status = 'closed'
  left join lateral (
    select e.occurred_at
    from public.po_timeline_events e
    where e.po_id = po.id and e.event_type = 'sent'
    order by e.occurred_at asc
    limit 1
  ) sent on true
  left join lateral (
    select e.occurred_at
    from public.po_timeline_events e
    where e.po_id = po.id and e.event_type = 'shipped'
    order by e.occurred_at asc
    limit 1
  ) ship on true
  group by pv.workspace_id, pv.id
)
select
  rs.id as reorder_setting_id,
  rs.workspace_id,
  pv.id as product_variant_id,
  pv.title,
  pv.sku,
  coalesce(oh.on_hand, 0) as on_hand,
  coalesce(v.units_per_day, 0) as units_per_day,
  coalesce(v.velocity_includes_synthetic, false) as velocity_is_synthetic_test,
  case
    when coalesce(lt.confirmed_po_count, 0) > 0 then lt.avg_confirmed_lead_days
    else rs.fallback_supplier_stated_days
  end as lead_time_days,
  case
    when coalesce(lt.confirmed_po_count, 0) > 0 then 'confirmed'::text
    else 'fallback_estimate'::text
  end as lead_time_source,
  coalesce(lt.confirmed_po_count, 0) as confirmed_lead_po_count,
  rs.fallback_supplier_stated_days,
  rs.safety_stock_units,
  (
    coalesce(v.units_per_day, 0)
      * coalesce(
          case when coalesce(lt.confirmed_po_count, 0) > 0 then lt.avg_confirmed_lead_days
               else rs.fallback_supplier_stated_days end,
          0
        )
    + rs.safety_stock_units
  ) as reorder_point,
  case
    when coalesce(oh.on_hand, 0) <= (
      coalesce(v.units_per_day, 0)
        * coalesce(
            case when coalesce(lt.confirmed_po_count, 0) > 0 then lt.avg_confirmed_lead_days
                 else rs.fallback_supplier_stated_days end,
            0
          )
      + rs.safety_stock_units
    ) then true
    else false
  end as needs_reorder
from public.reorder_settings rs
join public.product_variants pv on pv.id = rs.product_variant_id
left join on_hand oh on oh.product_variant_id = pv.id
left join velocity v
  on v.product_variant_id = pv.id and v.workspace_id = rs.workspace_id
left join lead_times lt
  on lt.product_variant_id = pv.id and lt.workspace_id = rs.workspace_id
where rs.enabled = true;

grant select on public.reorder_recommendations to authenticated;
grant select on public.reorder_recommendations to service_role;

-- Inventory agent (separate from existing reorder-cadence agent)
alter table public.ai_insights drop constraint if exists ai_insights_agent_check;
alter table public.ai_insights
  add constraint ai_insights_agent_check
  check (
    agent = any (
      array[
        'operations'::text,
        'supplier'::text,
        'procurement'::text,
        'margin'::text,
        'quality'::text,
        'reorder'::text,
        'inventory'::text,
        'documentation'::text,
        'hygiene'::text,
        'reports'::text
      ]
    )
  );
