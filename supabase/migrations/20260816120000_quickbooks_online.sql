-- QuickBooks Online: OAuth credentials (service-role only), mapping settings,
-- remembered vendor/item maps, and the Bill ID stored on the PO after a push.

alter table public.purchase_orders
  add column if not exists qb_bill_id text,
  add column if not exists qb_last_error text;

comment on column public.purchase_orders.qb_bill_id is
  'QuickBooks Online Bill Id returned by the Accounting API after a successful push.';
comment on column public.purchase_orders.qb_last_error is
  'Last QuickBooks push failure message; cleared on success.';

create table if not exists public.workspace_quickbooks_credentials (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  realm_id text not null,
  connected_at timestamptz not null default now(),
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  company_name text,
  status text not null default 'connected'
    check (status in ('connected', 'reconnect_needed')),
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists workspace_quickbooks_credentials_realm_id_idx
  on public.workspace_quickbooks_credentials (realm_id);

comment on table public.workspace_quickbooks_credentials is
  'QuickBooks Online OAuth tokens. Service-role only — never expose via PostgREST to browsers.';

alter table public.workspace_quickbooks_credentials enable row level security;
revoke all on public.workspace_quickbooks_credentials from public, anon, authenticated;
grant all on public.workspace_quickbooks_credentials to service_role;

create table if not exists public.workspace_quickbooks_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  mapping_mode text not null default 'account'
    check (mapping_mode in ('account', 'item')),
  default_expense_account_id text,
  default_expense_account_name text,
  updated_at timestamptz not null default now()
);

comment on table public.workspace_quickbooks_settings is
  'Workspace-level QuickBooks push defaults. mapping_mode is the default for catalog lines; preview can still mix Item vs Account per line. Free-text lines always post to the default expense account.';
comment on column public.workspace_quickbooks_settings.mapping_mode is
  'account (zero-setup expense/COGS account) | item (confirm-or-create QBO items).';

alter table public.workspace_quickbooks_settings enable row level security;

drop policy if exists "workspace_quickbooks_settings member access"
  on public.workspace_quickbooks_settings;
create policy "workspace_quickbooks_settings member access"
  on public.workspace_quickbooks_settings for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.workspace_quickbooks_settings to authenticated;
grant all on public.workspace_quickbooks_settings to service_role;

create table if not exists public.supplier_quickbooks_vendors (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  qbo_vendor_id text not null,
  qbo_vendor_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, supplier_id)
);

comment on table public.supplier_quickbooks_vendors is
  'Confirmed Requisly supplier → QuickBooks Vendor mapping. Stored after first successful match or create.';

alter table public.supplier_quickbooks_vendors enable row level security;

drop policy if exists "supplier_quickbooks_vendors member access"
  on public.supplier_quickbooks_vendors;
create policy "supplier_quickbooks_vendors member access"
  on public.supplier_quickbooks_vendors for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.supplier_quickbooks_vendors to authenticated;
grant all on public.supplier_quickbooks_vendors to service_role;

create table if not exists public.product_quickbooks_items (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_product_id uuid not null references public.supplier_products(id) on delete cascade,
  qbo_item_id text not null,
  qbo_item_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, supplier_product_id)
);

comment on table public.product_quickbooks_items is
  'Confirmed catalog product → QuickBooks Item mapping. Remembered after first confirm-or-create.';

alter table public.product_quickbooks_items enable row level security;

drop policy if exists "product_quickbooks_items member access"
  on public.product_quickbooks_items;
create policy "product_quickbooks_items member access"
  on public.product_quickbooks_items for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.product_quickbooks_items to authenticated;
grant all on public.product_quickbooks_items to service_role;
