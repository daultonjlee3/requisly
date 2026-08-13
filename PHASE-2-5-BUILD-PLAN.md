# Requisly — Phase 2–5 Build Plan (Exploratory Build)

Companion to `PRODUCT-ROADMAP.md`, `PHASE-0-BUILD-PLAN.md`, `PHASE-1-BUILD-PLAN.md`, `DESIGN-STANDARD.md`.

## ⚠️ Read this before building anything in this doc

**None of the phase gates below have actually been met.** Per the roadmap: Phase 2 needs real completed-PO volume per supplier, Phase 3 needs Phase 2's data to already be trustworthy, Phase 4 needs repeated real customer requests, Phase 5 needs a pattern of $5M+ merchant demand. None of that evidence exists — there's no live Shopify connection and no real merchant has used this yet.

This doc exists so the founder can see the whole product vision built out for personal exploration — **not** as a plan to ship any of this to real customers. Two rules that follow from that:

1. **All data in Phase 2+ must be clearly flagged as demo/seed data**, isolated from anything a real customer could ever touch. Add a `is_demo boolean default false` column to `workspaces`, and every feature below should behave differently (or refuse to render real conclusions) for non-demo workspaces with insufficient real history. Don't let Cursor quietly fake data on a path a real customer could reach.
2. **Before any of this actually launches to real users**, re-verify the gates for real: Shopify OAuth live, real merchants onboarded, real churn/data-volume/revenue numbers checked against the actual thresholds in the roadmap. This doc is a "build it and see it" exercise, not a launch plan.

---

## Phase 2 — Analytics that summarize Purchase Orders

### Seed data first
Before building any analytics UI, seed a demo workspace with realistic completed-PO history: multiple suppliers, dozens of POs spanning weeks/months, varied on-time/late confirmations, occasional damaged/backorder receipts. This is what the scorecards will actually render against — build this seed script before the analytics features, not after.

```sql
alter table workspaces add column is_demo boolean not null default false;
```

### Schema
```sql
-- Scorecards are computed, not stored per-row — a view, not a table.
create view supplier_scorecards as
select
  s.id as supplier_id,
  s.workspace_id,
  count(po.id) filter (where po.status = 'closed') as completed_pos,
  avg(extract(epoch from (
    (select occurred_at from po_timeline_events where po_id = po.id and event_type = 'confirmed' limit 1))
    - (select occurred_at from po_timeline_events where po_id = po.id and event_type = 'sent' limit 1)
  )) / 86400 as avg_confirmation_days,
  avg(extract(epoch from (
    (select occurred_at from po_timeline_events where po_id = po.id and event_type = 'received' limit 1))
    - po.requested_ship_date::timestamptz
  )) / 86400 as avg_lead_time_variance_days,
  -- fill rate: received qty vs ordered qty across all lines, aggregated
  avg(rli.qty_received::float / nullif(pli.qty, 0)) as fill_rate
from suppliers s
left join purchase_orders po on po.supplier_id = s.id
left join po_line_items pli on pli.po_id = po.id
left join receipt_line_items rli on rli.po_line_item_id = pli.id
group by s.id, s.workspace_id;
```

**Empty-state rule, non-negotiable per the roadmap:** <cite index="1-1">"Needs a real minimum of completed POs per supplier before showing anything — the empty state says so plainly rather than fabricating a chart."</cite> Enforce this in the UI layer: if `completed_pos < 5` (pick a real threshold), show an explicit "not enough history yet" state, never a chart built on 1-2 data points dressed up as a trend.

### Features
- **Supplier scorecards** — on-time %, lead-time variance, fill rate, trend over time, per supplier.
- **Spend/cost analytics** — pure aggregation over `purchase_orders`/`po_line_items`, no new data model.
- **Demand forecasting** — genuinely hold this back even in the demo build. It's explicitly the hardest-to-fake piece — <cite index="1-1">"only once lead-time and fill-rate history is real and can't be replicated by a fresh competitor install"</cite> — a forecast built on seeded fake data would be actively misleading to look at, unlike a scorecard which is at least honestly labeled as demo. Build the UI shell with a permanent "coming once you have real order history" state instead of fake numbers.

---

## Phase 3 — AI insights

Depends entirely on Phase 2's data being real and trustworthy — in this demo build, that means depending on the *seeded* data instead, which is fine for seeing the UI but means the insights are only as good as the fake history you wrote.

### Approach
No new core tables beyond `ai_insights`. This is a read layer over Phase 2's scorecards + spend data, run through a **Claude Haiku** Messages API call to generate natural-language insights like the roadmap's own examples: <cite index="1-1">"Supplier A has been late on 6 of the last 10 orders,"</cite> <cite index="1-1">"Switch this SKU to Supplier B and save 8%."</cite>

Implementation (embedded `ai-agents.server.ts` + `ai-narration.server.ts`): structured facts are assembled from SQL first; Claude Haiku 4.5 narrates the merchant-facing summary. If `ANTHROPIC_API_KEY` is missing or the API fails/times out, the same deterministic template strings are used so insights never blank out. Draft PO suggestions still require merchant review and are never auto-sent.

