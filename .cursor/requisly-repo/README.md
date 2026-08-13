# Requisly

A supplier-ops / purchase-order platform for Shopify brands. The Purchase Order is the primary object — everything else (suppliers, documents, timeline, receiving, analytics) hangs off it. See `PRODUCT-ROADMAP.md` *(add your renamed roadmap doc here — see note below)* for the full product vision and phase gates.

## Repo structure

```
/design/                  ← Visual + UX reference. READ-ONLY — don't build on these files directly.
  *.html                    Static HTML prototypes of every Phase 0 screen
  DESIGN-STANDARD.md        Design tokens, components, and rules for how the app should look
  assets/styles.css         The actual CSS these prototypes use — source of truth for color/type/spacing

PHASE-0-BUILD-PLAN.md     ← Supabase schema, RLS approach, Edge Functions, and the milestone build order
```

## Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind — theme config derived from `design/assets/styles.css`
- **Backend:** Supabase (Postgres, Auth, Storage, RLS, Edge Functions)
- **Hosting:** Vercel (frontend) + Supabase Edge Functions (anything Shopify-facing — OAuth, webhooks, inventory write-back). See `PHASE-0-BUILD-PLAN.md` §1.5 for why this split is deliberate.

## Getting started

1. Run the `workspaces` and `profiles` table SQL from `PHASE-0-BUILD-PLAN.md` §2 directly in the Supabase SQL editor.
2. Grab your Supabase Project URL + anon key from Project Settings → API.
3. In Cursor, point it at this repo and reference `@PHASE-0-BUILD-PLAN.md` and `@design/DESIGN-STANDARD.md` to start Milestone 1.

## ⚠️ Before you commit

This README references a `PRODUCT-ROADMAP.md` that isn't included in this package — the original roadmap doc still says "Supplierly" throughout (it predates the rename). Do a find-and-replace on your copy, drop it in at the repo root, and it'll all line up.
