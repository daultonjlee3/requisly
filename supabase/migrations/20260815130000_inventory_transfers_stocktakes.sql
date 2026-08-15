-- Multi-location transfers + stocktakes (plan §2 / build order item 6).
-- Inventory mutations go through RPCs so draft→in_transit→received and
-- stocktake completion cannot leave partial inventory state.

create table if not exists public.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_location_id uuid not null references public.locations(id) on delete restrict,
  to_location_id uuid not null references public.locations(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'in_transit', 'received', 'cancelled')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  shipped_at timestamptz,
  received_at timestamptz,
  constraint inventory_transfers_distinct_locations
    check (from_location_id <> to_location_id)
);

create index if not exists inventory_transfers_workspace_idx
  on public.inventory_transfers (workspace_id, created_at desc);

create table if not exists public.inventory_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.inventory_transfers(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  qty integer not null check (qty > 0),
  unique (transfer_id, product_variant_id)
);

create index if not exists inventory_transfer_lines_transfer_idx
  on public.inventory_transfer_lines (transfer_id);

create table if not exists public.stocktakes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'cancelled')),
  notes text,
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists stocktakes_workspace_idx
  on public.stocktakes (workspace_id, started_at desc);

create table if not exists public.stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.stocktakes(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  expected_qty integer not null,
  counted_qty integer,
  variance integer generated always as (counted_qty - expected_qty) stored,
  unique (stocktake_id, product_variant_id)
);

create index if not exists stocktake_lines_stocktake_idx
  on public.stocktake_lines (stocktake_id);

comment on table public.inventory_transfers is
  'Inter-location stock moves. draft→in_transit deducts source; in_transit→received adds destination.';
comment on table public.stocktakes is
  'Physical counts. Completing applies counted_qty to inventory_levels in one transaction.';

alter table public.inventory_transfers enable row level security;
alter table public.inventory_transfer_lines enable row level security;
alter table public.stocktakes enable row level security;
alter table public.stocktake_lines enable row level security;

drop policy if exists "inventory_transfers member access" on public.inventory_transfers;
create policy "inventory_transfers member access"
  on public.inventory_transfers for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "inventory_transfer_lines member access" on public.inventory_transfer_lines;
