-- Multi-shipment support + open-PO edit honesty (confirmation_stale).
-- Extends Supplier Link payload with shipments + document metadata.

-- ============================================================
-- 1. Schema
-- ============================================================

alter table public.purchase_orders
  add column if not exists confirmation_stale boolean not null default false;

create table if not exists public.po_shipments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  tracking_number text,
  carrier text,
  estimated_arrival_date date,
  shipped_at timestamptz not null default now(),
  note text,
  created_by text not null default 'supplier', -- 'supplier' | 'merchant'
  created_at timestamptz not null default now()
);

create index if not exists po_shipments_po_id_idx
  on public.po_shipments (po_id, shipped_at desc);

create index if not exists po_shipments_workspace_id_idx
  on public.po_shipments (workspace_id);

create table if not exists public.po_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.po_shipments(id) on delete cascade,
  po_line_item_id uuid not null references public.po_line_items(id) on delete cascade,
  qty numeric(12,3) not null check (qty > 0),
  created_at timestamptz not null default now(),
  unique (shipment_id, po_line_item_id)
);

create index if not exists po_shipment_lines_shipment_id_idx
  on public.po_shipment_lines (shipment_id);

alter table public.po_shipments enable row level security;
alter table public.po_shipment_lines enable row level security;

drop policy if exists "po_shipments member access" on public.po_shipments;
create policy "po_shipments member access"
  on public.po_shipments for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "po_shipment_lines member access" on public.po_shipment_lines;
