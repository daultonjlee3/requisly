-- Block Supplier Link mutations once a PO is merchant-cancelled.

create or replace function public.supplier_link_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  v_po := public.supplier_link_load_po(p_token);
  if v_po.status in ('rejected', 'cancelled') then
    return public.supplier_link_get(p_token);
  end if;
  if v_po.status = 'sent' then
    update public.purchase_orders set status = 'viewed' where id = v_po.id;
    insert into public.po_timeline_events (po_id, event_type, actor, metadata)
    values (v_po.id, 'viewed', 'system', '{"source":"supplier_link_open"}'::jsonb);
  end if;
  return public.supplier_link_get(p_token);
end;
$$;

create or replace function public.supplier_link_reject(p_token text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  v_po := public.supplier_link_load_po(p_token);
  if v_po.status = 'rejected' then raise exception 'po_rejected'; end if;
  if v_po.status = 'cancelled' then raise exception 'po_cancelled'; end if;
  if v_po.status not in ('sent', 'viewed') then raise exception 'invalid_status'; end if;
  if v_po.status = 'sent' then
    insert into public.po_timeline_events (po_id, event_type, actor, metadata)
    values (v_po.id, 'viewed', 'system', '{"source":"reject_implies_view"}'::jsonb);
  end if;
  update public.purchase_orders set status = 'rejected' where id = v_po.id;
  insert into public.po_timeline_events (po_id, event_type, actor, metadata)
  values (
    v_po.id, 'rejected', 'supplier',
    jsonb_build_object('note', nullif(trim(p_note), ''))
  );
  return public.supplier_link_get(p_token);
end;
$$;

create or replace function public.supplier_link_propose_changes(p_token text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_change jsonb;
  v_line_id uuid;
  v_qty integer;
  v_cost numeric(12,2);
  v_note text;
  v_belongs boolean;
begin
  v_po := public.supplier_link_load_po(p_token);
  if v_po.status = 'rejected' then raise exception 'po_rejected'; end if;
  if v_po.status = 'cancelled' then raise exception 'po_cancelled'; end if;
  if v_po.status not in ('sent', 'viewed') then raise exception 'invalid_status'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'invalid_changes';
  end if;

  for v_change in select * from jsonb_array_elements(p_changes)
  loop
    v_line_id := (v_change->>'po_line_item_id')::uuid;
    v_qty := nullif(v_change->>'proposed_qty', '')::integer;
    v_cost := nullif(v_change->>'proposed_unit_cost', '')::numeric;
    v_note := nullif(trim(v_change->>'note'), '');

    if v_line_id is null then raise exception 'invalid_line'; end if;
    if v_qty is null and v_cost is null then raise exception 'empty_proposal'; end if;

    select exists(
      select 1 from public.po_line_items li
      where li.id = v_line_id and li.po_id = v_po.id
    ) into v_belongs;
    if not v_belongs then raise exception 'invalid_line'; end if;

    update public.po_line_item_proposals
      set status = 'rejected', resolved_at = now()
      where po_line_item_id = v_line_id and status = 'pending';

    insert into public.po_line_item_proposals (
      po_line_item_id, proposed_qty, proposed_unit_cost, note, status, proposed_by
    ) values (
      v_line_id, v_qty, v_cost, v_note, 'pending', 'supplier'
    );
  end loop;

  return public.supplier_link_get(p_token);
end;
$$;

create or replace function public.supplier_link_confirm(p_token text, p_ship_date date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  v_po := public.supplier_link_load_po(p_token);

  if v_po.status in ('rejected', 'cancelled', 'closed', 'received') then
    raise exception 'invalid_status';
  end if;

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
set search_path to 'public'
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
  if v_po.status in ('rejected', 'cancelled') then raise exception 'invalid_status'; end if;
  if v_po.status in ('closed', 'received') then raise exception 'invalid_status'; end if;
  if v_po.status not in (
    'confirmed', 'production', 'viewed', 'sent',
    'shipped', 'in_transit', 'partially_received'
  ) then raise exception 'invalid_status'; end if;

  insert into public.po_shipments (
    workspace_id, po_id, tracking_number, carrier,
    estimated_arrival_date, note, created_by
  ) values (
    v_po.workspace_id, v_po.id,
    nullif(trim(coalesce(p_tracking, '')), ''),
    nullif(trim(coalesce(p_carrier, '')), ''),
    p_estimated_arrival_date,
    nullif(trim(coalesce(p_note, '')), ''),
    'supplier'
  ) returning id into v_shipment_id;

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      v_line_id := nullif(v_line ->> 'po_line_item_id', '')::uuid;
      v_qty := nullif(v_line ->> 'qty', '')::numeric;
      if v_line_id is null or v_qty is null or v_qty <= 0 then continue; end if;
      if not exists (
        select 1 from public.po_line_items li
        where li.id = v_line_id and li.po_id = v_po.id
      ) then raise exception 'invalid_line'; end if;
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
    v_po.id, 'shipped', 'supplier',
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
