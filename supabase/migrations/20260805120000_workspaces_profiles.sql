-- Milestone 1: workspaces + profiles
-- Apply this in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- State-machine decisions (authoritative for later migrations):
--   - production is a real po_status value (skippable/optional in UI)
--   - viewed is system-triggered on first Supplier Link open
--   - closed = auto on full receipt OR manual from partially_received
--   - inventory writes use the PO's selected location_id

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shopify_domain text unique,
  shopify_access_token text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name text,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now()
);

create index if not exists profiles_workspace_id_idx on public.profiles (workspace_id);

-- ============================================================
-- Helper: current user's workspace
-- ============================================================

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.profiles where id = auth.uid()
$$;

revoke all on function public.current_workspace_id() from public;
grant execute on function public.current_workspace_id() to authenticated;

-- ============================================================
-- Bootstrap: create workspace + owner profile on signup
-- Reads optional metadata set at signUp: full_name, workspace_name
-- ============================================================

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "workspace members can read workspace" on public.workspaces;
create policy "workspace members can read workspace"
  on public.workspaces
  for select
  to authenticated
  using (id = public.current_workspace_id());

drop policy if exists "owners can update workspace" on public.workspaces;
create policy "owners can update workspace"
  on public.workspaces
  for update
  to authenticated
  using (
    id = public.current_workspace_id()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.workspace_id = workspaces.id
        and p.role = 'owner'
    )
  );

drop policy if exists "users can read profiles in their workspace" on public.profiles;
create policy "users can read profiles in their workspace"
  on public.profiles
  for select
  to authenticated
  using (workspace_id = public.current_workspace_id());

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
