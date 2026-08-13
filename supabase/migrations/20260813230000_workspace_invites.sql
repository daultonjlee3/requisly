-- Pending team invites by email (profile_id is unknown until accept/login).
-- workspace_members.profile_id stays required for joined members; invites live here.

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member'
    check (role = any (array['owner', 'admin', 'member', 'viewer'])),
  token text not null unique,
  invited_by_label text,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_profile_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz
);

create unique index if not exists workspace_invites_pending_email_uidx
  on public.workspace_invites (workspace_id, lower(email))
  where accepted_at is null and revoked_at is null;

create index if not exists workspace_invites_token_idx
  on public.workspace_invites (token);

create index if not exists workspace_invites_workspace_id_idx
  on public.workspace_invites (workspace_id);

comment on table public.workspace_invites is
  'Email invites to a workspace. On accept/login, a workspace_members row is created with joined_at set.';

alter table public.workspace_invites enable row level security;

drop policy if exists "workspace_invites member read" on public.workspace_invites;
create policy "workspace_invites member read"
  on public.workspace_invites for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_invites owners manage" on public.workspace_invites;
create policy "workspace_invites owners manage"
  on public.workspace_invites for all to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

grant select, insert, update, delete on public.workspace_invites to authenticated;
grant all on public.workspace_invites to service_role;
