-- Multi-workspace membership.
-- RLS grants access via workspace_members only.
-- profiles.active_workspace_id is a UI preference — never an access grant.

-- ---------------------------------------------------------------------------
-- 1. Tables / columns
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member'
    check (role = any (array['owner', 'admin', 'member', 'viewer'])),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (workspace_id, profile_id)
);

create index if not exists workspace_members_profile_id_idx
  on public.workspace_members (profile_id);
create index if not exists workspace_members_workspace_id_idx
  on public.workspace_members (workspace_id);

alter table public.profiles
  add column if not exists active_workspace_id uuid references public.workspaces(id);

comment on column public.profiles.active_workspace_id is
  'UI viewing context only. Never used alone for RLS grants — membership in workspace_members is required.';
comment on column public.profiles.workspace_id is
  'Home/primary workspace from signup. Not the access-control source of truth; see workspace_members.';

-- ---------------------------------------------------------------------------
-- 2. Backfill memberships + active workspace from legacy profiles.workspace_id
-- ---------------------------------------------------------------------------
insert into public.workspace_members (workspace_id, profile_id, role, invited_at, joined_at)
select
  p.workspace_id,
  p.id,
  case when p.role = 'owner' then 'owner' else 'member' end,
  coalesce(p.created_at, now()),
  coalesce(p.created_at, now())
from public.profiles p
on conflict (workspace_id, profile_id) do nothing;

update public.profiles
set active_workspace_id = workspace_id
where active_workspace_id is null;

alter table public.profiles
  alter column active_workspace_id set not null;

-- ---------------------------------------------------------------------------
-- 3. Security helpers
--    is_workspace_member: SECURITY DEFINER so it can read workspace_members
--    without RLS recursion. Checks real membership — NOT active_workspace_id.
-- ---------------------------------------------------------------------------
create or replace function public.is_workspace_member(p_workspace_id uuid)
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
      and wm.joined_at is not null
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;

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

-- active_workspace_id() is for app/RPC convenience ONLY.
-- Do not use it as the sole predicate in RLS policies.
create or replace function public.active_workspace_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select active_workspace_id from public.profiles where id = auth.uid();
$$;

revoke all on function public.active_workspace_id() from public;
grant execute on function public.active_workspace_id() to authenticated;

-- Legacy helper: kept for any leftover callers, but redefined to active.
-- All RLS policies below use is_workspace_member() instead of this.
create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select active_workspace_id from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 4. Signup: create membership + set active
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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

  insert into public.profiles (id, workspace_id, active_workspace_id, full_name, role)
  values (
    new.id,
    new_workspace_id,
    new_workspace_id,
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    'owner'
  );

  insert into public.workspace_members (workspace_id, profile_id, role, joined_at)
  values (new_workspace_id, new.id, 'owner', now());

  insert into public.notification_rules (workspace_id, rule_type, enabled, threshold_value)
  values
    (new_workspace_id, 'po_not_confirmed', true, 2),
    (new_workspace_id, 'shipment_delayed', true, null),
    (new_workspace_id, 'arriving_soon', true, 1),
    (new_workspace_id, 'inventory_low', true, null);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Switch helper — membership-gated active workspace update
