-- Expand in-lane agents: Margin / Quality / Reorder / Documentation / Hygiene.
-- New insight_type values land on existing ai_insights (no new tables).
-- lead_time_days on supplier_products supports catalog hygiene (MOQ already exists).

alter table public.ai_insights
  drop constraint if exists ai_insights_agent_check;

alter table public.ai_insights
  add constraint ai_insights_agent_check
  check (
    agent = any (
      array[
        'operations'::text,
        'supplier'::text,
        'procurement'::text,
        'margin'::text,
        'quality'::text,
        'reorder'::text,
        'documentation'::text,
        'hygiene'::text
      ]
    )
  );

comment on table public.ai_insights is
  'In-lane agent outputs (Operations, Supplier, Procurement, Margin, Quality, Reorder, Documentation, Hygiene). Never auto-sends POs.';

alter table public.supplier_products
  add column if not exists lead_time_days integer;

comment on column public.supplier_products.lead_time_days is
  'Expected supplier lead time in days for this catalog SKU; null = incomplete catalog hygiene.';
