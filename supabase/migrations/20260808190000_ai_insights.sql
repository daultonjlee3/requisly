-- Phase 3 in-lane agents: stored insights (Operations / Supplier / Procurement).
-- No Orders API. Narrative is composed from existing PO / scorecard / pricing data.

create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent text not null check (agent in ('operations', 'supplier', 'procurement')),
  insight_type text not null,
  -- daily_digest | po_unopened | po_unconfirmed | shipment_late |
  -- alternate_supplier | price_increase | draft_po_suggestion
  supplier_id uuid references public.suppliers(id) on delete set null,
  po_id uuid references public.purchase_orders(id) on delete set null,
  summary text not null,
  body text,
  supporting_data jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  dismissed boolean not null default false
);

create index if not exists ai_insights_workspace_generated_idx
  on public.ai_insights (workspace_id, generated_at desc);

create index if not exists ai_insights_workspace_undismissed_idx
  on public.ai_insights (workspace_id, dismissed, insight_type)
  where dismissed = false;

comment on table public.ai_insights is
  'In-lane agent outputs (Operations digest, Supplier follow-ups, Procurement suggestions). Never auto-sends POs.';

alter table public.ai_insights enable row level security;

drop policy if exists "ai_insights member select" on public.ai_insights;
create policy "ai_insights member select"
  on public.ai_insights for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "ai_insights member update" on public.ai_insights;
create policy "ai_insights member update"
  on public.ai_insights for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Inserts/deletes are service-role only (agents / cron).
revoke insert, delete on public.ai_insights from authenticated;
grant select, update on public.ai_insights to authenticated;
grant all on public.ai_insights to service_role;
