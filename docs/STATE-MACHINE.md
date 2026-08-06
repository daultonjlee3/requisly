# PO state machine (Phase 0) — authoritative decisions

These override any incomplete wording in the design prototypes or roadmap timeline lists.

## Timeline order

`draft` → `sent` → `viewed` → `confirmed` → `production` → `shipped` → `in_transit` → `partially_received` → `received` → `closed`

(`draft` is pre-send; the merchant-facing timeline spine starts at Created once the PO exists.)

**Alternate terminal (Phase 1):** `rejected` — supplier rejects from Sent/Viewed via Supplier Link. Distinct from `closed`. No further Supplier Link actions (confirm, propose, ship) are accepted after rejection.

## Rules

1. **Production** is a real `po_status` value in v1. In the UI it is skippable/optional (dashed node). Merchants may advance past it without recording Production. Not deferred to a later phase.

2. **Viewed** is system-triggered only. It fires the first time the supplier opens their Supplier Link. Merchants never set Viewed manually.

3. **Closed** happens two ways:
   - **Auto:** when received qty meets ordered qty across all lines (full receipt).
   - **Manual:** "Close PO" from `partially_received`, for permanent shortfalls the merchant decides aren't coming.

4. **Inventory writes** on receiving go to the Shopify location selected on the PO at creation (`location_id`), defaulting to the primary Shopify location if there is only one. No multi-warehouse logic beyond that field.

5. **Line proposals (Phase 1):** supplier may propose qty/cost changes while status is `sent` or `viewed`. Proposing is not a status transition. Merchant accept updates line + PO totals; reject leaves the line unchanged. Note field only — no chat thread.
