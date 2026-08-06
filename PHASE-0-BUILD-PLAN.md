# Requisly — Phase 0 Build Plan

Companion to `DESIGN-STANDARD.md` and the roadmap. This is the technical plan for turning the HTML prototypes into a real app on Supabase + Cursor.

---

## 1. Stack recap

- **Database/Auth/Storage:** Supabase (Postgres, Auth, Storage, Row Level Security, Edge Functions)
- **Frontend:** built in Cursor — framework choice is Cursor's call, but should render the existing HTML prototypes' structure faithfully per `DESIGN-STANDARD.md`. React/Next.js is the natural fit given Vercel hosting later and Supabase's first-class JS client.
- **Hosting:** Vercel (later — not needed until there's something to deploy)
- **Transactional email:** not yet wired — needed for "Send PO" and Supplier Link emails. Add Resend or Postmark when you reach Milestone 5 below.
- **Shopify:** OAuth app, Admin API for products/variants/inventory/locations.

---

## 1.5. Hosting architecture — settled, don't revisit

This came up as an open question and is worth pinning down now so it doesn't get re-litigated later:

```
Vercel               → Next.js frontend, auth pages, UI, simple page-level API routes
Supabase             → Postgres, Auth, Storage, RLS
Supabase Edge        → Shopify OAuth callback, Shopify webhook receivers (inventory sync),
  Functions              supplier-link-action, complete-receiving
```

**Why this is correct, not a compromise:** the concern behind "Vercel doesn't have a true server" is real in general — Vercel's functions are serverless, spinning up per-request rather than running as a long-lived process. But that concern applies to the parts of this app that talk to Shopify (OAuth, webhooks, inventory write-back) — and those already live in **Supabase Edge Functions**, not on Vercel, per the schema/function table above. Vercel's job here is just serving the frontend. This is the standard pattern for this kind of integration — Stripe, Shopify, and most third-party webhooks land on serverless functions like this in production all the time.

**When to actually revisit this:** only if Phase 0 or later needs a genuine long-running background process — e.g., a nightly full-catalog resync across thousands of SKUs that takes several minutes, or a job queue processing large batches. That's not a Phase 0 need. If it comes up, the answer is adding something like Railway or Render *alongside* Vercel/Supabase for that one background-worker use case — not replacing the frontend or database hosting.

---

## 2. Database schema

Every table (except `workspaces` itself) carries a `workspace_id` — this is the multi-tenancy seam. Even at one workspace today, model it now; retrofitting later is the expensive path.

```sql
-- ============================================================
-- Workspaces & people
-- ============================================================

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shopify_domain text unique,
  shopify_access_token text, -- store encrypted / via Vault in production
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  full_name text,
  role text not null default 'member', -- 'owner' | 'member' — enough for Phase 0, real roles are Phase 5
  created_at timestamptz not null default now()
);

-- ============================================================
-- Shopify-synced catalog
-- ============================================================

create table locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  shopify_location_id text not null,
  name text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, shopify_location_id)
);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  shopify_product_id text not null,
  shopify_variant_id text not null,
  title text not null,
  sku text,
  image_url text,              -- Shopify product/variant image; null until catalog sync
  retail_price numeric(12,2),  -- Shopify variant selling price; null until catalog sync
  created_at timestamptz not null default now(),
  unique (workspace_id, shopify_variant_id)
);

-- ============================================================
-- Suppliers & per-supplier catalog
-- ============================================================

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  contact_name text,
  payment_terms text,       -- e.g. 'net_30' | 'deposit_50' | 'prepaid' — free text in v1, enum later
  currency text default 'USD',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table supplier_products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  product_variant_id uuid references product_variants(id) on delete set null, -- null if never mapped to Shopify catalog
  title text not null,
  sku text,
  unit_cost numeric(12,2),
  case_qty integer,
  moq integer,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Purchase Orders — the primary object
-- ============================================================

create type po_status as enum (
  'draft','sent','viewed','confirmed','production',
  'shipped','in_transit','partially_received','received','closed'
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  po_number text not null,          -- generate sequentially per workspace, e.g. PO-1042
  supplier_id uuid not null references suppliers(id),
  location_id uuid references locations(id),
  status po_status not null default 'draft',
  currency text default 'USD',
  notes text,
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  requested_ship_date date,
  duplicated_from_po_id uuid references purchase_orders(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, po_number)
);

create table po_line_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  supplier_product_id uuid references supplier_products(id),
  description text not null,   -- populated from supplier_product OR typed free-text
  sku text,
  is_free_text boolean not null default false,
  qty integer not null,
  unit_cost numeric(12,2) not null,
  line_total numeric(12,2) not null,
  sort_order integer not null default 0
);

-- Timeline — the signature spine. One row per state transition, append-only.
create table po_timeline_events (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  event_type po_status not null,
  actor text not null,          -- 'merchant' | 'supplier' | 'system'
  occurred_at timestamptz not null default now(),
  metadata jsonb default '{}'   -- e.g. {"tracking_number": "...", "carrier": "UPS"}
);

create table po_documents (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  file_path text not null,      -- Supabase Storage path
  file_name text not null,
  file_type text,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Supplier Link — no-login magic link access
-- ============================================================

create table supplier_link_tokens (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  token text not null unique,   -- cryptographically random, generated server-side
  expires_at timestamptz,       -- optional expiry, or leave null and rely on PO being closed
  created_at timestamptz not null default now()
);

-- ============================================================
-- Receiving — completes the PO
-- ============================================================

create table receipts (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  received_by uuid references profiles(id),
  note text,
  created_at timestamptz not null default now()
);

create type receipt_condition as enum ('good','damaged','wrong_item','backorder');

create table receipt_line_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  po_line_item_id uuid not null references po_line_items(id),
  qty_received integer not null,
  condition receipt_condition not null default 'good',
  reason_note text
);
```

**Notes:**
- `po_timeline_events` is deliberately append-only and separate from `purchase_orders.status`. The current status is a denormalized field for fast queries (Dashboard, PO List), but the full history — the thing the timeline UI renders — lives in this table. Don't skip inserting an event on every transition, even system-triggered ones.
- `is_free_text` on line items is what keeps the "flexibility clause" from the roadmap real in the schema, not just the UI.
- Skip `product_variants` sync entirely until Milestone 2 below — Suppliers and free-text POs work without it.

---

## 3. Row Level Security

Every table scopes to `workspace_id`. Simplest pattern: a helper function reading the user's workspace from their `profiles` row, then a policy per table.

```sql
create or replace function auth.current_workspace_id()
returns uuid
language sql stable
as $$
  select workspace_id from profiles where id = auth.uid()
$$;

alter table suppliers enable row level security;
create policy "workspace isolation" on suppliers
  for all using (workspace_id = auth.current_workspace_id());

-- repeat the same policy shape for: supplier_products, purchase_orders, po_line_items,
-- po_timeline_events (join through po_id → purchase_orders.workspace_id),
-- po_documents, receipts, receipt_line_items, locations, product_variants
```

`purchase_orders` and children that don't carry `workspace_id` directly (`po_line_items`, `po_timeline_events`, `receipt_line_items`) need policies that join up to the parent PO instead of a flat column check.

**Supplier Link is the one deliberate exception.** The public-facing supplier pages must NOT go through the authenticated RLS path — they're unauthenticated by design. Handle that via an Edge Function that validates the token server-side and uses the Supabase service role key to read/write just that one PO, rather than exposing any table directly to anon users.

---

## 4. Edge Functions needed

| Function | Purpose | Auth |
|---|---|---|
| `shopify-oauth-callback` | Completes Shopify OAuth, stores access token, kicks off initial sync | Session |
| `shopify-sync-catalog` | Pulls products/variants/locations from Shopify Admin API | Session or cron |
| `send-po-email` | Generates PDF, sends branded email with Supplier Link to supplier | Session |
| `supplier-link-action` | Validates token, lets supplier confirm ship date / mark shipped — writes a `po_timeline_events` row | Token only, no session |
| `complete-receiving` | Writes a receipt + line items, and pushes inventory adjustments back to Shopify | Session |

The last two are the ones that actually touch external systems (Shopify inventory, email) — build everything else as normal Supabase client calls from the frontend first, and only reach for Edge Functions where you need the service role key or a webhook.

---

## 5. Build order — milestones

Sequenced to get the golden workflow demoable end-to-end as early as possible, deferring polish.

1. **Auth + workspace scaffold.** Supabase Auth, `profiles` table, one hardcoded workspace to start. No Shopify yet — you can build and test everything else against a fake catalog.
2. **Suppliers CRUD.** `suppliers.html` / `supplier-detail.html` → real pages. This is the simplest full loop (create, list, edit) and validates your Supabase + RLS setup before anything more complex.
3. **Purchase Orders — create, list, detail (no send yet).** `create-po.html`, `purchase-orders.html`, `po-detail.html`. Free-text line items only at this stage — skip Shopify product mapping for now. Timeline renders from `po_timeline_events`, starting with just the `created` event.
4. **Shopify OAuth + catalog sync.** `onboarding.html` becomes real. Now line items can reference real `product_variants`. This unblocks accurate inventory write-back later.
5. **Send flow + Supplier Link.** Wire up `send-po-email`, generate `supplier_link_tokens`, build the public `supplier-link.html` route (this one is NOT behind auth — it's its own unauthenticated page tree). Confirm/mark-shipped actions write timeline events via `supplier-link-action`.
6. **Receiving.** `receive.html` becomes real, writes `receipts`/`receipt_line_items`, calls `complete-receiving` to push adjustments to Shopify inventory, updates PO status to `partially_received` or `received`/`closed`.
7. **Dashboard.** `index.html` — now that POs have real state, "Today's Work" becomes real queries (waiting confirmation, arriving today, ready to receive) instead of hardcoded rows.
8. **Documents.** Supabase Storage wiring for `po_documents` — quotes, invoices, receiving photos.
9. **Empty states + polish.** `empty-workspace.html` pattern, loading states, error states — do this last, once there's real data to be "empty" in contrast to.

Deliberately not in this list: Calendar view, Products page as its own section, anything from Phase 1+. Matches the roadmap's own cuts.

---

## 6. Kickoff prompt for Cursor

Paste something like this into Cursor once the repo/Supabase project are both live:

> I'm building Requisly, a purchase-order platform for Shopify brands. I have a working HTML/CSS prototype (`/design` folder) and a `DESIGN-STANDARD.md` that defines the visual system — treat both as the source of truth for how this should look, don't design from scratch. I also have `PHASE-0-BUILD-PLAN.md` with the full Supabase schema and an ordered milestone list.
>
> Start with Milestone 1: set up [Next.js / your chosen framework] with Supabase Auth, apply the `workspaces` and `profiles` tables from the schema, and get a basic authenticated shell running that matches the sidebar/topbar layout in `index.html`. Don't build Suppliers or POs yet — just the shell and auth.

Keep the `/design` folder read-only reference — don't let Cursor edit those files directly; they're the spec, not the codebase.
