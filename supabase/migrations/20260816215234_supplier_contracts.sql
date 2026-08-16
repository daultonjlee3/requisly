-- Vendor contracts: lightweight supplier_contracts + private storage,
-- plus a workspace notification rule for upcoming renewal dates.

create table if not exists public.supplier_contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  title text not null,
  start_date date,
  renewal_date date,
  notes text,
  file_path text,
  file_name text,
  file_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.supplier_contracts is
  'Vendor contracts attached to a supplier. File lives in the supplier-contracts storage bucket.';
comment on column public.supplier_contracts.renewal_date is
  'End or renewal date. Notification rule fires when this date is within the lead window.';

create index if not exists supplier_contracts_workspace_idx
  on public.supplier_contracts (workspace_id);

create index if not exists supplier_contracts_supplier_idx
  on public.supplier_contracts (workspace_id, supplier_id);

create index if not exists supplier_contracts_renewal_idx
  on public.supplier_contracts (workspace_id, renewal_date)
  where renewal_date is not null;

drop trigger if exists supplier_contracts_touch_updated_at
  on public.supplier_contracts;
create trigger supplier_contracts_touch_updated_at
  before update on public.supplier_contracts
  for each row execute function public.touch_updated_at();

alter table public.supplier_contracts enable row level security;

drop policy if exists "supplier_contracts member access"
  on public.supplier_contracts;
create policy "supplier_contracts member access"
  on public.supplier_contracts for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'supplier-contracts',
  'supplier-contracts',
  false,
  52428800,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "supplier_contracts_storage_select" on storage.objects;
create policy "supplier_contracts_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'supplier-contracts');

drop policy if exists "supplier_contracts_storage_insert" on storage.objects;
create policy "supplier_contracts_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'supplier-contracts');

drop policy if exists "supplier_contracts_storage_update" on storage.objects;
create policy "supplier_contracts_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'supplier-contracts')
  with check (bucket_id = 'supplier-contracts');

drop policy if exists "supplier_contracts_storage_delete" on storage.objects;
create policy "supplier_contracts_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'supplier-contracts');

alter table public.notification_rules
  drop constraint if exists notification_rules_rule_type_check;
alter table public.notification_rules
  add constraint notification_rules_rule_type_check
  check (rule_type in (
    'po_not_confirmed',
    'shipment_delayed',
    'arriving_soon',
    'inventory_low',
    'inbound_reply_unparsed',
    'contract_renewal'
  ));

insert into public.notification_rules (workspace_id, rule_type, enabled, threshold_value)
select w.id, 'contract_renewal', true, 30
from public.workspaces w
where not exists (
  select 1
  from public.notification_rules r
  where r.workspace_id = w.id
    and r.rule_type = 'contract_renewal'
);

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
    (new_workspace_id, 'inventory_low', true, null),
    (new_workspace_id, 'contract_renewal', true, 30);

  return new;
end;
$$;
