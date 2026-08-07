-- Multiple contacts per supplier. Primary contact stays mirrored on
-- suppliers.email / contact_name / phone for PO send + list compatibility.

create table if not exists public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  title text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplier_contacts_supplier_id_idx
  on public.supplier_contacts (supplier_id);

create index if not exists supplier_contacts_workspace_id_idx
  on public.supplier_contacts (workspace_id);

-- At most one primary contact per supplier
create unique index if not exists supplier_contacts_one_primary_idx
  on public.supplier_contacts (supplier_id)
  where is_primary;

drop trigger if exists supplier_contacts_touch_updated_at on public.supplier_contacts;
create trigger supplier_contacts_touch_updated_at
  before update on public.supplier_contacts
  for each row execute function public.touch_updated_at();

alter table public.supplier_contacts enable row level security;

drop policy if exists "supplier_contacts member access" on public.supplier_contacts;
create policy "supplier_contacts member access"
  on public.supplier_contacts for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Backfill one primary contact from legacy supplier columns
insert into public.supplier_contacts (
  workspace_id,
  supplier_id,
  name,
  email,
  phone,
  is_primary
)
select
  s.workspace_id,
  s.id,
  coalesce(nullif(trim(s.contact_name), ''), s.name),
  s.email,
  s.phone,
  true
from public.suppliers s
where not exists (
  select 1
  from public.supplier_contacts c
  where c.supplier_id = s.id
);
