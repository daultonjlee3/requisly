-- Phase 0 core schema (Milestones 2–6)
-- Authoritative state rules: docs/STATE-MACHINE.md

-- ============================================================
-- Locations (ship-to; Shopify sync later)
-- ============================================================

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shopify_location_id text,
  name text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, shopify_location_id)
);

create index if not exists locations_workspace_id_idx on public.locations (workspace_id);

-- Seed primary location for existing workspaces
insert into public.locations (workspace_id, name, is_primary, shopify_location_id)
select w.id, 'Primary', true, null
from public.workspaces w
where not exists (
  select 1 from public.locations l where l.workspace_id = w.id
);

-- Update signup trigger to create a primary location
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
  workspace_name text;
begin
  workspace_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'workspace_name'), ''),
    'My Workspace'
  );

  insert into public.workspaces (name)
  values (workspace_name)
  returning id into new_workspace_id;

  insert into public.locations (workspace_id, name, is_primary)
  values (new_workspace_id, 'Primary', true);

  insert into public.profiles (id, workspace_id, full_name, role)
  values (
    new.id,
    new_workspace_id,
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    'owner'
  );

  return new;
end;
$$;

-- ============================================================
-- Product variants (Shopify sync later — table exists for FKs)
-- ============================================================

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shopify_product_id text not null,
  shopify_variant_id text not null,
  title text not null,
  sku text,
  created_at timestamptz not null default now(),
  unique (workspace_id, shopify_variant_id)
);

-- ============================================================
-- Suppliers
-- ============================================================

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  contact_name text,
  payment_terms text,
  currency text default 'USD',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suppliers_workspace_id_idx on public.suppliers (workspace_id);

create table if not exists public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_variant_id uuid references public.product_variants(id) on delete set null,
  title text not null,
  sku text,
  unit_cost numeric(12,2),
  case_qty integer,
  moq integer,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Purchase Orders
-- ============================================================

do $$ begin
  create type public.po_status as enum (
    'draft','sent','viewed','confirmed','production',
    'shipped','in_transit','partially_received','received','closed'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  po_number text not null,
  supplier_id uuid not null references public.suppliers(id),
  location_id uuid references public.locations(id),
  status public.po_status not null default 'draft',
  currency text default 'USD',
  notes text,
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  requested_ship_date date,
  confirmed_ship_date date,
  duplicated_from_po_id uuid references public.purchase_orders(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, po_number)
);

create index if not exists purchase_orders_workspace_id_idx on public.purchase_orders (workspace_id);
create index if not exists purchase_orders_status_idx on public.purchase_orders (workspace_id, status);

create table if not exists public.po_line_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  supplier_product_id uuid references public.supplier_products(id),
  description text not null,
  sku text,
  is_free_text boolean not null default false,
  qty integer not null check (qty > 0),
  unit_cost numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  sort_order integer not null default 0
);

create index if not exists po_line_items_po_id_idx on public.po_line_items (po_id);

