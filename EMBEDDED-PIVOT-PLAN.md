# Requisly — Embedded App Architecture Pivot

Companion to `PRODUCT-ROADMAP.md`, `PHASE-0-BUILD-PLAN.md`, `DESIGN-STANDARD.md`. This documents a deliberate decision: build to Shopify's actual App Store spec (embedded, GraphQL Admin API, App Bridge, Polaris) before pursuing further distribution, even though it costs the Stocky-shutdown timing window. Speed was the alternative; quality was chosen.

---

## 1. What survives untouched

The real intellectual work of this product is backend/schema/business logic, and none of it is Shopify-framework-specific:

- **Entire Postgres schema** — `purchase_orders`, `po_timeline_events`, `receipts`, `receipt_line_items`, `supplier_products`, `supplier_product_prices`, `workspace_members`, `notification_rules`, everything.
- **RLS policies.**
- **All Edge Functions except two** — `supplier-link-action`, `complete-receiving`, `send-po-email`, `send-notifications`, `resolve-proposal` all stay exactly as built.
- **Supplier Link, in full — design and all.** `supplier-link.html`'s Manifest & Stamp design, the no-login token pattern, confirm/reject/mark-shipped/propose-changes. Suppliers never see Shopify Admin, so nothing here needs to change for this pivot.
- **Onboarding's OAuth token exchange logic** (the concept, not the REST calls) — still applies, just via GraphQL and Shopify's managed installation flow instead of a custom `/onboarding` page.

## 2. What needs real rework

- **`shopify-oauth-callback` and `shopify-sync-catalog`** — REST calls become GraphQL Admin API calls. Contained, but real work.
- **Frontend framework** — this is the big one. Shopify's supported, well-tooled path for embedded apps is the **Remix app template** (`@shopify/shopify-app-remix`), which handles session token auth, App Bridge wiring, and GraphQL client setup out of the box. Bolting App Bridge onto the existing Next.js app is possible but fights the tooling at every step — given the goal is "build it how they say," move to the template they actually recommend rather than a workaround.
- **Auth model** — this changes fundamentally, not just cosmetically. Embedded apps authenticate merchants via **session tokens** issued through App Bridge, validated by your app backend on every request — not a standalone email/password screen. On install, the shop's Shopify domain becomes the identity; you create/link a `workspace` + `profile` row keyed to that domain automatically, no separate signup flow. Supabase Auth's role shifts to backend authorization/RLS, not merchant-facing login.
- **Merchant-facing UI — the real design tension.** Every merchant-facing screen (Dashboard, PO List/Detail, Suppliers, Products, Receiving, Analytics, Calendar, Notifications) needs to run inside the Shopify Admin iframe using **Polaris** components and follow Shopify's embedded UX guidelines. This is not a reskin — it's a real design decision about what happens to Manifest & Stamp.

## 3. The Manifest & Stamp question — decided: Option A, full Polaris adoption

Given real, unresolved ambiguity in Shopify's own developer community about how much custom design an embedded app can get away with — including at least one confirmed rejection precedent for non-Polaris UI — the decision is to not fight it: **every merchant-facing screen gets rebuilt with Polaris components.** Cards, tables, badges, buttons, and the PO Detail timeline all become Polaris-native. No custom color palette, mono type system, or stamp badge in the embedded app.

This is the safest path to approval and Built for Shopify eligibility, and it removes the ambiguity entirely rather than betting weeks of work on an unclear line between "acceptable custom component" and "rejected for not using Polaris." The tradeoff, named plainly: the merchant-facing app loses its visual distinctiveness and will look like a well-built, generic Shopify app rather than a recognizably "Requisly" one.

**What this does NOT touch:** the Supplier Link. Suppliers never see Shopify Admin, so `supplier-link.html`'s full Manifest & Stamp design — the timeline, the stamp badge, the whole identity — stays exactly as built. The brand isn't gone, it's just scoped to the one surface that was always going to be seen outside Shopify's frame anyway.

---

## 4. Migration order

1. **Scaffold the Remix app** alongside the existing Next.js app — don't delete anything yet. `npm init @shopify/app@latest` with the Remix template gives you working OAuth, session tokens, and App Bridge wiring immediately. ✅ Done in `/embedded` (Shopify Remix template + Polaris placeholder). Run `cd embedded && npm run dev` / `shopify app config link` to connect your Partner app + store.
2. **Rewrite Shopify OAuth + catalog sync using GraphQL**, inside the new Remix app's structure. ✅ GraphQL catalog sync in `embedded/app/lib/shopify-sync.server.ts` (locations / products / inventory). OAuth is handled by `@shopify/shopify-app-remix`.
3. **Auth bridge** — on install, create/link `workspace`/`profile` by shop domain automatically. This replaces the standalone login screen for the embedded surface entirely (Supplier Link's auth model is untouched — different surface, different rules). ✅ `ensureWorkspaceForShop` links by `shopify_domain`, claims the sole unclaimed non-demo workspace when present, upserts `workspace_shopify_credentials`. Merchant identity is the shop (service-role data access); Supabase Auth profiles remain for the Next.js / staff path.
4. **Port Dashboard first** (natural starting point — it's the landing screen post-install) fully to Polaris, to validate the pattern before committing across all screens. ✅ `/app` is Today's Work (Polaris).
5. **Port the rest of the merchant-facing screens** — PO List, PO Detail (the timeline becomes a Polaris-native progress/status treatment here — no custom component), Suppliers, Products, Receiving, Analytics, Calendar, Notifications. ✅ Merchant surface in Polaris: Dashboard, POs (list/detail/new/receive/send/close), Suppliers, Products (+ price schedule), Calendar, Analytics, Notifications. Supplier Link public UI stays on Next.js `/s/:token`.
6. **Decommission the old Next.js merchant-facing routes** once parity is confirmed. Supplier Link routes are unaffected and can stay wherever they currently live, or move into the same repo as a non-embedded route — your call, it's cosmetic at that point.
7. **Submit for App Store review** once GraphQL-only, embedded, and Polaris-compliant (per whichever of A/B/C was chosen).

## 5. Cursor kickoff prompt

> We're pivoting Requisly's merchant-facing app to Shopify's actual embedded-app spec: Remix, App Bridge, GraphQL Admin API, full Polaris. Read `@PRODUCT-ROADMAP.md`, `@PHASE-0-BUILD-PLAN.md`, `@DESIGN-STANDARD.md`, and this doc (`@EMBEDDED-PIVOT-PLAN.md`).
>
> Design decision, already made — don't revisit it: every merchant-facing screen gets rebuilt with standard Polaris components, no custom design system, no exceptions (including the PO Detail timeline — that becomes a Polaris-native treatment, not a custom component). We're deliberately not fighting Shopify's review process on this.
>
> Important: the Supplier Link (`@design/supplier-link.html` and its live implementation) does NOT change — suppliers never see Shopify Admin, that surface stays exactly as built, full custom design intact. This pivot is scoped to the merchant-facing app only.
>
> Start with **Migration step 1 only**: scaffold a new Remix app using `@shopify/shopify-app-remix`, alongside the existing Next.js app — don't delete or modify the existing app yet. Get OAuth, session token auth, and App Bridge working with a minimal placeholder screen, connected to my real dev store. Don't port any real features yet.
>
> Once that's running, port Dashboard first, fully in Polaris, then the rest of the merchant-facing screens per Section 4's order.
>
> You have Supabase MCP connected — no schema changes needed for this step, the existing schema stays as-is.