create policy "inventory_transfer_lines member access"
  on public.inventory_transfer_lines for all to authenticated
  using (
    exists (
      select 1 from public.inventory_transfers t
      where t.id = transfer_id and public.is_workspace_member(t.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.inventory_transfers t
      where t.id = transfer_id and public.is_workspace_member(t.workspace_id)
    )
  );

drop policy if exists "stocktakes member access" on public.stocktakes;
create policy "stocktakes member access"
  on public.stocktakes for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "stocktake_lines member access" on public.stocktake_lines;
create policy "stocktake_lines member access"
  on public.stocktake_lines for all to authenticated
  using (
    exists (
      select 1 from public.stocktakes s
      where s.id = stocktake_id and public.is_workspace_member(s.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.stocktakes s
      where s.id = stocktake_id and public.is_workspace_member(s.workspace_id)
    )
  );

grant select, insert, update, delete on public.inventory_transfers to authenticated;
grant select, insert, update, delete on public.inventory_transfer_lines to authenticated;
grant select, insert, update, delete on public.stocktakes to authenticated;
grant select, insert, update, delete on public.stocktake_lines to authenticated;
grant all on public.inventory_transfers to service_role;
grant all on public.inventory_transfer_lines to service_role;
grant all on public.stocktakes to service_role;
grant all on public.stocktake_lines to service_role;

-- Helper: adjust on_hand with row lock (insert zero row if missing).
create or replace function public._inventory_adjust(
  p_workspace_id uuid,
  p_variant_id uuid,
  p_location_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level public.inventory_levels%rowtype;
  v_next integer;
begin
  select * into v_level
  from public.inventory_levels
  where workspace_id = p_workspace_id
    and product_variant_id = p_variant_id
    and location_id = p_location_id
  for update;

  if not found then
    if p_delta < 0 then
      raise exception 'Insufficient stock for variant % at location % (on_hand=0, delta=%)',
        p_variant_id, p_location_id, p_delta;
    end if;
    insert into public.inventory_levels (
      workspace_id, product_variant_id, location_id, on_hand, updated_at
    ) values (
      p_workspace_id, p_variant_id, p_location_id, p_delta, now()
    )
    returning on_hand into v_next;
    return v_next;
  end if;

  v_next := v_level.on_hand + p_delta;
  if v_next < 0 then
    raise exception 'Insufficient stock for variant % at location % (on_hand=%, delta=%)',
      p_variant_id, p_location_id, v_level.on_hand, p_delta;
  end if;

  update public.inventory_levels
  set on_hand = v_next, updated_at = now()
  where id = v_level.id;

  return v_next;
end;
$$;

revoke all on function public._inventory_adjust(uuid, uuid, uuid, integer) from public;
grant execute on function public._inventory_adjust(uuid, uuid, uuid, integer) to service_role;

-- Mark transfer in transit: deduct from source location.
create or replace function public.mark_transfer_in_transit(
  p_workspace_id uuid,
  p_transfer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.inventory_transfers%rowtype;
  v_line record;
  v_movements jsonb := '[]'::jsonb;
  v_after integer;
begin
  select * into v_t
  from public.inventory_transfers
  where id = p_transfer_id and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Transfer not found';
  end if;
  if v_t.status <> 'draft' then
    raise exception 'Transfer must be draft to mark in transit (status=%)', v_t.status;
  end if;

  for v_line in
    select * from public.inventory_transfer_lines where transfer_id = v_t.id
  loop
    v_after := public._inventory_adjust(
      p_workspace_id, v_line.product_variant_id, v_t.from_location_id, -v_line.qty
    );
    v_movements := v_movements || jsonb_build_array(
      jsonb_build_object(
        'product_variant_id', v_line.product_variant_id,
        'qty', v_line.qty,
        'from_on_hand_after', v_after
      )
    );
  end loop;

  update public.inventory_transfers
  set status = 'in_transit', shipped_at = now()
  where id = v_t.id;

  return jsonb_build_object(
    'transfer_id', v_t.id,
    'status', 'in_transit',
    'movements', v_movements
  );
end;
$$;

revoke all on function public.mark_transfer_in_transit(uuid, uuid) from public;
grant execute on function public.mark_transfer_in_transit(uuid, uuid) to service_role;
grant execute on function public.mark_transfer_in_transit(uuid, uuid) to authenticated;

-- Receive transfer: add to destination (from in_transit only).
create or replace function public.receive_transfer(
  p_workspace_id uuid,
  p_transfer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.inventory_transfers%rowtype;
  v_line record;
  v_movements jsonb := '[]'::jsonb;
  v_after integer;
begin
  select * into v_t
  from public.inventory_transfers
  where id = p_transfer_id and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Transfer not found';
  end if;
  if v_t.status <> 'in_transit' then
    raise exception 'Transfer must be in_transit to receive (status=%)', v_t.status;
  end if;

  for v_line in
    select * from public.inventory_transfer_lines where transfer_id = v_t.id
  loop
    v_after := public._inventory_adjust(
      p_workspace_id, v_line.product_variant_id, v_t.to_location_id, v_line.qty
    );
    v_movements := v_movements || jsonb_build_array(
      jsonb_build_object(
        'product_variant_id', v_line.product_variant_id,
        'qty', v_line.qty,
        'to_on_hand_after', v_after
      )
    );
  end loop;

  update public.inventory_transfers
  set status = 'received', received_at = now()
  where id = v_t.id;

  return jsonb_build_object(
    'transfer_id', v_t.id,
    'status', 'received',
    'movements', v_movements
  );
end;
$$;

revoke all on function public.receive_transfer(uuid, uuid) from public;
grant execute on function public.receive_transfer(uuid, uuid) to service_role;
grant execute on function public.receive_transfer(uuid, uuid) to authenticated;

-- Complete stocktake: set on_hand to counted_qty for each line.
create or replace function public.complete_stocktake(
  p_workspace_id uuid,
  p_stocktake_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.stocktakes%rowtype;
  v_line record;
  v_adjustments jsonb := '[]'::jsonb;
  v_before integer;
  v_after integer;
  v_level public.inventory_levels%rowtype;
begin
  select * into v_s
  from public.stocktakes
  where id = p_stocktake_id and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Stocktake not found';
  end if;
  if v_s.status <> 'in_progress' then
    raise exception 'Stocktake must be in_progress to complete (status=%)', v_s.status;
  end if;

  if exists (
    select 1 from public.stocktake_lines
    where stocktake_id = v_s.id and counted_qty is null
  ) then
    raise exception 'All lines must have a counted quantity before completing';
  end if;

  for v_line in
    select * from public.stocktake_lines where stocktake_id = v_s.id
  loop
    select * into v_level
    from public.inventory_levels
    where workspace_id = p_workspace_id
      and product_variant_id = v_line.product_variant_id
      and location_id = v_s.location_id
    for update;

    if not found then
      insert into public.inventory_levels (
        workspace_id, product_variant_id, location_id, on_hand, updated_at
      ) values (
        p_workspace_id, v_line.product_variant_id, v_s.location_id,
        greatest(v_line.counted_qty, 0), now()
      )
      returning on_hand into v_after;
      v_before := 0;
    else
      v_before := v_level.on_hand;
      v_after := greatest(v_line.counted_qty, 0);
      update public.inventory_levels
      set on_hand = v_after, updated_at = now()
      where id = v_level.id;
    end if;

    v_adjustments := v_adjustments || jsonb_build_array(
      jsonb_build_object(
        'product_variant_id', v_line.product_variant_id,
        'expected_qty', v_line.expected_qty,
        'counted_qty', v_line.counted_qty,
        'variance', v_line.counted_qty - v_line.expected_qty,
        'on_hand_before', v_before,
        'on_hand_after', v_after
      )
    );
  end loop;

  update public.stocktakes
  set status = 'completed', completed_at = now()
  where id = v_s.id;

  return jsonb_build_object(
    'stocktake_id', v_s.id,
    'status', 'completed',
    'adjustments', v_adjustments
  );
end;
$$;

revoke all on function public.complete_stocktake(uuid, uuid) from public;
grant execute on function public.complete_stocktake(uuid, uuid) to service_role;
grant execute on function public.complete_stocktake(uuid, uuid) to authenticated;
