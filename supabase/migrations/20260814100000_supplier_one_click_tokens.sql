-- One-click supplier email actions (confirm as-is / mark shipped).
-- Redeemed via Next.js /a/:token; writes through the same supplier_link_* RPCs.

create table if not exists public.supplier_one_click_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  token text not null unique,
  action text not null check (action in ('confirm_as_is', 'mark_shipped')),
  -- Locked ship date at email send time for confirm_as_is (never re-read mutable PO fields at click).
  ship_date date,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists supplier_one_click_tokens_po_idx
  on public.supplier_one_click_tokens (po_id, created_at desc);

create index if not exists supplier_one_click_tokens_unused_idx
  on public.supplier_one_click_tokens (token)
  where used_at is null;

alter table public.supplier_one_click_tokens enable row level security;

-- Merchants never touch these directly; service_role redeems them.
revoke all on public.supplier_one_click_tokens from authenticated, anon;
grant all on public.supplier_one_click_tokens to service_role;

comment on table public.supplier_one_click_tokens is
  'Single-use expiring tokens for PO email one-click confirm/ship. Redeemed server-side; call same supplier_link_* RPCs as the full Supplier Link.';
