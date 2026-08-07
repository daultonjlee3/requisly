-- Purchase order templates: reusable purchasing blueprints (no inventory side effects).
-- Metadata + usage stats are reserved for future template recommendations.

create table if not exists public.purchase_order_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  currency text not null default 'USD',
  notes text,
  payment_terms text,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_by_label text,
  created_by uuid references public.profiles(id) on delete set null,
  source_po_id uuid references public.purchase_orders(id) on delete set null,
  -- Future: recommendation fingerprints, tags, similarity hints
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_order_templates_workspace_idx
  on public.purchase_order_templates (workspace_id);

create index if not exists purchase_order_templates_status_idx
  on public.purchase_order_templates (workspace_id, status);

create index if not exists purchase_order_templates_supplier_idx
  on public.purchase_order_templates (workspace_id, supplier_id);

create index if not exists purchase_order_templates_last_used_idx
  on public.purchase_order_templates (workspace_id, last_used_at desc nulls last);

create index if not exists purchase_order_templates_use_count_idx
  on public.purchase_order_templates (workspace_id, use_count desc);

create table if not exists public.purchase_order_template_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid not null references public.purchase_order_templates(id) on delete cascade,
  description text not null,
  sku text,
  qty numeric(12,3) not null default 1,
  unit_cost numeric(12,2) not null default 0,
  uom text,
  supplier_product_id uuid references public.supplier_products(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_template_lines_template_idx
  on public.purchase_order_template_lines (template_id, sort_order);

create index if not exists purchase_order_template_lines_workspace_idx
  on public.purchase_order_template_lines (workspace_id);

-- Optional product search helper (description/sku)
create index if not exists purchase_order_template_lines_search_idx
  on public.purchase_order_template_lines
  using gin (to_tsvector('simple', coalesce(description, '') || ' ' || coalesce(sku, '')));

drop trigger if exists purchase_order_templates_touch_updated_at
  on public.purchase_order_templates;
create trigger purchase_order_templates_touch_updated_at
  before update on public.purchase_order_templates
  for each row execute function public.touch_updated_at();

alter table public.purchase_order_templates enable row level security;
alter table public.purchase_order_template_lines enable row level security;

drop policy if exists "purchase_order_templates member access"
  on public.purchase_order_templates;
create policy "purchase_order_templates member access"
  on public.purchase_order_templates for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "purchase_order_template_lines member access"
  on public.purchase_order_template_lines;
create policy "purchase_order_template_lines member access"
  on public.purchase_order_template_lines for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
