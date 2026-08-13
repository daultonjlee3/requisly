-- Claim a workspace invite on first login (authenticated user).
-- Invitee is not yet a member, so this must be SECURITY DEFINER.

create or replace function public.get_workspace_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.workspace_invites%rowtype;
  v_ws public.workspaces%rowtype;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'invalid_token';
  end if;

  select * into v_inv
  from public.workspace_invites
  where token = p_token;

  if not found then
    raise exception 'invalid_token';
  end if;

  if v_inv.revoked_at is not null then
    raise exception 'invite_revoked';
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'invite_already_accepted';
  end if;

  select * into v_ws from public.workspaces where id = v_inv.workspace_id;

  return jsonb_build_object(
    'id', v_inv.id,
    'email', v_inv.email,
    'role', v_inv.role,
    'invited_at', v_inv.invited_at,
    'invited_by_label', v_inv.invited_by_label,
    'workspace_id', v_ws.id,
    'workspace_name', v_ws.name
  );
end;
$$;

revoke all on function public.get_workspace_invite(text) from public;
grant execute on function public.get_workspace_invite(text) to anon, authenticated;

create or replace function public.accept_workspace_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.workspace_invites%rowtype;
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'invalid_token';
  end if;

  select * into v_inv
  from public.workspace_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'invalid_token';
  end if;

  if v_inv.revoked_at is not null then
    raise exception 'invite_revoked';
  end if;

  if v_inv.accepted_at is not null then
    -- Idempotent if the same profile already accepted.
    if v_inv.accepted_profile_id = v_uid then
      return v_inv.workspace_id;
    end if;
    raise exception 'invite_already_accepted';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null or lower(v_email) <> lower(v_inv.email) then
    raise exception 'invite_email_mismatch';
  end if;

  insert into public.workspace_members (
    workspace_id, profile_id, role, invited_at, joined_at
  )
  values (
    v_inv.workspace_id,
    v_uid,
    coalesce(nullif(v_inv.role, ''), 'member'),
    v_inv.invited_at,
    now()
  )
  on conflict (workspace_id, profile_id) do update
    set role = excluded.role,
        joined_at = coalesce(public.workspace_members.joined_at, now());

  update public.workspace_invites
  set accepted_at = now(),
      accepted_profile_id = v_uid
  where id = v_inv.id;

  update public.profiles
  set active_workspace_id = v_inv.workspace_id
  where id = v_uid;

  return v_inv.workspace_id;
end;
$$;

revoke all on function public.accept_workspace_invite(text) from public;
grant execute on function public.accept_workspace_invite(text) to authenticated;
