# Requisly — Embedded Shopify App

Merchant-facing Requisly, built to Shopify’s embedded-app spec:

- **Remix** + `@shopify/shopify-app-remix`
- **App Bridge** session-token auth
- **GraphQL Admin API**
- **Full Polaris** UI (no Manifest & Stamp here)

Scaffolded from Shopify’s Remix app template per `EMBEDDED-PIVOT-PLAN.md`. The root Next.js app is untouched; Supplier Link stays on the custom design system.

## Prerequisites

1. Node.js ≥ 20.19 (or ≥ 22.12)
2. [Shopify Partner account](https://partners.shopify.com/signup)
3. A development store
4. Shopify CLI: `npm install -g @shopify/cli@latest`
5. Supabase service-role credentials (same project as the Next.js app)

## Setup

```bash
cd embedded
npm install
npx prisma generate
npx prisma migrate deploy
```

Copy Supabase secrets into `embedded/.env` (see `env.example`):

```bash
# From repo root .env.local — required for auth bridge + Dashboard data:
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Link this folder to a Partner app:

```bash
npm run config:link
```

## Local development

Requires `shopify.web.toml` in this folder (Remix web process). Without it, CLI never starts Vite and App Home stays on Shopify’s placeholder (`Find this app in the pages where you work`).

```bash
npm run dev
# or from repo root: npm run dev:embedded
```

When Ready, the log should show a Cloudflare/tunnel URL under `app_home`, **not** `https://shopify.dev/apps/default-app-home`. Then press `p` to open the preview.

On open, the app:

1. Authenticates via Shopify session tokens
2. **Auth bridge** — finds or creates a Supabase `workspace` by `myshopify` domain (claims the sole unclaimed non-demo workspace if present, e.g. Salt & Fern)
3. Stores the offline token in `workspace_shopify_credentials`
4. **GraphQL catalog sync** (locations / variants / inventory) when stale or never synced
5. Renders **Today's Work** in Polaris from live PO data

## Migration status

| Step | Status |
|------|--------|
| 1. Scaffold Remix | ✅ |
| 2. GraphQL catalog sync | ✅ |
| 3. Auth bridge (workspace by shop) | ✅ |
| 4. Dashboard (Today's Work) Polaris | ✅ |
| 5. Remaining merchant screens | ✅ Merchant screens ported (Supplier Link public UI stays on Next.js) |
| 6. Decommission Next.js merchant routes | Later |
| 7. App Store review | Later |

## Notes

- Session storage uses Prisma SQLite (`prisma/dev.sqlite`) for Shopify sessions only — separate from Supabase.
- Polaris only — no Manifest & Stamp CSS.
- Supplier Link remains in the Next.js app.
- PO detail / New PO / Receive routes are stubs until step 5.
