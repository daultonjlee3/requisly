-- Dedup key for non-PO notifications (inventory_low per variant, etc.).
-- po_id stays FK to purchase_orders and cannot hold variant UUIDs.
alter table public.notification_log
  add column if not exists dedupe_key text;

comment on column public.notification_log.dedupe_key is
  'Stable id for non-PO alerts, e.g. inventory_low:<product_variant_id>. Used with rule_type + recipient for dedup.';

create index if not exists notification_log_dedupe_idx
  on public.notification_log (workspace_id, rule_type, dedupe_key, recipient_email)
  where dedupe_key is not null;

-- Phase 1 column (may already exist in prod); per-SKU reorder threshold.
alter table public.supplier_products
  add column if not exists low_stock_threshold integer;

comment on column public.supplier_products.low_stock_threshold is
  'Optional per-product reorder point. When null, workspace inventory_low rule threshold (or default 5) applies.';
