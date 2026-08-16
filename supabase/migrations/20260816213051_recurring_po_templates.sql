-- Recurring POs: schedule lives on existing purchase_order_templates.
-- Cron creates draft POs only — never auto-sends.

alter table public.purchase_order_templates
  add column if not exists schedule_enabled boolean not null default false,
  add column if not exists schedule_kind text not null default 'off',
  add column if not exists schedule_interval integer not null default 1,
  add column if not exists schedule_day_of_month integer,
  add column if not exists schedule_lead_days integer not null default 7,
  add column if not exists schedule_next_run_on date,
  add column if not exists schedule_last_run_on date,
  add column if not exists schedule_last_po_id uuid references public.purchase_orders(id) on delete set null,
  add column if not exists schedule_last_error text;

alter table public.purchase_order_templates
  drop constraint if exists purchase_order_templates_schedule_kind_check;
alter table public.purchase_order_templates
  add constraint purchase_order_templates_schedule_kind_check
  check (schedule_kind in ('off', 'every_n_days', 'every_n_weeks', 'day_of_month'));

alter table public.purchase_order_templates
  drop constraint if exists purchase_order_templates_schedule_interval_check;
alter table public.purchase_order_templates
  add constraint purchase_order_templates_schedule_interval_check
  check (schedule_interval >= 1 and schedule_interval <= 365);

alter table public.purchase_order_templates
  drop constraint if exists purchase_order_templates_schedule_dom_check;
alter table public.purchase_order_templates
  add constraint purchase_order_templates_schedule_dom_check
  check (
    schedule_day_of_month is null
    or (schedule_day_of_month >= 1 and schedule_day_of_month <= 28)
  );

alter table public.purchase_order_templates
  drop constraint if exists purchase_order_templates_schedule_lead_check;
alter table public.purchase_order_templates
  add constraint purchase_order_templates_schedule_lead_check
  check (schedule_lead_days >= 0 and schedule_lead_days <= 60);

comment on column public.purchase_order_templates.schedule_enabled is
  'When true, cron drafts a PO on schedule_next_run_on. Never auto-sends.';
comment on column public.purchase_order_templates.schedule_lead_days is
  'Days before next_run_on to surface the upcoming draft on Today''s Work.';

create index if not exists purchase_order_templates_schedule_due_idx
  on public.purchase_order_templates (workspace_id, schedule_next_run_on)
  where schedule_enabled and status = 'active';

alter table public.purchase_orders
  add column if not exists source_template_id uuid
    references public.purchase_order_templates(id) on delete set null;

comment on column public.purchase_orders.source_template_id is
  'Template this PO was drafted from (manual use or recurring schedule).';

create index if not exists purchase_orders_source_template_idx
  on public.purchase_orders (workspace_id, source_template_id)
  where source_template_id is not null;
