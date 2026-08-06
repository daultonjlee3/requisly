# Requisly — Phase 1 Build Plan

Companion to `PHASE-0-BUILD-PLAN.md`, `PRODUCT-ROADMAP.md`, and `DESIGN-STANDARD.md`.

**Gate reminder:** per the roadmap, Phase 1 unlocks on sub-8% monthly churn on Phase 0 — real usage evidence, not a build milestone. This doc assumes that gate is being treated as passed for planning purposes; worth re-confirming that's genuinely true before shipping any of this to real users, not just before writing code.

**One sub-gate inside this phase:** Kanban view has its own condition independent of the churn gate — <cite index="1-1">"if List/Calendar usage suggests merchants want a pipeline view."</cite> That's usage-pattern evidence, not churn evidence. If you don't have List vs. Calendar usage data yet, Kanban is the piece of this plan most worth deferring even if the rest proceeds.

---

## 1. Notifications

**Scope (per roadmap):** PO not confirmed, shipment delayed, arriving tomorrow, inventory low. Email first — no in-app notification center in v1 of this feature.

### Schema additions

```sql
create table notification_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  rule_type text not null, -- 'po_not_confirmed' | 'shipment_delayed' | 'arriving_soon' | 'inventory_low'
  enabled boolean not null default true,
  threshold_value integer,  -- e.g. days-since-sent for po_not_confirmed, days-until-arrival for arriving_soon
  created_at timestamptz not null default now()
);

-- Prevents duplicate sends — check before sending, insert after
create table notification_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  rule_type text not null,
  po_id uuid references purchase_orders(id) on delete cascade,
  sent_at timestamptz not null default now(),
  recipient_email text not null
);

-- Needed for inventory_low — a per-product threshold, since Requisly
-- deliberately doesn't own reorder points/safety stock (explicitly cut, Phase 0 doc).
-- This is a blunt manual threshold, not demand forecasting.
alter table supplier_products add column low_stock_threshold integer;

-- Needed for arriving_soon — an explicit estimate rather than inferring one.
alter table purchase_orders add column estimated_arrival_date date;
```

**Why `estimated_arrival_date` is new:** the Phase 0 schema only has `requested_ship_date`. "Arriving tomorrow" needs an arrival estimate, which is a different thing — either typed in by the merchant when marking shipped, or (later) computed from supplier-level average lead time once Phase 2's scorecard data exists. For now, make it a simple optional field the merchant can set on the Supplier Link's "mark shipped" action or manually on the PO.

### Edge Function: `send-notifications`

Runs on a schedule (Supabase Cron, e.g. every hour). For each workspace with enabled rules:
- **po_not_confirmed:** PO status = `sent` and `sent_at` older than `threshold_value` days → email the merchant, not the supplier.
- **shipment_delayed:** status = `shipped`/`in_transit` and `estimated_arrival_date` has passed → email merchant.
- **arriving_soon:** `estimated_arrival_date` = tomorrow → email merchant.
- **inventory_low:** join `supplier_products.low_stock_threshold` against current Shopify inventory level (requires a inventory-level read — either a light Shopify Admin API poll here, or better, a webhook-driven cache table if that's already in place from Phase 0's Shopify sync).

Check `notification_log` before sending each one; insert after. Keep the email itself plain — a subject line and 2-3 sentences with a link back to the PO, matching the interface's plain-verb voice from the design standard, not a marketing template.

---

## 2. Kanban view

**No schema changes.** This is purely a third rendering of data that already exists — same as Calendar being "a view toggle on Purchase Orders... same underlying data" per the roadmap's own architecture section.

