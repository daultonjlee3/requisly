Requisly — Product Roadmap

Product Vision

Requisly is where Shopify brands run purchasing.

Not a document generator. Not a dashboard. The place a merchant and their suppliers actually transact — from the moment inventory is decided on, through confirmation, shipping, and receiving.

Design Philosophy
One golden workflow, and everything serves it. Create → Send → Supplier Confirms → Shipment Updates → Receive → Inventory Updates.
One primary object. The Purchase Order. Every other piece of the product — suppliers, timeline, documents, shipment, receiving, analytics — hangs off a PO rather than existing as an independent module. The product should feel the way JobTread revolves around a Job: one spine, everything attached to it, nothing floating free.
Not an ERP. Every feature answers: does this directly improve creating, sending, confirming, shipping, receiving, or analyzing a Purchase Order? If not, it's removed, deferred, or has to earn its place with a stated reason.
Evidence gates ambition. Every phase past 0 unlocks on usage, retention, or a named customer request — never on calendar time or a feeling that it's "time" for the next phase.
Positioning: a supplier operations platform, not a PO app. Internally the wedge is narrow on purpose — that discipline is what makes v1 shippable. Externally, and in every product decision about what the PO object connects to, the ambition is to own supplier collaboration, not just generate documents.
The Golden Workflow
Created → Sent → Viewed → Confirmed → Production → Shipped
→ In Transit → Partially Received → Received → Closed

This is the timeline every PO carries, and it's the primary UX pattern across the app — not just a status badge, but a visible spine on every PO detail screen, and the thing the Dashboard, Calendar, and Analytics all summarize.