-- ---------------------------------------------------------------------------
create or replace function public.switch_active_workspace(p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not a member of workspace %', p_workspace_id;
  end if;

  update public.profiles
  set active_workspace_id = p_workspace_id
  where id = auth.uid();

  return p_workspace_id;
end;
$$;

revoke all on function public.switch_active_workspace(uuid) from public;
grant execute on function public.switch_active_workspace(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS — drop legacy policies, recreate with membership checks
-- ---------------------------------------------------------------------------
alter table public.workspace_members enable row level security;

drop policy if exists "workspace members can read workspace" on public.workspaces;
drop policy if exists "owners can update workspace" on public.workspaces;
drop policy if exists "users can read profiles in their workspace" on public.profiles;
drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "locations workspace" on public.locations;
drop policy if exists "product_variants workspace" on public.product_variants;
drop policy if exists "suppliers workspace" on public.suppliers;
drop policy if exists "supplier_products workspace" on public.supplier_products;
drop policy if exists "purchase_orders workspace" on public.purchase_orders;
drop policy if exists "po_documents workspace" on public.po_documents;
drop policy if exists "receipts workspace" on public.receipts;
drop policy if exists "po_line_items via po" on public.po_line_items;
drop policy if exists "po_timeline_events via po" on public.po_timeline_events;
drop policy if exists "supplier_link_tokens via po" on public.supplier_link_tokens;
drop policy if exists "receipt_line_items via receipt" on public.receipt_line_items;
drop policy if exists "notification_rules workspace" on public.notification_rules;
drop policy if exists "notification_log workspace read" on public.notification_log;
drop policy if exists "proposals via po workspace" on public.po_line_item_proposals;

-- workspaces: any joined member can read; owners (via membership) can update
create policy "members can read workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

create policy "owners can update workspace"
  on public.workspaces for update to authenticated
  using (public.is_workspace_owner(id));

-- workspace_members
create policy "members can read memberships in their workspaces"
  on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id) or profile_id = auth.uid());

-- IMPORTANT: never self-select workspace_members inside its own policies —
-- that recurses and 500s every query that touches memberships (including profiles).
create policy "owners can manage memberships"
  on public.workspace_members for all to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- profiles: always read/update self; read others who share a membership
create policy "users can read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "users can read profiles sharing a workspace"
  on public.profiles for select to authenticated
  using (public.shares_workspace_with(id));

create policy "users can update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and public.is_workspace_member(active_workspace_id)
  );

-- Direct workspace-scoped tables
create policy "locations member access"
  on public.locations for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "product_variants member access"
  on public.product_variants for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "suppliers member access"
  on public.suppliers for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "supplier_products member access"
  on public.supplier_products for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "purchase_orders member access"
  on public.purchase_orders for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "po_documents member access"
  on public.po_documents for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "receipts member access"
  on public.receipts for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "notification_rules member access"
  on public.notification_rules for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "notification_log member read"
  on public.notification_log for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- PO-child tables via parent PO membership
create policy "po_line_items member access"
  on public.po_line_items for all to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = po_line_items.po_id
        and public.is_workspace_member(po.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = po_line_items.po_id
        and public.is_workspace_member(po.workspace_id)
    )
  );

create policy "po_timeline_events member access"
  on public.po_timeline_events for all to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = po_timeline_events.po_id
        and public.is_workspace_member(po.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = po_timeline_events.po_id
        and public.is_workspace_member(po.workspace_id)
    )
  );

create policy "supplier_link_tokens member access"
  on public.supplier_link_tokens for all to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = supplier_link_tokens.po_id
        and public.is_workspace_member(po.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = supplier_link_tokens.po_id
        and public.is_workspace_member(po.workspace_id)
    )
  );

create policy "receipt_line_items member access"
  on public.receipt_line_items for all to authenticated
  using (
    exists (
      select 1 from public.receipts r
      where r.id = receipt_line_items.receipt_id
        and public.is_workspace_member(r.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.receipts r
      where r.id = receipt_line_items.receipt_id
        and public.is_workspace_member(r.workspace_id)
    )
  );

create policy "proposals member access"
  on public.po_line_item_proposals for all to authenticated
  using (
    exists (
      select 1
      from public.po_line_items li
      join public.purchase_orders po on po.id = li.po_id
      where li.id = po_line_item_proposals.po_line_item_id
        and public.is_workspace_member(po.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from public.po_line_items li
      join public.purchase_orders po on po.id = li.po_id
      where li.id = po_line_item_proposals.po_line_item_id
        and public.is_workspace_member(po.workspace_id)
    )
  );
