-- Audit log for Shopify mandatory compliance webhooks (GDPR / privacy).
-- Not workspace-scoped: shop/redact deletes the workspace, but we keep the receipt.

create table if not exists public.compliance_events (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null,
  topic text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists compliance_events_shop_domain_idx
  on public.compliance_events (shop_domain, created_at desc);

alter table public.compliance_events enable row level security;

-- Service role only — no authenticated merchant access needed for App Store compliance logs.
drop policy if exists "compliance_events no direct access" on public.compliance_events;
create policy "compliance_events no direct access"
  on public.compliance_events for all to authenticated
  using (false)
  with check (false);
