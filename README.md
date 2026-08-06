# Requisly

Purchase-order platform for Shopify brands. The Purchase Order is the primary object — suppliers, documents, timeline, receiving, and analytics hang off it.

See `PRODUCT-ROADMAP.md` for vision and phase gates, `PHASE-0-BUILD-PLAN.md` for schema and milestones, `design/` for visual reference (read-only), and `docs/STATE-MACHINE.md` for PO status rules.

## Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind
- **Backend:** Supabase (Postgres, Auth, Storage, RLS, Edge Functions)
- **Hosting:** Vercel (frontend) + Supabase Edge Functions (Shopify / Supplier Link)

## Milestone 1 status

Auth + workspace scaffold:

- Migration: `supabase/migrations/20260805120000_workspaces_profiles.sql`
- Sign up / sign in
- Authenticated shell matching `design/index.html` sidebar + topbar

## Setup

1. Create a Supabase project (or use your existing **requisly** project).
2. In the Supabase SQL editor, run the full contents of  
   `supabase/migrations/20260805120000_workspaces_profiles.sql`.
3. Copy `.env.example` → `.env.local` and fill in Project URL + anon key from  
   **Project Settings → API**.
4. In Supabase Auth settings, add redirect URL: `http://localhost:3000/auth/callback`  
   (and disable email confirmation for local speed if you want).
5. Install and run:

```bash
npm install
npm run dev
```

6. Open `http://localhost:3000`, create a workspace, and you should land on Today's Work.

## Repo layout

```
/design/                 Visual + UX reference — READ-ONLY
/docs/STATE-MACHINE.md   Authoritative PO status rules
/supabase/migrations/    SQL to apply manually in Supabase
/src/                    Next.js app
PHASE-0-BUILD-PLAN.md
PRODUCT-ROADMAP.md
```

## Credentials still needed from you

- Supabase Project URL + anon key (for `.env.local`)
- Later milestones: Shopify Partner app credentials, Resend/Postmark for send email