- Columns = `po_status` values, in golden-workflow order.
- Cards = the same PO summary already used in List view rows (PO #, supplier, total, chip).
- Drag-and-drop between columns is tempting but **skip it for v1 of this view** — dragging a card implies directly setting status, which bypasses the actual state machine (e.g., you can't drag into "Received" without an actual receipt existing). Make it read-only, click-through to PO Detail like every other view.

**Before building this at all:** check whatever analytics/usage tracking exists on the List/Calendar toggle usage. If there's no data because no one's using the app yet, this is the one piece of Phase 1 worth genuinely deferring rather than assuming-the-gate-passed for.

---

## 3. Supplier Link v2

The heaviest piece of this phase — a real new interaction pattern, not just an added field.

### What's new
- Supplier can **reject** a PO outright (not just confirm).
- Supplier can **propose changes** to specific line items (quantity, and optionally cost) rather than only confirming as-is.
- Merchant reviews proposals and accepts or rejects each one; accepting updates the PO's actual line items and totals.

### Schema additions

```sql
-- Rejection is a new terminal state, distinct from the golden workflow's Closed.
alter type po_status add value 'rejected';

create table po_line_item_proposals (
  id uuid primary key default gen_random_uuid(),
  po_line_item_id uuid not null references po_line_items(id) on delete cascade,
  proposed_qty integer,
  proposed_unit_cost numeric(12,2),
  note text,
  status text not null default 'pending', -- 'pending' | 'accepted' | 'rejected'
  proposed_by text not null default 'supplier',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
```

**Deliberately not building:** a message thread between merchant and supplier attached to proposals. The roadmap is explicit that Communication Center is a second product surface, not a Phase 1 add — a proposal's `note` field is the entire "communication" v2 supports. If that feels thin once real suppliers use it, that's exactly the kind of evidence that would justify Communication Center later — not a reason to build it preemptively now.

### Edge Function updates

- `supplier-link-action` (from Phase 0) needs new action types: `reject` (writes a `rejected` timeline event, terminal — no further Supplier Link actions should be accepted after this) and `propose_changes` (inserts one or more `po_line_item_proposals` rows, PO status stays at `sent`/`viewed` — proposing isn't itself a status transition).
- New function or extension: `resolve-proposal` — merchant-facing, accepts or rejects a single proposal. On accept: update the corresponding `po_line_items` row's `qty`/`unit_cost`, recalculate `line_total` and the PO's `subtotal`/`total`, mark proposal `accepted`. On reject: mark `rejected`, no change to the line item.

### UI additions
- Supplier Link (`supplier-link.html` in Phase 0) needs a per-line "propose different quantity/cost" affordance and a reject action, alongside the existing confirm/mark-shipped flow.
- PO Detail needs a "Pending proposals" panel when any exist — this is new surface area, not present in the Phase 0 prototype, so it needs actual design work against `DESIGN-STANDARD.md` (likely a chip variant + inline accept/reject buttons in the line items table) rather than having a ready-made reference screen to build from.

---

## 4. Build order

1. **Kanban view** — cheapest, no schema risk, and forces you to actually check the usage-data question before building it for real.
2. **Notifications** — schema + Edge Function + email wiring. Self-contained, doesn't touch the core PO/timeline logic.
3. **Supplier Link v2** — last, because it's the only piece that changes the golden workflow's terminal states (`rejected`) and touches money (`unit_cost`/totals recalculation) — the highest-stakes change in this phase, worth having the other two done and stable first.

---

## 5. Cursor kickoff prompt

> Read `@PRODUCT-ROADMAP.md`, `@PHASE-0-BUILD-PLAN.md`, and `@PHASE-1-BUILD-PLAN.md`. Phase 0 is built and working. We're now starting Phase 1, following the build order in Section 4 of the Phase 1 plan: Kanban view first, then Notifications, then Supplier Link v2 last.
>
> Start with **Kanban view only** — group existing purchase orders by status into columns matching the golden workflow order, read-only (no drag-and-drop), reusing the existing PO summary card styling. Don't touch Notifications or Supplier Link v2 yet.
>
> I don't have Supabase MCP connected — write any schema changes as migration files for me to run manually, don't try to execute them directly.
