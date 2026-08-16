-- Invoice amount for 3-way match (PO vs received qty vs invoiced).
-- No dedicated match table — comparison is computed in app code.
alter table public.purchase_orders
  add column if not exists invoice_amount numeric(12,2),
  add column if not exists invoice_submitted_at timestamptz,
  add column if not exists qb_pushed_at timestamptz;

comment on column public.purchase_orders.invoice_amount is
  'Supplier-invoiced amount entered for 3-way match / QuickBooks push.';
comment on column public.purchase_orders.invoice_submitted_at is
  'When the merchant recorded invoice_amount.';
comment on column public.purchase_orders.qb_pushed_at is
  'When the merchant pushed this PO toward QuickBooks (gated on 3-way match).';
