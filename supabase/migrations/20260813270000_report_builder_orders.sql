-- Report Builder foundation: synced Shopify Orders (read-only cache) + pin agent.

-- Orders (workspace-scoped, for spend-vs-revenue and GDPR)
create table if not exists public.shopify_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shopify_order_id text not null,
  order_name text,
  processed_at timestamptz,
  currency text default 'USD',
  total_price numeric(12,2) not null default 0,
  customer_shopify_id text,
  customer_email text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, shopify_order_id)
);

create index if not exists shopify_orders_workspace_processed_idx
  on public.shopify_orders (workspace_id, processed_at desc);

create index if not exists shopify_orders_workspace_email_idx
  on public.shopify_orders (workspace_id, customer_email)
  where customer_email is not null;

create table if not exists public.shopify_order_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.shopify_orders(id) on delete cascade,
  shopify_line_item_id text not null,
  shopify_variant_id text,
  product_variant_id uuid references public.product_variants(id) on delete set null,
  title text not null,
  sku text,
  quantity integer not null default 0,
  unit_price numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, shopify_line_item_id)
);

create index if not exists shopify_order_lines_workspace_variant_idx
  on public.shopify_order_line_items (workspace_id, product_variant_id);

alter table public.shopify_orders enable row level security;
alter table public.shopify_order_line_items enable row level security;

drop policy if exists "shopify_orders member select" on public.shopify_orders;
create policy "shopify_orders member select"
  on public.shopify_orders for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "shopify_order_line_items member select" on public.shopify_order_line_items;
create policy "shopify_order_line_items member select"
  on public.shopify_order_line_items for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke insert, update, delete on public.shopify_orders from authenticated;
revoke insert, update, delete on public.shopify_order_line_items from authenticated;
grant select on public.shopify_orders to authenticated;
grant select on public.shopify_order_line_items to authenticated;
grant all on public.shopify_orders to service_role;
grant all on public.shopify_order_line_items to service_role;

comment on table public.shopify_orders is
  'Read-only Shopify Orders cache for Report Builder. Never written by merchants; synced server-side.';

-- Allow reports agent on ai_insights (pinned reports)
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
        'documentation'::text,
        'hygiene'::text,
        'reports'::text
      ]
    )
  );

alter table public.workspaces
  add column if not exists orders_synced_at timestamptz;