create table if not exists public.po_timeline_events (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  event_type public.po_status not null,
  actor text not null check (actor in ('merchant', 'supplier', 'system')),
  occurred_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists po_timeline_events_po_id_idx on public.po_timeline_events (po_id);

create table if not exists public.po_documents (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Supplier Link
-- ============================================================

create table if not exists public.supplier_link_tokens (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists supplier_link_tokens_po_id_idx on public.supplier_link_tokens (po_id);

-- ============================================================
-- Receiving
-- ============================================================

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  received_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);

do $$ begin
  create type public.receipt_condition as enum ('good','damaged','wrong_item','backorder');
exception when duplicate_object then null;
end $$;

create table if not exists public.receipt_line_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  po_line_item_id uuid not null references public.po_line_items(id),
  qty_received integer not null check (qty_received >= 0),
  condition public.receipt_condition not null default 'good',
  reason_note text
);

-- ============================================================
-- Helpers
-- ============================================================

create or replace function public.next_po_number(p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  max_n integer;
begin
  select coalesce(max(nullif(regexp_replace(po_number, '\D', '', 'g'), '')::integer), 1000)
  into max_n
  from public.purchase_orders
  where workspace_id = p_workspace_id;

  return 'PO-' || (max_n + 1)::text;
end;
$$;

grant execute on function public.next_po_number(uuid) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists suppliers_touch_updated_at on public.suppliers;
create trigger suppliers_touch_updated_at
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

drop trigger if exists purchase_orders_touch_updated_at on public.purchase_orders;
create trigger purchase_orders_touch_updated_at
  before update on public.purchase_orders
  for each row execute function public.touch_updated_at();

-- ============================================================
-- RLS
-- ============================================================

alter table public.locations enable row level security;
alter table public.product_variants enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_line_items enable row level security;
alter table public.po_timeline_events enable row level security;
alter table public.po_documents enable row level security;
alter table public.supplier_link_tokens enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_line_items enable row level security;

-- Workspace-scoped tables
drop policy if exists "locations workspace" on public.locations;
create policy "locations workspace" on public.locations
  for all to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

drop policy if exists "product_variants workspace" on public.product_variants;
create policy "product_variants workspace" on public.product_variants
  for all to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

drop policy if exists "suppliers workspace" on public.suppliers;
create policy "suppliers workspace" on public.suppliers
  for all to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

drop policy if exists "supplier_products workspace" on public.supplier_products;
create policy "supplier_products workspace" on public.supplier_products
  for all to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

drop policy if exists "purchase_orders workspace" on public.purchase_orders;
create policy "purchase_orders workspace" on public.purchase_orders
  for all to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

drop policy if exists "po_documents workspace" on public.po_documents;
create policy "po_documents workspace" on public.po_documents
  for all to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

drop policy if exists "receipts workspace" on public.receipts;
create policy "receipts workspace" on public.receipts
  for all to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

drop policy if exists "supplier_link_tokens via po" on public.supplier_link_tokens;
create policy "supplier_link_tokens via po" on public.supplier_link_tokens
  for all to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = supplier_link_tokens.po_id
        and po.workspace_id = public.current_workspace_id()
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = supplier_link_tokens.po_id
        and po.workspace_id = public.current_workspace_id()
    )
  );

drop policy if exists "po_line_items via po" on public.po_line_items;
create policy "po_line_items via po" on public.po_line_items
  for all to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = po_line_items.po_id
        and po.workspace_id = public.current_workspace_id()
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = po_line_items.po_id
        and po.workspace_id = public.current_workspace_id()
    )
  );

drop policy if exists "po_timeline_events via po" on public.po_timeline_events;
create policy "po_timeline_events via po" on public.po_timeline_events
  for all to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = po_timeline_events.po_id
        and po.workspace_id = public.current_workspace_id()
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = po_timeline_events.po_id
        and po.workspace_id = public.current_workspace_id()
    )
  );

drop policy if exists "receipt_line_items via receipt" on public.receipt_line_items;
create policy "receipt_line_items via receipt" on public.receipt_line_items
  for all to authenticated
  using (
    exists (
      select 1 from public.receipts r
      where r.id = receipt_line_items.receipt_id
        and r.workspace_id = public.current_workspace_id()
    )
  )
  with check (
    exists (
      select 1 from public.receipts r
      where r.id = receipt_line_items.receipt_id
        and r.workspace_id = public.current_workspace_id()
    )
  );

-- ============================================================
-- Supplier Link RPCs (anon-callable, token-gated, security definer)
-- ============================================================

create or replace function public.supplier_link_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_token public.supplier_link_tokens%rowtype;
  v_supplier public.suppliers%rowtype;
  v_workspace public.workspaces%rowtype;
  v_lines jsonb;
