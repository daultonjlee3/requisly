-- Install claiming: shop_domain is the identity key.
-- workspaces.shopify_domain is already UNIQUE (20260805120000).
-- Mirror domain onto credentials (partial unique) so two workspaces cannot
-- hold live credentials for the same shop. Column stays nullable so the
-- legacy Edge OAuth upsert (out of scope) does not hard-fail mid-pivot.

alter table public.workspace_shopify_credentials
  add column if not exists shopify_domain text;

update public.workspace_shopify_credentials c
set shopify_domain = w.shopify_domain
from public.workspaces w
where c.workspace_id = w.id
  and c.shopify_domain is null
  and w.shopify_domain is not null;

create unique index if not exists workspace_shopify_credentials_shopify_domain_uidx
  on public.workspace_shopify_credentials (shopify_domain)
  where shopify_domain is not null;

comment on column public.workspace_shopify_credentials.shopify_domain is
  'Shopify shop domain this offline token belongs to. Unique when set — prevents two workspaces from holding credentials for the same shop.';
