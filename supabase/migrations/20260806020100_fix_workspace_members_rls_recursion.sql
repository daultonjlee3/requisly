-- Fix infinite RLS recursion that 500'd every profiles SELECT.
-- Cause: workspace_members "owners can manage" policy self-selected
-- workspace_members, and profiles "sharing a workspace" policy joined
-- workspace_members, re-entering that recursive check.

create or replace function public.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.profile_id = auth.uid()
      and wm.role = 'owner'
      and wm.joined_at is not null
  );
$$;

revoke all on function public.is_workspace_owner(uuid) from public;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

create or replace function public.shares_workspace_with(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs
      on theirs.workspace_id = mine.workspace_id
    where mine.profile_id = auth.uid()
      and mine.joined_at is not null
      and theirs.profile_id = p_profile_id
      and theirs.joined_at is not null
  );
$$;

revoke all on function public.shares_workspace_with(uuid) from public;
grant execute on function public.shares_workspace_with(uuid) to authenticated;

drop policy if exists "owners can manage memberships" on public.workspace_members;
create policy "owners can manage memberships"
  on public.workspace_members for all to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "users can read profiles sharing a workspace" on public.profiles;
create policy "users can read profiles sharing a workspace"
  on public.profiles for select to authenticated
  using (public.shares_workspace_with(id));

drop policy if exists "owners can update workspace" on public.workspaces;
create policy "owners can update workspace"
  on public.workspaces for update to authenticated
  using (public.is_workspace_owner(id));

notify pgrst, 'reload schema';
