-- Manufacturing: BOM (product_recipes) + make-to-stock Manufacturing Orders.
-- Completing an MO must atomically deduct ingredients (recursive subassemblies)
-- and add finished qty — single Postgres transaction via complete_manufacturing_order.

create table if not exists public.product_recipes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  name text,
  created_at timestamptz not null default now(),
  unique (workspace_id, product_variant_id)
);

create index if not exists product_recipes_workspace_idx
  on public.product_recipes (workspace_id);

comment on table public.product_recipes is
  'Bill of Materials for a finished (or subassembly) product variant. One recipe per variant per workspace.';

create table if not exists public.product_recipe_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.product_recipes(id) on delete cascade,
  ingredient_product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  qty_required numeric(12,4) not null check (qty_required > 0),
  is_subassembly boolean not null default false,
  sort_order integer not null default 0,
  unique (recipe_id, ingredient_product_variant_id)
);

create index if not exists product_recipe_lines_recipe_idx
  on public.product_recipe_lines (recipe_id);
create index if not exists product_recipe_lines_ingredient_idx
  on public.product_recipe_lines (ingredient_product_variant_id);

comment on table public.product_recipe_lines is
  'BOM ingredients. Raw materials purchase via existing supplier_products / PO flow. Subassemblies explode recursively on MO complete.';

create table if not exists public.manufacturing_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  qty_to_make integer not null check (qty_to_make > 0),
  mode text not null default 'make_to_stock'
    check (mode in ('make_to_stock', 'make_to_order')),
  linked_sales_order_id text,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists manufacturing_orders_workspace_idx
  on public.manufacturing_orders (workspace_id, created_at desc);
create index if not exists manufacturing_orders_status_idx
  on public.manufacturing_orders (workspace_id, status);

comment on table public.manufacturing_orders is
  'Make-to-stock (and later make-to-order) manufacturing orders. Completion is atomic via complete_manufacturing_order().';
comment on column public.manufacturing_orders.location_id is
  'Inventory location for ingredient deductions and finished-good receipt.';
comment on column public.manufacturing_orders.linked_sales_order_id is
  'Reserved for make-to-order (Shopify order id). Unused in make-to-stock.';

alter table public.product_recipes enable row level security;
alter table public.product_recipe_lines enable row level security;
alter table public.manufacturing_orders enable row level security;

drop policy if exists "product_recipes member access" on public.product_recipes;
create policy "product_recipes member access"
  on public.product_recipes for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "product_recipe_lines member access" on public.product_recipe_lines;