(Production and In Transit are optional states a merchant can skip through if their supplier doesn't report at that granularity — the timeline shouldn't demand precision a merchant doesn't have.)

Product Architecture
Purchase Order  (the primary object)
  → Supplier
  → Products (line items)
  → Timeline
  → Documents (attached, not a standalone library)
  → Supplier Link (confirmation, shipment updates)
  → Receiving (completes the PO)
  → Analytics (summarizes POs — never a separate data model)

Calendar = a view of Purchase Orders (List / Calendar / Timeline)
Notifications = triggered by Purchase Order state changes

Nothing in this architecture is a standalone module competing with the PO for primacy. Suppliers exist to be attached to POs. Documents exist to be attached to POs. Calendar is a lens on POs, not a second data set.

Phase 0 — v1: One complete workflow

Goal: create → send → supplier confirms → ships → receive → Shopify inventory updates, end to end, dramatically faster than a spreadsheet.

Build time: ~14–16 weeks (revised up slightly from 14 to account for the timeline state machine and document attachments below — both real, both worth the extra time, neither worth skipping).

Shopify integration

OAuth, product/variant sync, inventory sync, locations.

Suppliers

Name and email required. Everything else — contact, address, terms, currency, notes — optional and captured progressively through use. Never a setup wizard.

Products / supplier catalog

Per-supplier SKU mapping, accumulated one PO line at a time. Unit cost, case quantity, MOQ learned through repeat orders. Lead time always derived from timeline timestamps, never typed.

Purchase orders — the primary object
Create, edit, duplicate (hero feature — the flow is duplicate → adjust quantities → send → done, and it should take under a minute)
Free-text line items for anything outside the Shopify catalog — the flexibility clause that keeps merchants out of Excel
Timeline on every PO: Created → Sent → Viewed → Confirmed → Shipped → In Transit → Partially Received → Received → Closed
Documents attached to the PO — quotes, invoices, packing slips, photos. Simple upload-and-attach, not a document library with its own search and versioning. Scoped to "lives on this PO," full stop.
PDF generation, branded, one email format

Deliberately cut: templates, approval workflows, bulk ordering, multi-currency. Real eventually; not required for the loop.

Supplier Link (renamed from "Supplier Portal")

No login. Secure magic link, mobile-friendly. The supplier opens it and updates the order — that's the entire interaction model.

v1 scope, deliberately minimal: confirm or adjust ship date, mark shipped, add tracking. This is what advances the PO through Viewed → Confirmed → Shipped on the timeline using the supplier's own input instead of the merchant's guess — which is what makes the eventual scorecard trustworthy.

Not in v1: accept/reject, line-level quantity negotiation, chat. A second, heavier interaction pattern on a feature that's already unproven — held for v2, once real usage shows whether suppliers engage with the simple version at all.

Enhancement, never dependency. Expect 30-40% supplier participation. The merchant-side flow works completely without it.

Receiving — completes the PO

Partial and full receiving, multiple receipts against one PO, damaged/wrong-item/backorder handling with mandatory reason codes, auto-write to Shopify inventory. This is what moves the timeline to Received → Closed.

Dashboard — "Today's Work," not business intelligence
POs waiting for confirmation
Shipments arriving today
Inventory to receive today
Suppliers overdue
Recent supplier updates

An operational command center for one day, not a reporting surface. If a tile requires more than a glance to parse, it belongs in Phase 2, not here.

Calendar

A view toggle on Purchase Orders — List / Calendar / Timeline, same underlying data. Not a separate module, not separate work beyond the view itself.

Explicitly cut from Phase 0: demand forecasting, reorder recommendations, safety stock, ABC analysis, multi-warehouse, Tasks, notifications beyond PO/receiving state changes, standalone document management, AI anything.

Phase 1 — Deepen the golden workflow (gated by sub-8% monthly churn on Phase 0)

The workflow gets richer before the product gets wider.

Notifications — PO not confirmed, shipment delayed, arriving tomorrow, inventory low. Email first.
Kanban view — a third lens on the same PO data, if List/Calendar usage suggests merchants want a pipeline view.
Supplier Link v2 — accept/reject and line-level quantity negotiation, but only once v1's simple confirm-and-ship-date usage shows suppliers actually open the link.

Gate: retention, not installs. A workspace built around a loop merchants aren't sticking with is wasted effort.

Deliberately deferred: Tasks as a real feature (assignment, due dates, recurrence) — the useful half is already the Dashboard's "needs attention" section, and the rest is project management, not procurement. Communication Center / threaded messaging — a real request, but a second product surface, not a phase-1 add.

Phase 2 — Analytics that summarize Purchase Orders (gated by data volume, not calendar time)

This is the pricing lever. A PO tool alone is admin work; this is what makes it a money conversation.

Supplier scorecards — on-time %, lead-time variance (now sourced from real Supplier Link confirmations, not merchant guesses), fill rate, trend over time. Needs a real minimum of completed POs per supplier before showing anything — the empty state says so plainly rather than fabricating a chart.
Spend and cost analytics — a summarization layer over existing PO data, not a new data model.
Demand forecasting — only once lead-time and fill-rate history is real and can't be replicated by a fresh competitor install. This is the actual moat, and it doesn't exist before this phase has run for months.

Phase 3 — AI (gated by Phase 2 data being genuinely rich, evaluate at $1M+ ARR)

"Supplier A has been late on 6 of the last 10 orders." "Switch this SKU to Supplier B and save 8%."

Every one of these claims requires Phase 2's scorecard and cost data to already exist and be trustworthy. Built earlier, it's a generic AI wrapper with nothing behind it — the exact commodity "AI insights" pattern every competitor already has. The differentiation lives entirely in the data, not the model.

Phase 4 — Financial layer (gated by explicit, repeated customer request only)
Net terms tracking, payment reminders, outstanding balances. Payment terms live on the Supplier as a default (Net 30, deposit + balance, prepaid, etc.), inherited silently by every PO unless a specific order needs an override.
ACH and card payments — only ever through a third-party processor, never built in-house. A compliance and liability surface a solo founder shouldn't own directly, regardless of demand. Leading candidates to evaluate when this phase is actually triggered: Stripe Connect (cheaper, more control, but requires suppliers to complete account onboarding/KYC — real friction for smaller suppliers) vs. an embedded Melio-style vendor-payment product (some per-transaction fee overhead, but suppliers receive payment with zero account creation required). Worth validating with real suppliers which friction they'll actually tolerate before committing to either.
Accounting integrations (QuickBooks, Xero)

Phase 5 — Enterprise (only if inbound demand from $5M+ merchants becomes a pattern)

Team management, roles/permissions, advanced integrations (Slack, carriers, 3PLs, EDI), multi-company/multi-currency.

This is a different business. A $5M+ buyer is likely evaluating an ERP already. Following customers upmarket should be a deliberate choice made on evidence, not scope creep dressed as ambition.

What is intentionally NOT being built

A standalone document management module. A general-purpose calendar. A task/project-management system. A communication/chat platform. A rules/automation engine. Payments built in-house. Enterprise permissioning. Any feature whose primary object is not, in some direct way, a Purchase Order.

Every one of these is a reasonable product on its own. None of them is this product, until a phase gate says otherwise.
