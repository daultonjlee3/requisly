-- Blanket POs: a committed qty/value with a supplier over a period.
-- Real POs draw down remaining; one draw-down row per PO (idempotent).

create table if not exists public.blanket_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  blanket_number text not null,
  title text not null,
  start_date date,
  end_date date,
  committed_qty numeric(14, 4),
  committed_value numeric(14, 2),
  remaining_qty numeric(14, 4),
  remaining_value numeric(14, 2),
  status text not null default 'active'
    check (status in ('active', 'closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, blanket_number),
  check (committed_qty is not null or committed_value is not null),
  check (committed_qty is null or committed_qty > 0),
  check (committed_value is null or committed_value > 0),
  check ((committed_qty is null) = (remaining_qty is null)),
  check ((committed_value is null) = (remaining_value is null)),
  check (remaining_qty is null or remaining_qty >= 0),
  check (remaining_value is null or remaining_value >= 0),
  check (start_date is null or end_date is null or end_date >= start_date)
);

comment on table public.blanket_purchase_orders is
  'Supplier commitment of qty and/or value over a period. Real POs draw down remaining.';
comment on column public.blanket_purchase_orders.remaining_qty is
  'Qty still available. Null when this blanket does not track quantity.';
comment on column public.blanket_purchase_orders.remaining_value is
  'Value still available. Null when this blanket does not track value.';

create index if not exists blanket_pos_workspace_idx
  on public.blanket_purchase_orders (workspace_id);
create index if not exists blanket_pos_supplier_idx
  on public.blanket_purchase_orders (workspace_id, supplier_id);
create index if not exists blanket_pos_status_idx
  on public.blanket_purchase_orders (workspace_id, status);

drop trigger if exists blanket_purchase_orders_touch_updated_at
  on public.blanket_purchase_orders;
create trigger blanket_purchase_orders_touch_updated_at
  before update on public.blanket_purchase_orders
  for each row execute function public.touch_updated_at();

alter table public.blanket_purchase_orders enable row level security;

drop policy if exists "blanket_purchase_orders member access"
  on public.blanket_purchase_orders;
create policy "blanket_purchase_orders member access"
  on public.blanket_purchase_orders for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

alter table public.purchase_orders
  add column if not exists blanket_po_id uuid
    references public.blanket_purchase_orders(id) on delete set null;

comment on column public.purchase_orders.blanket_po_id is
  'Optional blanket this PO draws down against. Set at create; remaining adjusts on edit/cancel.';

create index if not exists purchase_orders_blanket_po_idx
  on public.purchase_orders (workspace_id, blanket_po_id)
  where blanket_po_id is not null;

create table if not exists public.blanket_po_drawdowns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  blanket_po_id uuid not null
    references public.blanket_purchase_orders(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  qty_drawn numeric(14, 4) not null default 0,
  value_drawn numeric(14, 2) not null default 0,
  remaining_qty_after numeric(14, 4),
  remaining_value_after numeric(14, 2),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (po_id),
  check (qty_drawn >= 0),
  check (value_drawn >= 0)
);

comment on table public.blanket_po_drawdowns is
  'One current draw-down per PO. Cancel reverses remaining and sets reversed_at; the row stays for history.';

create index if not exists blanket_po_drawdowns_blanket_idx
  on public.blanket_po_drawdowns (blanket_po_id, created_at);

drop trigger if exists blanket_po_drawdowns_touch_updated_at
  on public.blanket_po_drawdowns;
create trigger blanket_po_drawdowns_touch_updated_at
  before update on public.blanket_po_drawdowns
  for each row execute function public.touch_updated_at();

alter table public.blanket_po_drawdowns enable row level security;

drop policy if exists "blanket_po_drawdowns member access"
  on public.blanket_po_drawdowns;
create policy "blanket_po_drawdowns member access"
  on public.blanket_po_drawdowns for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create or replace function public.apply_blanket_po_drawdown(
  p_workspace_id uuid,
  p_blanket_id uuid,
  p_po_id uuid,
  p_qty numeric,
  p_value numeric
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_blanket public.blanket_purchase_orders%rowtype;
  v_prev public.blanket_po_drawdowns%rowtype;
  v_today date := (timezone('utc', now()))::date;
  v_qty numeric := coalesce(p_qty, 0);
  v_value numeric := coalesce(p_value, 0);
  v_prev_qty numeric := 0;
  v_prev_value numeric := 0;
  v_next_qty numeric;
  v_next_value numeric;
begin
  if v_qty < 0 or v_value < 0 then
    raise exception 'Draw-down quantity and value must be zero or more';
  end if;

  select * into v_blanket
  from public.blanket_purchase_orders
  where id = p_blanket_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Blanket PO not found';
  end if;

  if v_blanket.status <> 'active' then
    raise exception 'Blanket PO % is closed', v_blanket.blanket_number;
  end if;

  if v_blanket.start_date is not null and v_blanket.start_date > v_today then
    raise exception 'Blanket PO % has not started', v_blanket.blanket_number;
  end if;

  if v_blanket.end_date is not null and v_blanket.end_date < v_today then
    raise exception 'Blanket PO % has expired', v_blanket.blanket_number;
  end if;

  select * into v_prev
  from public.blanket_po_drawdowns
  where po_id = p_po_id;

  if found then
    if v_prev.blanket_po_id <> p_blanket_id then
      raise exception 'This PO already draws down against a different blanket';
    end if;
    if v_prev.reversed_at is null then
      v_prev_qty := v_prev.qty_drawn;
      v_prev_value := v_prev.value_drawn;
    end if;
  end if;

  v_next_qty := v_blanket.remaining_qty;
  v_next_value := v_blanket.remaining_value;

  if v_blanket.remaining_qty is not null then
    v_next_qty := v_blanket.remaining_qty + v_prev_qty - v_qty;
    if v_next_qty < 0 then
      raise exception
        'This PO would exceed remaining quantity on % (% left)',
        v_blanket.blanket_number,
        trim(to_char(v_blanket.remaining_qty + v_prev_qty, 'FM999999999990.####'));
    end if;
  end if;

  if v_blanket.remaining_value is not null then
    v_next_value := v_blanket.remaining_value + v_prev_value - v_value;
    if v_next_value < 0 then
      raise exception
        'This PO would exceed remaining value on % ($% left)',
        v_blanket.blanket_number,
        trim(to_char(v_blanket.remaining_value + v_prev_value, 'FM999999999990.00'));
    end if;
  end if;

  update public.blanket_purchase_orders
  set
    remaining_qty = v_next_qty,
    remaining_value = v_next_value
  where id = p_blanket_id;

  insert into public.blanket_po_drawdowns (
    workspace_id,
    blanket_po_id,
    po_id,
    qty_drawn,
    value_drawn,
    remaining_qty_after,
    remaining_value_after,
    reversed_at
  )
  values (
    p_workspace_id,
    p_blanket_id,
    p_po_id,
    v_qty,
    v_value,
    v_next_qty,
    v_next_value,
    null
  )
  on conflict (po_id) do update set
    qty_drawn = excluded.qty_drawn,
    value_drawn = excluded.value_drawn,
    remaining_qty_after = excluded.remaining_qty_after,
    remaining_value_after = excluded.remaining_value_after,
    reversed_at = null;

  return jsonb_build_object(
    'remaining_qty', v_next_qty,
    'remaining_value', v_next_value
  );
end;
$$;

create or replace function public.release_blanket_po_drawdown(
  p_workspace_id uuid,
  p_po_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prev public.blanket_po_drawdowns%rowtype;
  v_blanket public.blanket_purchase_orders%rowtype;
  v_next_qty numeric;
  v_next_value numeric;
begin
  select * into v_prev
  from public.blanket_po_drawdowns
  where po_id = p_po_id
    and workspace_id = p_workspace_id
  for update;

  if not found or v_prev.reversed_at is not null then
    return jsonb_build_object('released', false);
  end if;

  select * into v_blanket
  from public.blanket_purchase_orders
  where id = v_prev.blanket_po_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    update public.blanket_po_drawdowns
    set reversed_at = now()
    where id = v_prev.id;
    return jsonb_build_object('released', true);
  end if;

  v_next_qty := v_blanket.remaining_qty;
  v_next_value := v_blanket.remaining_value;
  if v_blanket.remaining_qty is not null then
    v_next_qty := v_blanket.remaining_qty + v_prev.qty_drawn;
  end if;
  if v_blanket.remaining_value is not null then
    v_next_value := v_blanket.remaining_value + v_prev.value_drawn;
  end if;

  update public.blanket_purchase_orders
  set
    remaining_qty = v_next_qty,
    remaining_value = v_next_value
  where id = v_blanket.id;

  update public.blanket_po_drawdowns
  set
    reversed_at = now(),
    remaining_qty_after = v_next_qty,
    remaining_value_after = v_next_value
  where id = v_prev.id;

  return jsonb_build_object(
    'released', true,
    'remaining_qty', v_next_qty,
    'remaining_value', v_next_value
  );
end;
$$;

revoke all on function public.apply_blanket_po_drawdown(uuid, uuid, uuid, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.release_blanket_po_drawdown(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_blanket_po_drawdown(uuid, uuid, uuid, numeric, numeric)
  to service_role;
grant execute on function public.release_blanket_po_drawdown(uuid, uuid)
  to service_role;