create policy "po_shipment_lines member access"
  on public.po_shipment_lines for all to authenticated
  using (
    exists (
      select 1 from public.po_shipments s
      where s.id = po_shipment_lines.shipment_id
        and public.is_workspace_member(s.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.po_shipments s
      where s.id = po_shipment_lines.shipment_id
        and public.is_workspace_member(s.workspace_id)
    )
  );

-- Backfill one shipment from the latest shipped timeline event per PO
insert into public.po_shipments (
  workspace_id,
  po_id,
  tracking_number,
  carrier,
  estimated_arrival_date,
  shipped_at,
  created_by
)
select
  po.workspace_id,
  po.id,
  nullif(trim(e.metadata ->> 'tracking_number'), ''),
  nullif(trim(e.metadata ->> 'carrier'), ''),
  po.estimated_arrival_date,
  e.occurred_at,
  coalesce(nullif(e.actor, ''), 'supplier')
from public.purchase_orders po
join lateral (
  select *
  from public.po_timeline_events ev
  where ev.po_id = po.id
    and ev.event_type = 'shipped'
  order by ev.occurred_at desc
  limit 1
) e on true
where not exists (
  select 1 from public.po_shipments s where s.po_id = po.id
);

-- ============================================================
-- 2. Supplier Link: include shipments + documents
-- ============================================================

create or replace function public.supplier_link_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_supplier public.suppliers%rowtype;
  v_workspace public.workspaces%rowtype;
  v_lines jsonb;
  v_proposals jsonb;
  v_shipments jsonb;
  v_documents jsonb;
begin
  v_po := public.supplier_link_load_po(p_token);
  select * into v_supplier from public.suppliers where id = v_po.supplier_id;
  select * into v_workspace from public.workspaces where id = v_po.workspace_id;

  select coalesce(jsonb_agg(line_obj order by sort_order), '[]'::jsonb)
  into v_lines
  from (
    select jsonb_build_object(
      'id', li.id,
      'description', li.description,
      'sku', li.sku,
      'qty', li.qty,
      'unit_cost', li.unit_cost,
      'line_total', li.line_total,
      'is_free_text', li.is_free_text,
      'sort_order', li.sort_order
    ) as line_obj,
    li.sort_order
    from public.po_line_items li
    where li.po_id = v_po.id
  ) lines;

  select coalesce(jsonb_agg(p_obj order by created_at), '[]'::jsonb)
  into v_proposals
  from (
    select jsonb_build_object(
      'id', pr.id,
      'po_line_item_id', pr.po_line_item_id,
      'proposed_qty', pr.proposed_qty,
      'proposed_unit_cost', pr.proposed_unit_cost,
      'note', pr.note,
      'status', pr.status,
      'created_at', pr.created_at
    ) as p_obj,
    pr.created_at
    from public.po_line_item_proposals pr
    join public.po_line_items li on li.id = pr.po_line_item_id
    where li.po_id = v_po.id
      and pr.status = 'pending'
  ) props;

  select coalesce(jsonb_agg(s_obj order by shipped_at desc), '[]'::jsonb)
  into v_shipments
  from (
    select jsonb_build_object(
      'id', s.id,
      'tracking_number', s.tracking_number,
      'carrier', s.carrier,
      'estimated_arrival_date', s.estimated_arrival_date,
      'shipped_at', s.shipped_at,
      'note', s.note,
      'created_by', s.created_by,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'po_line_item_id', sl.po_line_item_id,
          'description', li.description,
          'qty', sl.qty
        ))
        from public.po_shipment_lines sl
        join public.po_line_items li on li.id = sl.po_line_item_id
        where sl.shipment_id = s.id
      ), '[]'::jsonb)
    ) as s_obj,
    s.shipped_at
    from public.po_shipments s
    where s.po_id = v_po.id
  ) ships;

  select coalesce(jsonb_agg(d_obj order by created_at desc), '[]'::jsonb)
  into v_documents
  from (
    select jsonb_build_object(
      'id', d.id,
      'file_name', d.file_name,
      'file_type', d.file_type,
      'kind', coalesce(d.kind, 'upload'),
      'created_at', d.created_at
    ) as d_obj,
    d.created_at
    from public.po_documents d
    where d.po_id = v_po.id
  ) docs;

  return jsonb_build_object(
    'po', jsonb_build_object(
      'id', v_po.id,
      'po_number', v_po.po_number,
      'status', v_po.status,
      'notes', v_po.notes,
      'subtotal', v_po.subtotal,
      'total', v_po.total,
      'currency', v_po.currency,
      'requested_ship_date', v_po.requested_ship_date,
      'confirmed_ship_date', v_po.confirmed_ship_date,
      'estimated_arrival_date', v_po.estimated_arrival_date,
      'confirmation_stale', v_po.confirmation_stale,
      'created_at', v_po.created_at
    ),
    'supplier', jsonb_build_object('name', v_supplier.name, 'email', v_supplier.email),
    'workspace', jsonb_build_object('name', v_workspace.name),
    'line_items', v_lines,
    'pending_proposals', v_proposals,
    'shipments', v_shipments,
    'documents', v_documents
  );
end;
$$;

-- ============================================================
-- 3. Add shipment (multi) — Supplier Link
-- ============================================================

