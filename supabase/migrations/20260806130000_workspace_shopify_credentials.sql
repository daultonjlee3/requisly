-- Keep access tokens off the member-readable workspaces row.
create table if not exists public.workspace_shopify_credentials (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  access_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.workspace_shopify_credentials enable row level security;
-- No policies for authenticated/anon — only service_role (bypasses RLS) can access.
revoke all on public.workspace_shopify_credentials from public, anon, authenticated;
grant all on public.workspace_shopify_credentials to service_role;

comment on table public.workspace_shopify_credentials is
  'Shopify Admin API access tokens. Service-role only — never expose via PostgREST to browsers.';

insert into public.workspace_shopify_credentials (workspace_id, access_token)
select id, shopify_access_token
from public.workspaces
where shopify_access_token is not null
on conflict (workspace_id) do update
  set access_token = excluded.access_token,
      updated_at = now();

update public.workspaces set shopify_access_token = null where shopify_access_token is not null;

comment on column public.workspaces.shopify_access_token is
  'DEPRECATED — tokens live in workspace_shopify_credentials (service-role only).';