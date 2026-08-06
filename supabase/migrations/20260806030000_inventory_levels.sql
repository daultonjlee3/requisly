-- Shopify inventory sync cache (Phase 0). Read-only display until OAuth sync writes rows.
create table if not exists public.inventory_levels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  on_hand integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (product_variant_id, location_id)
);

create index if not exists inventory_levels_workspace_id_idx
  on public.inventory_levels (workspace_id);
create index if not exists inventory_levels_variant_id_idx
  on public.inventory_levels (product_variant_id);

comment on table public.inventory_levels is
  'Cached Shopify inventory quantities per variant × location. Populated by catalog/inventory sync — never fabricated in the UI.';

alter table public.inventory_levels enable row level security;

drop policy if exists "inventory_levels member access" on public.inventory_levels;
create policy "inventory_levels member access"
  on public.inventory_levels for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.inventory_levels to authenticated;
grant all on public.inventory_levels to service_role;
