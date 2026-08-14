-- Merchant onboarding progress flags on workspaces (no new tables).
-- Checklist completion itself is derived from suppliers / PO sends.

alter table public.workspaces
  add column if not exists onboarding jsonb not null default '{}'::jsonb;

comment on column public.workspaces.onboarding is
  'Onboarding UI state: welcome_completed_at, checklist_skipped_at, first_po_celebrated_at, guide_dismissed_at, last_nudge_at, stalled_at.';
