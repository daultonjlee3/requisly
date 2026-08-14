-- Saved Report Builder definitions (template + params only — never freeform SQL).

create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  prompt text not null,
  template_id text not null,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_reports_workspace_updated_idx
  on public.saved_reports (workspace_id, updated_at desc);

alter table public.saved_reports enable row level security;

drop policy if exists "saved_reports member select" on public.saved_reports;
create policy "saved_reports member select"
  on public.saved_reports for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "saved_reports member insert" on public.saved_reports;
create policy "saved_reports member insert"
  on public.saved_reports for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "saved_reports member update" on public.saved_reports;
create policy "saved_reports member update"
  on public.saved_reports for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "saved_reports member delete" on public.saved_reports;
create policy "saved_reports member delete"
  on public.saved_reports for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.saved_reports to authenticated;
grant all on public.saved_reports to service_role;

comment on table public.saved_reports is
  'Merchant-saved Report Builder queries. Always maps to a code template + params; never stores LLM-generated SQL.';