create or replace function public.supplier_link_add_shipment(
  p_token text,
  p_tracking text default null,
  p_carrier text default null,
  p_estimated_arrival_date date default null,
  p_note text default null,
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_shipment_id uuid;
  v_line jsonb;
  v_line_id uuid;
  v_qty numeric;
  v_has_lines boolean := false;
begin
  v_po := public.supplier_link_load_po(p_token);

  if v_po.status = 'rejected' then
    raise exception 'invalid_status';
  end if;
  if v_po.status in ('closed', 'received') then
    raise exception 'invalid_status';
  end if;
  if v_po.status not in (
    'confirmed', 'production', 'viewed', 'sent',
    'shipped', 'in_transit', 'partially_received'
  ) then
    raise exception 'invalid_status';
  end if;

  insert into public.po_shipments (
    workspace_id,
    po_id,
    tracking_number,
    carrier,
    estimated_arrival_date,
    note,
    created_by
  ) values (
    v_po.workspace_id,
    v_po.id,
    nullif(trim(coalesce(p_tracking, '')), ''),
    nullif(trim(coalesce(p_carrier, '')), ''),
    p_estimated_arrival_date,
    nullif(trim(coalesce(p_note, '')), ''),
    'supplier'
  )
  returning id into v_shipment_id;

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      v_line_id := nullif(v_line ->> 'po_line_item_id', '')::uuid;
      v_qty := nullif(v_line ->> 'qty', '')::numeric;
      if v_line_id is null or v_qty is null or v_qty <= 0 then
        continue;
      end if;
      if not exists (
        select 1 from public.po_line_items li
        where li.id = v_line_id and li.po_id = v_po.id
      ) then
        raise exception 'invalid_line';
      end if;
      insert into public.po_shipment_lines (shipment_id, po_line_item_id, qty)
      values (v_shipment_id, v_line_id, v_qty);
      v_has_lines := true;
    end loop;
  end if;

  update public.purchase_orders
    set status = case
          when status in ('partially_received', 'received', 'closed') then status
          else 'shipped'
        end,
        estimated_arrival_date = coalesce(p_estimated_arrival_date, estimated_arrival_date),
        updated_at = now()
    where id = v_po.id;

  insert into public.po_timeline_events (po_id, event_type, actor, metadata)
  values (
    v_po.id,
    'shipped',
    'supplier',
    jsonb_build_object(
      'tracking_number', nullif(trim(coalesce(p_tracking, '')), ''),
      'carrier', nullif(trim(coalesce(p_carrier, '')), ''),
      'estimated_arrival_date', p_estimated_arrival_date,
      'shipment_id', v_shipment_id,
      'has_line_allocations', v_has_lines
    )
  );

  return public.supplier_link_get(p_token);
end;
$$;

-- Keep legacy ship RPC as a thin wrapper that adds a shipment
create or replace function public.supplier_link_ship(
  p_token text,
  p_tracking text default null,
  p_carrier text default null,
  p_estimated_arrival_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.supplier_link_add_shipment(
    p_token,
    p_tracking,
    p_carrier,
    p_estimated_arrival_date,
    null,
    '[]'::jsonb
  );
end;
$$;

-- Also keep 3-arg overload for older clients
create or replace function public.supplier_link_ship(
  p_token text,
  p_tracking text,
  p_carrier text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.supplier_link_add_shipment(
    p_token, p_tracking, p_carrier, null, null, '[]'::jsonb
  );
end;
$$;

-- Re-confirm clears confirmation_stale (preserves production status)
create or replace function public.supplier_link_confirm(p_token text, p_ship_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  v_po := public.supplier_link_load_po(p_token);

  if v_po.confirmation_stale then
    if v_po.status not in ('sent', 'viewed', 'confirmed', 'production') then
      raise exception 'invalid_status';
    end if;
  elsif v_po.status not in ('sent', 'viewed', 'confirmed') then
    raise exception 'invalid_status';
  end if;

  if v_po.status = 'sent' then
    insert into public.po_timeline_events (po_id, event_type, actor, metadata)
    values (v_po.id, 'viewed', 'system', '{"source":"confirm_implies_view"}'::jsonb);
  end if;

  update public.purchase_orders
    set status = case
          when status in ('confirmed', 'production') then status
          else 'confirmed'
        end,
        confirmed_ship_date = p_ship_date,
        requested_ship_date = coalesce(p_ship_date, requested_ship_date),
        confirmation_stale = false,
        updated_at = now()
    where id = v_po.id;

  insert into public.po_timeline_events (po_id, event_type, actor, metadata)
  values (
    v_po.id,
    'confirmed',
    'supplier',
    jsonb_build_object(
      'ship_date', p_ship_date,
      'reconfirm_after_edit', v_po.confirmation_stale
    )
  );

  return public.supplier_link_get(p_token);
end;
$$;

grant execute on function public.supplier_link_add_shipment(text, text, text, date, text, jsonb)
  to anon, authenticated;
grant execute on function public.supplier_link_ship(text, text, text, date)
  to anon, authenticated;
grant execute on function public.supplier_link_ship(text, text, text)
  to anon, authenticated;
