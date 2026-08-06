-- Capture Shopify variant image + retail price (synced later via OAuth catalog sync).
alter table public.product_variants
  add column if not exists image_url text,
  add column if not exists retail_price numeric(12,2);

comment on column public.product_variants.image_url is
  'Shopify product/variant image URL. Null until catalog sync runs.';
comment on column public.product_variants.retail_price is
  'Shopify variant retail price (selling price). Null until catalog sync runs.';
