-- Phase 2 exploratory: demo flag + computed supplier scorecards
alter table workspaces
  add column if not exists is_demo boolean not null default false;

comment on column workspaces.is_demo is
  'Exploratory/demo workspace. Analytics may render against seeded history; never treat as real merchant evidence.';

-- Scorecards are computed, not stored. security_invoker so RLS on underlying tables applies.
-- Aggregation is fixed vs the build-plan sketch so line/receipt joins do not inflate completed_pos.
create or replace view supplier_scorecards
with (security_invoker = true) as
with closed_pos as (
  select
    po.id,
    po.supplier_id,
    po.workspace_id,
    po.requested_ship_date,
    po.confirmed_ship_date,
    (
      select min(e.occurred_at)
      from po_timeline_events e
      where e.po_id = po.id and e.event_type = 'sent'
    ) as sent_at,
    (
      select min(e.occurred_at)
      from po_timeline_events e
      where e.po_id = po.id and e.event_type = 'confirmed'
    ) as confirmed_at,
    (
      select min(e.occurred_at)
      from po_timeline_events e
      where e.po_id = po.id and e.event_type = 'shipped'
    ) as shipped_at,
    (
      select min(e.occurred_at)
      from po_timeline_events e
      where e.po_id = po.id and e.event_type = 'received'
    ) as received_at
  from purchase_orders po
  where po.status = 'closed'
),
po_fill as (
  select
    pli.po_id,
    sum(pli.qty)::double precision as ordered_qty,
    coalesce(sum(recv.qty_received), 0)::double precision as received_qty
  from po_line_items pli
  left join (
    select
      rli.po_line_item_id,
      sum(rli.qty_received)::integer as qty_received
    from receipt_line_items rli
    group by rli.po_line_item_id
  ) recv on recv.po_line_item_id = pli.id
  group by pli.po_id
)
select
  s.id as supplier_id,
  s.workspace_id,
  count(cp.id)::integer as completed_pos,
  avg(
    extract(epoch from (cp.confirmed_at - cp.sent_at)) / 86400.0
  ) as avg_confirmation_days,
  avg(
    extract(epoch from (cp.received_at - cp.requested_ship_date::timestamptz)) / 86400.0
  ) as avg_lead_time_variance_days,
  avg(
    case
      when cp.requested_ship_date is null then null
      when coalesce(cp.confirmed_ship_date, (cp.shipped_at at time zone 'utc')::date)
        <= cp.requested_ship_date then 1.0
      else 0.0
    end
  ) as on_time_pct,
  avg(
    case
      when pf.ordered_qty > 0 then least(pf.received_qty / pf.ordered_qty, 1.0)
      else null
    end
  ) as fill_rate
from suppliers s
left join closed_pos cp on cp.supplier_id = s.id
left join po_fill pf on pf.po_id = cp.id
group by s.id, s.workspace_id;

grant select on supplier_scorecards to authenticated;
grant select on supplier_scorecards to service_role;
