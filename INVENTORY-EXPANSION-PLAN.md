# Requisly — Inventory Expansion Plan (Phase 6)

Companion to `PRODUCT-ROADMAP.md`, `PHASE-2-5-BUILD-PLAN.md`. **Scope: real feature parity with Cin7/Katana — inventory, warehouse, multi-channel operations, AND manufacturing (Bill of Materials / Manufacturing Orders).**

**Corrected framing, worth stating explicitly since an earlier draft of this doc got this wrong:** manufacturing is not a different customer. A Shopify brand that manufactures still needs everything Requisly already does — a supplier catalog, purchase orders, confirmation, receiving — the only difference is what's on the PO: a reseller orders finished goods, a manufacturer orders raw materials and components. Same object, same Supplier Link, same effective-dated pricing, just one step earlier in the chain. **Manufacturing is an optional layer on top of the existing procurement backbone, not a fork into a second product.** A pure reseller ignores it entirely at zero cost to them; a manufacturer gets BOM/MO as a natural extension of a system they're already using to buy raw materials.

**Status: queued for build, deliberately, with full knowledge of scope.** This is the largest single scope commitment in this build to date. Real tradeoff, understood: this enters a mature, saturated inventory/warehouse/MRP software market (Cin7, Katana, Fishbowl, Odoo, MRPeasy — no single dominant player). The anchor stays the real-confirmed-lead-time reorder mechanism below — still the one piece genuinely unreplicated anywhere, including at Cin7/Katana, since their lead times are guessed or supplier-stated, never confirmed via a real two-way supplier link. That advantage now extends naturally into manufacturing too: a manufacturer's *raw material* lead times are just as real and confirmed as a reseller's finished-good lead times, using the identical mechanism.

---

## 1. The actual differentiator — hold this line

Every inventory-management competitor researched (Supremo, Stockful, Prediko, Katana) computes lead time as a **static, merchant-entered or supplier-stated average** — a guess, updated rarely if ever.

Requisly already has something none of them do: **real, timestamped, supplier-confirmed lead time** — the actual `sent → confirmed → shipped → received` interval from `po_timeline_events`, per supplier, updated automatically with every real order. This applies identically whether the PO is for a finished good (reseller) or a raw material (manufacturer) — the timeline mechanism doesn't care what's being purchased.

**Non-negotiable, consistent with every AI feature built today:** all reorder, production-scheduling, and cost math is computed by code, not narrated or estimated by the LLM. AI only explains a number code already computed.

---

## 2. Reorder point schema (resale + raw materials — same mechanism)

```sql
create table reorder_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_variant_id uuid not null references product_variants(id) on delete cascade,
  safety_stock_units integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create view reorder_recommendations as
select
  rs.id as reorder_setting_id,
  rs.workspace_id,
  pv.id as product_variant_id,
  pv.title,
  il.on_hand,
  coalesce(v.units_per_day, 0) as units_per_day, -- for raw materials, this is consumption rate via MOs, not direct sales
  coalesce(lt.avg_confirmed_lead_days, lt.fallback_supplier_stated_days) as lead_time_days,
  lt.source as lead_time_source, -- 'confirmed' | 'fallback_estimate'
  (coalesce(v.units_per_day, 0) * coalesce(lt.avg_confirmed_lead_days, lt.fallback_supplier_stated_days))
    + rs.safety_stock_units as reorder_point,
  case when il.on_hand <= (
    (coalesce(v.units_per_day, 0) * coalesce(lt.avg_confirmed_lead_days, lt.fallback_supplier_stated_days))
    + rs.safety_stock_units
  ) then true else false end as needs_reorder
from reorder_settings rs
join product_variants pv on pv.id = rs.product_variant_id
join inventory_levels il on il.product_variant_id = pv.id
left join lateral (
  -- for finished goods sold direct: units_per_day from Orders sync
  -- for raw materials: units_per_day from manufacturing_order consumption rate (see Section 6)
  select avg(units_per_day) as units_per_day
  from product_consumption_summary
  where product_variant_id = pv.id and period_date > now() - interval '30 days'
) v on true
left join lateral (
  select
    avg(extract(epoch from (
      (select occurred_at from po_timeline_events where po_id = po.id and event_type = 'shipped' limit 1))
      - (select occurred_at from po_timeline_events where po_id = po.id and event_type = 'sent' limit 1)
    )) / 86400 as avg_confirmed_lead_days,
    null::numeric as fallback_supplier_stated_days,
    case when count(*) > 0 then 'confirmed' else 'fallback_estimate' end as source
  from purchase_orders po
  join po_line_items pli on pli.po_id = po.id
  where pli.supplier_product_id in (
    select id from supplier_products where product_variant_id = pv.id
  ) and po.status = 'closed'
) lt on true;

create table inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  from_location_id uuid not null references locations(id),
  to_location_id uuid not null references locations(id),
  status text not null default 'draft',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table inventory_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references inventory_transfers(id) on delete cascade,
  product_variant_id uuid not null references product_variants(id),
  qty integer not null
);

create table stocktakes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  location_id uuid not null references locations(id),
  status text not null default 'in_progress',
  started_by uuid references profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references stocktakes(id) on delete cascade,
  product_variant_id uuid not null references product_variants(id),
  expected_qty integer not null,
  counted_qty integer,
  variance integer generated always as (counted_qty - expected_qty) stored
);
```

**Note on `fallback_supplier_stated_days`:** a brand-new supplier relationship has zero confirmed history. Use a merchant-entered starting estimate, clearly labeled `lead_time_source = 'fallback_estimate'`, silently upgrading to `'confirmed'` once real closed-PO history exists. Never blend a guess and a real number into one silent average.

---

## 3. Inventory Agent

