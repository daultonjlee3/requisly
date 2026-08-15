-- Workspace COGS costing method (Weighted Average default, or FIFO).
-- Specific identification / lot-level costing is explicitly out of scope.

create table if not exists public.workspace_cogs_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  method text not null default 'weighted_average'
    check (method in ('weighted_average', 'fifo')),
  updated_at timestamptz not null default now()
);

comment on table public.workspace_cogs_settings is
  'Merchant-chosen COGS method. Weighted Average uses supplier price history; FIFO consumes receipt cost layers chronologically. Lot/specific ID costing is out of scope.';
comment on column public.workspace_cogs_settings.method is
  'weighted_average (default) | fifo';

alter table public.workspace_cogs_settings enable row level security;

drop policy if exists "workspace_cogs_settings member access" on public.workspace_cogs_settings;
create policy "workspace_cogs_settings member access"
  on public.workspace_cogs_settings for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.workspace_cogs_settings to authenticated;
grant all on public.workspace_cogs_settings to service_role;