create policy "product_recipe_lines member access"
  on public.product_recipe_lines for all to authenticated
  using (
    exists (
      select 1 from public.product_recipes r
      where r.id = recipe_id and public.is_workspace_member(r.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.product_recipes r
      where r.id = recipe_id and public.is_workspace_member(r.workspace_id)
    )
  );

drop policy if exists "manufacturing_orders member access" on public.manufacturing_orders;
create policy "manufacturing_orders member access"
  on public.manufacturing_orders for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.product_recipes to authenticated;
grant select, insert, update, delete on public.product_recipe_lines to authenticated;
grant select, insert, update, delete on public.manufacturing_orders to authenticated;
grant all on public.product_recipes to service_role;
grant all on public.product_recipe_lines to service_role;
grant all on public.manufacturing_orders to service_role;

-- ---------------------------------------------------------------------------
-- Expand BOM into leaf ingredient quantities (recursive, cycle-safe).
-- ---------------------------------------------------------------------------
create or replace function public.expand_bom_requirements(
  p_workspace_id uuid,
  p_finished_variant_id uuid,
  p_qty_to_make numeric
)
returns table (
  ingredient_product_variant_id uuid,
  qty_required numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recipe_id uuid;
begin
  if p_qty_to_make is null or p_qty_to_make <= 0 then
    raise exception 'qty_to_make must be positive';
  end if;

  select r.id into v_recipe_id
  from public.product_recipes r
  where r.workspace_id = p_workspace_id
    and r.product_variant_id = p_finished_variant_id;
  if v_recipe_id is null then
    raise exception 'No BOM/recipe for finished product variant %', p_finished_variant_id;
  end if;

  return query
  with recursive walk as (
    -- Root recipe lines scaled by qty_to_make
    select
      l.ingredient_product_variant_id as variant_id,
      (l.qty_required * p_qty_to_make)::numeric as qty,
      l.is_subassembly,
      array[p_finished_variant_id, l.ingredient_product_variant_id]::uuid[] as path
    from public.product_recipe_lines l
    where l.recipe_id = v_recipe_id

    union all

    -- Explode subassemblies (flagged OR have their own recipe)
    select
      l2.ingredient_product_variant_id,
      (l2.qty_required * w.qty)::numeric,
      l2.is_subassembly,
      w.path || l2.ingredient_product_variant_id
    from walk w
    join public.product_recipes r2
      on r2.workspace_id = p_workspace_id
     and r2.product_variant_id = w.variant_id
    join public.product_recipe_lines l2 on l2.recipe_id = r2.id
    where (w.is_subassembly or true)  -- always explode when a recipe exists (join implies it)
      and not (l2.ingredient_product_variant_id = any (w.path))
  ),
  -- Leaf = nodes that do not themselves have a recipe in this workspace
  leaves as (
    select
      w.variant_id,
      sum(w.qty) as qty
    from walk w
    where not exists (
      select 1
      from public.product_recipes r
      where r.workspace_id = p_workspace_id
        and r.product_variant_id = w.variant_id
    )
    group by w.variant_id
  )
  select leaves.variant_id, leaves.qty
  from leaves
  where leaves.qty > 0;
end;
$$;

revoke all on function public.expand_bom_requirements(uuid, uuid, numeric) from public;
grant execute on function public.expand_bom_requirements(uuid, uuid, numeric) to service_role;
grant execute on function public.expand_bom_requirements(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic MO completion — single transaction; no partial inventory state.
-- ---------------------------------------------------------------------------
create or replace function public.complete_manufacturing_order(
  p_workspace_id uuid,
  p_mo_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mo public.manufacturing_orders%rowtype;
  v_req record;
  v_level public.inventory_levels%rowtype;
  v_next integer;
  v_deductions jsonb := '[]'::jsonb;
  v_finished jsonb;
  v_finished_before integer;
  v_finished_after integer;
begin
  -- Lock MO row so concurrent completes cannot double-apply.
  select * into v_mo
  from public.manufacturing_orders
  where id = p_mo_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Manufacturing order not found';
  end if;

  if v_mo.status = 'completed' then
    raise exception 'Manufacturing order already completed';
  end if;

  if v_mo.status = 'cancelled' then
    raise exception 'Manufacturing order is cancelled';
  end if;

  if v_mo.mode <> 'make_to_stock' and v_mo.mode <> 'make_to_order' then
    raise exception 'Unsupported manufacturing mode: %', v_mo.mode;
  end if;

  -- Expand BOM (raises if no recipe / cycle issues surface as missing leaves).
  for v_req in
    select *
    from public.expand_bom_requirements(
      p_workspace_id,
      v_mo.product_variant_id,
      v_mo.qty_to_make::numeric
    )
  loop
    -- Lock inventory row for this ingredient × location.
    select * into v_level
    from public.inventory_levels
    where workspace_id = p_workspace_id
      and product_variant_id = v_req.ingredient_product_variant_id
      and location_id = v_mo.location_id
    for update;

    if not found then
      -- Create zero row then fail on insufficient — keeps unique constraint path clean.
      insert into public.inventory_levels (
        workspace_id, product_variant_id, location_id, on_hand, updated_at
      ) values (
        p_workspace_id, v_req.ingredient_product_variant_id, v_mo.location_id, 0, now()
      )
      returning * into v_level;
    end if;

    v_next := v_level.on_hand - ceil(v_req.qty_required)::integer;
    if v_next < 0 then
      raise exception
        'Insufficient stock for ingredient %: on_hand=%, required=% (MO %)',
        v_req.ingredient_product_variant_id,
        v_level.on_hand,
        ceil(v_req.qty_required)::integer,
        p_mo_id;
    end if;

    update public.inventory_levels
    set on_hand = v_next,
        updated_at = now()
    where id = v_level.id;

    v_deductions := v_deductions || jsonb_build_array(
      jsonb_build_object(
        'product_variant_id', v_req.ingredient_product_variant_id,
        'qty_required', v_req.qty_required,
        'qty_deducted', ceil(v_req.qty_required)::integer,
        'on_hand_before', v_level.on_hand,
        'on_hand_after', v_next
      )
    );
  end loop;

  -- Add finished goods at the same location.
  select * into v_level
  from public.inventory_levels
  where workspace_id = p_workspace_id
    and product_variant_id = v_mo.product_variant_id
    and location_id = v_mo.location_id
  for update;

  if not found then
    insert into public.inventory_levels (
      workspace_id, product_variant_id, location_id, on_hand, updated_at
    ) values (
      p_workspace_id, v_mo.product_variant_id, v_mo.location_id, v_mo.qty_to_make, now()
    )
    returning * into v_level;
    v_finished_before := 0;
    v_finished_after := v_mo.qty_to_make;
  else
    v_finished_before := v_level.on_hand;
    v_finished_after := v_level.on_hand + v_mo.qty_to_make;
    update public.inventory_levels
    set on_hand = v_finished_after,
        updated_at = now()
    where id = v_level.id;
  end if;

  v_finished := jsonb_build_object(
    'product_variant_id', v_mo.product_variant_id,
    'qty_added', v_mo.qty_to_make,
    'on_hand_before', v_finished_before,
    'on_hand_after', v_finished_after
  );

  update public.manufacturing_orders
  set status = 'completed',
      completed_at = now(),
      started_at = coalesce(started_at, now())
  where id = v_mo.id;

  -- If anything above raised, the whole function rolls back — no partial state.
  return jsonb_build_object(
    'mo_id', v_mo.id,
    'status', 'completed',
    'location_id', v_mo.location_id,
    'deductions', v_deductions,
    'finished', v_finished,
    'completed_at', now()
  );
end;
$$;

revoke all on function public.complete_manufacturing_order(uuid, uuid) from public;
grant execute on function public.complete_manufacturing_order(uuid, uuid) to service_role;
grant execute on function public.complete_manufacturing_order(uuid, uuid) to authenticated;

comment on function public.complete_manufacturing_order(uuid, uuid) is
  'Atomically complete an MO: lock MO, explode BOM, deduct leaf ingredients, add finished qty, mark completed. Raises on insufficient stock — entire transaction rolls back.';