Reuses the exact agent pattern already proven: SQL computes real numbers, Claude Haiku narrates, required template fallback, never auto-executes — a reorder recommendation becomes a one-click **draft PO** suggestion, never auto-sent.

Example target output for a reseller: *"Care Label Standard is at 40 units, below your reorder point of 65. Based on Metro Labels Inc's actual confirmed delivery time (9 days average across 14 real orders), you should reorder within the next 3 days."*

Example target output for a manufacturer's raw material: *"Cotton fabric roll is at 12 units, below your reorder point of 20, driven by 3 open manufacturing orders consuming it this week. Based on Textile Supply Co's actual confirmed delivery time (14 days across 8 real orders), order now to avoid a production delay."* — this second one is the thing nobody else can say, since it chains real consumption data through a real BOM to a real confirmed supplier lead time, three layers deep.

---

## 4. Multi-channel inventory sync

Real-time inventory visibility across Amazon, WooCommerce, eBay, wholesale/B2B channels, not just Shopify. **The single largest technical undertaking in this project to date** — bigger than the embedded pivot, bigger than QuickBooks. Each channel has its own API, auth model, and inventory-update semantics. Build one common internal adapter interface (`sync-channel-inventory`), implement one channel at a time — Amazon first, given market share — never attempt multiple channels simultaneously.

## 5. Advanced warehouse management

Bin/location-level tracking within a warehouse, pick/pack/ship workflows, barcode scanning. Real new UI surface — likely needs to work on a handheld scanner or tablet, not just desktop Polaris. Lowest priority of the major pieces; build once the rest is real and used.

## 6. Manufacturing — Bill of Materials + Manufacturing Orders

```sql
create table product_recipes ( -- BOM, per finished product
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_variant_id uuid not null references product_variants(id), -- the finished good
  created_at timestamptz not null default now()
);

create table product_recipe_lines ( -- ingredients: raw materials or subassemblies
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references product_recipes(id) on delete cascade,
  ingredient_product_variant_id uuid not null references product_variants(id),
  qty_required numeric(12,4) not null,
  is_subassembly boolean not null default false
);

create table manufacturing_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_variant_id uuid not null references product_variants(id),
  qty_to_make integer not null,
  mode text not null default 'make_to_stock', -- 'make_to_order' | 'make_to_stock'
  linked_sales_order_id uuid,
  status text not null default 'draft', -- 'draft' | 'in_progress' | 'completed'
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
```

**Key integration point, the whole reason this isn't a separate product:** raw materials (`ingredient_product_variant_id`) are purchased through the exact same `supplier_products` / `purchase_orders` / Supplier Link flow already built for finished goods. A manufacturer's "Add a supplier" and "create a PO" experience is identical to a reseller's — they're just buying cotton fabric instead of finished shirts. No parallel procurement system, no separate onboarding.

**Transaction integrity, non-negotiable:** completing an MO must atomically deduct each ingredient's qty (recursively through subassemblies) from `inventory_levels` and add the finished qty. A half-applied MO (materials deducted, finished good not added, or vice versa) is a real data-integrity bug — wrap this in a single transaction, no partial-completion state allowed to persist.

Build make-to-stock before make-to-order (simpler, no sales-order linkage needed first).

## 7. Landed cost tracking

Freight, duty, customs allocated into per-unit cost — relevant to both a reseller importing finished goods and a manufacturer importing raw materials. Extends `supplier_product_prices` rather than requiring a new object.

## 8. Dead-stock / excess-inventory report

Cheapest addition — reuses report builder infrastructure directly once Orders/consumption data exists.

---

## 9. Build order

1. **Confirm Orders sync is real and live** (from the report builder work) — blocks reorder-point velocity calculations.
2. **Reorder points w/ real confirmed lead time** (Sections 1-2) — ships first, least risky, the genuine differentiator.
3. **Reorder recommendations UI + Inventory Agent** (Section 3).
4. **Bill of Materials + Manufacturing Orders, make-to-stock only** (Section 6) — reuses the existing procurement backbone, the next-most-differentiated piece given the confirmed-lead-time chaining into raw materials.
5. **Dead-stock report** (Section 8) — cheap, reuses report builder.
6. **Multi-location transfers, stocktakes** (Section 2 tables) — moderate effort.
7. **Make-to-order manufacturing** (sales-order-linked MOs) — once make-to-stock is proven.
8. **One additional sales channel** (Amazon first) — Section 4, substantial, isolated effort.
9. **Advanced warehouse management** (Section 5) — lowest priority, most operationally complex.
10. **Landed cost tracking** (Section 7) — can slot in earlier or later depending on how many real users import internationally.

**Honest sequencing note:** items 4 (manufacturing) and 8 (multi-channel) each represent more net-new engineering surface than everything built in this entire conversation to date, combined. This is a multi-month roadmap, not a near-term backlog.

---

## 10. What this changes, and what it doesn't

- **Positioning:** broadens from "the procurement platform for Shopify brands" to "the platform for how Shopify brands source, build, and sell" — covers both resale and manufacturing sourcing through the same core mechanism. Worth a deliberate rewrite of the roadmap's vision statement once this ships, not left inconsistent with the current one-liner.
- **Pricing:** justifies moving into genuine Cin7/Katana-adjacent territory ($300-500+/mo) once manufacturing and multi-channel are real — but only once built and proven, not ahead of it.
- **Competitive set changes.** No longer primarily positioned against Supremo/Prediko (inventory-only, single-channel, no manufacturing) — becomes a direct competitor to Cin7 and Katana, established players with years of iteration. Worth a fresh competitive pass once this is underway.
- **What doesn't change:** the core mechanism. Every piece of this — resale reorder points, raw-material reorder points, manufacturing lead times — traces back to the same real, confirmed, Supplier-Link-driven timeline data nothing else in this market has.