begin
  select * into v_token from public.supplier_link_tokens where token = p_token;
  if not found then
    raise exception 'invalid_token';
  end if;
  if v_token.expires_at is not null and v_token.expires_at < now() then
    raise exception 'expired_token';
  end if;

  select * into v_po from public.purchase_orders where id = v_token.po_id;
  select * into v_supplier from public.suppliers where id = v_po.supplier_id;
  select * into v_workspace from public.workspaces where id = v_po.workspace_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', li.id,
      'description', li.description,
      'sku', li.sku,
      'qty', li.qty,
      'unit_cost', li.unit_cost,
      'line_total', li.line_total,
      'is_free_text', li.is_free_text,
      'sort_order', li.sort_order
    ) order by li.sort_order
  ), '[]'::jsonb)
  into v_lines
  from public.po_line_items li
  where li.po_id = v_po.id;

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
      'created_at', v_po.created_at
    ),
    'supplier', jsonb_build_object(
      'name', v_supplier.name,
      'email', v_supplier.email
    ),
    'workspace', jsonb_build_object(
      'name', v_workspace.name
    ),
    'line_items', v_lines
  );
end;
$$;

create or replace function public.supplier_link_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_token public.supplier_link_tokens%rowtype;
begin
  select * into v_token from public.supplier_link_tokens where token = p_token;
  if not found then raise exception 'invalid_token'; end if;

  select * into v_po from public.purchase_orders where id = v_token.po_id;

  -- Viewed fires automatically the first time the supplier opens the link
  if v_po.status = 'sent' then
    update public.purchase_orders
      set status = 'viewed'
      where id = v_po.id;
    insert into public.po_timeline_events (po_id, event_type, actor, metadata)
    values (v_po.id, 'viewed', 'system', '{"source":"supplier_link_open"}'::jsonb);
    v_po.status := 'viewed';
  end if;

  return public.supplier_link_get(p_token);
end;
$$;

create or replace function public.supplier_link_confirm(p_token text, p_ship_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_token public.supplier_link_tokens%rowtype;
begin
  select * into v_token from public.supplier_link_tokens where token = p_token;
  if not found then raise exception 'invalid_token'; end if;

  select * into v_po from public.purchase_orders where id = v_token.po_id;

  if v_po.status not in ('sent', 'viewed', 'confirmed') then
    raise exception 'invalid_status';
  end if;

  if v_po.status = 'sent' then
    insert into public.po_timeline_events (po_id, event_type, actor, metadata)
    values (v_po.id, 'viewed', 'system', '{"source":"confirm_implies_view"}'::jsonb);
  end if;

  update public.purchase_orders
    set status = 'confirmed',
        confirmed_ship_date = p_ship_date,
        requested_ship_date = coalesce(p_ship_date, requested_ship_date)
    where id = v_po.id;

  insert into public.po_timeline_events (po_id, event_type, actor, metadata)
  values (
    v_po.id,
    'confirmed',
    'supplier',
    jsonb_build_object('ship_date', p_ship_date)
  );

  -- Production remains skippable — we do not auto-enter it
  return public.supplier_link_get(p_token);
end;
$$;

create or replace function public.supplier_link_ship(
  p_token text,
  p_tracking text default null,
  p_carrier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_token public.supplier_link_tokens%rowtype;
begin
  select * into v_token from public.supplier_link_tokens where token = p_token;
  if not found then raise exception 'invalid_token'; end if;

  select * into v_po from public.purchase_orders where id = v_token.po_id;

  if v_po.status not in ('confirmed', 'production', 'viewed', 'shipped') then
    raise exception 'invalid_status';
  end if;

  update public.purchase_orders
    set status = 'shipped'
    where id = v_po.id;

  insert into public.po_timeline_events (po_id, event_type, actor, metadata)
  values (
    v_po.id,
    'shipped',
    'supplier',
    jsonb_build_object(
      'tracking_number', nullif(trim(p_tracking), ''),
      'carrier', nullif(trim(p_carrier), '')
    )
  );

  -- In Transit remains skippable — not auto-set
  return public.supplier_link_get(p_token);
end;
$$;

grant execute on function public.supplier_link_get(text) to anon, authenticated;
grant execute on function public.supplier_link_open(text) to anon, authenticated;
grant execute on function public.supplier_link_confirm(text, date) to anon, authenticated;
grant execute on function public.supplier_link_ship(text, text, text) to anon, authenticated;
