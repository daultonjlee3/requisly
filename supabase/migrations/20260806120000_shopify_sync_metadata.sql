-- Metadata for Shopify OAuth + catalog/inventory sync
alter table public.workspaces
  add column if not exists shopify_synced_at timestamptz;

comment on column public.workspaces.shopify_synced_at is
  'Last successful catalog/inventory sync from Shopify.';

alter table public.product_variants
  add column if not exists shopify_inventory_item_id text;

comment on column public.product_variants.shopify_inventory_item_id is
  'Shopify InventoryItem GID/numeric id used for inventory level reads/writes.';

create index if not exists product_variants_inventory_item_idx
  on public.product_variants (workspace_id, shopify_inventory_item_id)
  where shopify_inventory_item_id is not null;