```sql
create table ai_insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  insight_type text not null, -- 'supplier_risk' | 'cost_optimization' | 'reorder_pattern'
  supplier_id uuid references suppliers(id),
  summary text not null,
  supporting_data jsonb,
  generated_at timestamptz not null default now(),
  dismissed boolean not null default false
);
```

Generate on a schedule (weekly, via Edge Function) by feeding the supplier scorecard view + recent spend data into a prompt, storing structured results rather than generating fresh on every page load. Dashboard surfaces 2-3 undismissed insights, doesn't do a live chat interface — the roadmap frames this as summarized insight, not a chatbot.

---

## Phase 4 — Financial layer

### Schema
```sql
alter table suppliers add column payment_terms_default text; -- 'net_30' | 'deposit_50_balance_on_ship' | 'prepaid' etc, free text v1
alter table purchase_orders add column payment_terms text; -- nullable override of supplier default

create table payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  po_id uuid not null references purchase_orders(id),
  amount numeric(12,2) not null,
  rail text not null, -- 'ach' | 'card'
  status text not null default 'pending', -- 'pending' | 'completed' | 'failed'
  processor_reference text, -- Stripe payment intent ID, etc
  initiated_at timestamptz not null default now(),
  completed_at timestamptz
);
```

### Build with a real processor, even in the demo
Unlike Phase 2/3, don't fake this one with seed data — payments are exactly the feature where "does the integration actually work" matters more than seeing a UI. Use **Stripe Connect in test mode** (per our earlier conversation: cheaper and more controllable than an embedded Melio-style product, at the cost of requiring supplier account onboarding — worth trying Connect Express first and seeing whether that friction is real once you have actual suppliers). Stripe's test mode gives you real integration behavior — webhooks, payment intents, Connect account onboarding — without moving real money.

**Explicitly do not build:** in-house ACH origination, any custom ledger holding merchant funds before payout (this is the money-transmitter risk flagged earlier — route everything through Stripe's licensed infrastructure, even in test mode, so the architecture is correct from day one rather than needing rework later).

### Features
- Payment terms on Supplier (default) + PO (override) — matches the earlier conversation's model exactly.
- "Pay now" action on a received/closed PO, ACH or card via Stripe Connect.
- Outstanding balance view — POs with `payment_terms` set and no completed `payments` row past their due date.

---

## Phase 5 — Enterprise

### Schema
```sql
create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member', -- 'owner' | 'admin' | 'member' | 'viewer'
  invited_at timestamptz not null default now(),
  joined_at timestamptz
);

-- Multi-currency: purchase_orders.currency already exists from Phase 0 —
-- Phase 5 is really about exchange-rate handling and reporting in a home currency, not new fields.
create table exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency text not null,
  to_currency text not null,
  rate numeric(12,6) not null,
  as_of date not null
);
```

### Features
- Real roles/permissions (replacing Phase 0's placeholder `owner`/`member` on `profiles`) — gate actions like sending POs, approving payments, managing suppliers by role.
- Multi-company: a workspace can belong to a parent organization; `workspaces.parent_org_id`.
- Integrations (Slack, carriers, 3PLs, EDI) — each is its own Edge Function + webhook pair, build only the one you'd actually demo, not all of them speculatively.

**Honest note on this phase specifically:** the roadmap calls Phase 5 "a different business" on purpose. Even as an exploratory build, this is the phase most likely to just be scaffolding rather than something that feels real — there's no way to meaningfully demo "$5M+ merchant demand" logic without an actual $5M+ merchant. Treat this phase as the least valuable one to spend real time on if the goal is seeing the vision, versus Phases 2-4 which produce something genuinely explorable.

---

## Suggested build order for this exploratory pass

1. Demo data seed script (unblocks everything else)
2. Phase 2 — scorecards + spend analytics (forecasting stays a placeholder)
3. Phase 4 — payment terms + Stripe Connect test-mode integration (the one worth building "for real" even here)
4. Phase 3 — AI insights layer over Phase 2's (seeded) data
5. Phase 5 — pick one piece (roles/permissions is the most legitimately useful even pre-scale) rather than building all four sub-features

## Cursor kickoff prompt

> Read `@PRODUCT-ROADMAP.md` and `@PHASE-2-5-BUILD-PLAN.md`. This is an exploratory build — none of Phase 2-5's real gates have been met yet, so this is for seeing the product vision built out, not for shipping to real customers.
>
> Start by writing a seed script that populates a demo workspace (`is_demo = true`) with realistic fake purchase order history across several suppliers — varied confirmation times, some late shipments, a few damaged/backorder receipts — enough volume that Phase 2's supplier scorecards have something real to compute against.
>
> Then build Phase 2 (supplier scorecards, spend analytics) against that seeded data. Leave demand forecasting as a UI placeholder with a "coming once you have real order history" state — don't fake forecasting numbers, per the build plan.
>
> Enforce the empty-state rule: if a supplier has fewer than 5 completed POs, show an explicit "not enough history" state rather than rendering a chart.
>
> Stop after Phase 2 and show me before moving to Phase 4 (payments) — that one's worth reviewing carefully since it's the one piece in this plan meant to actually work, not just look real.
