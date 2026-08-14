/**
 * Seed REAL workspace purchasing data for Salt & Fern Goods
 * (shopify_domain = requisly.myshopify.com, is_demo = false).
 *
 * THIS IS NOT THE DEMO SEED.
 * - Does NOT target or mutate any workspace where is_demo = true
 * - Does NOT touch scripts/seed-demo.ts / "Requisly Demo"
 * - Leaves Shopify-synced product_variants + locations intact
 * - Idempotent: wipes prior *purchasing* rows for THIS workspace only, then reseeds
 *
 * Usage:
 *   npx tsx --env-file=embedded/.env scripts/seed-salt-and-fern-real.ts
 *   npx tsx --env-file=.env.local scripts/seed-salt-and-fern-real.ts
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Real Salt & Fern store — never the demo workspace. */
const REAL_SHOPIFY_DOMAIN = "requisly.myshopify.com";
const REAL_WORKSPACE_NAME_HINT = "Salt & Fern Goods";
const SCORECARD_MIN_CLOSED = 5;
const PO_PREFIX = "PO-SF";

type Variant = {
  id: string;
  title: string;
  sku: string | null;
  retail_price: number | null;
};

type SupplierSpec = {
  key: "cascade" | "pacific" | "fernvale";
  name: string;
  email: string;
  contact_name: string;
  payment_terms: string;
  notes: string;
  /** Relative cost multiplier vs base (lower = cheaper). */
  costFactor: number;
  confirmHours: [number, number];
  shipDayOffset: [number, number];
  closedCount: number;
  damageRate: number;
  backorderRate: number;
};

const SUPPLIERS: SupplierSpec[] = [
  {
    key: "cascade",
    name: "Cascade Outdoor Supply",
    email: "orders@cascade-outdoor.example",
    contact_name: "Elena Ruiz",
    payment_terms: "Net 30",
    notes:
      "Reliable wholesale — confirms fast, ships on time. Seeded for Salt & Fern real workspace.",
    costFactor: 1.0,
    confirmHours: [2, 24],
    shipDayOffset: [-3, 0],
    closedCount: 7,
    damageRate: 0.04,
    backorderRate: 0.03,
  },
  {
    key: "pacific",
    name: "Pacific Ridge Components",
    email: "desk@pacific-ridge.example",
    contact_name: "Marcus Bell",
    payment_terms: "Net 45",
    notes:
      "Often late / slow to confirm — contrast supplier for scorecards & AI. Real-workspace seed only.",
    costFactor: 0.82, // ~18% cheaper than Cascade on shared SKUs
    confirmHours: [48, 120],
    shipDayOffset: [5, 12],
    closedCount: 6,
    damageRate: 0.12,
    backorderRate: 0.1,
  },
  {
    key: "fernvale",
    name: "Fernvale Packaging Co",
    email: "fulfillment@fernvale-pack.example",
    contact_name: "Asha Patel",
    payment_terms: "Net 15",
    notes:
      "Packaging + gift-card print house. Mixed reliability. Real-workspace seed only.",
    costFactor: 1.12, // ~12% more expensive on shared SKUs
    confirmHours: [8, 48],
    shipDayOffset: [-1, 4],
    closedCount: 5,
    damageRate: 0.06,
    backorderRate: 0.08,
  },
];

function loadEnv() {
  for (const file of [".env.local", "embedded/.env", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function mulberry32(seed: number) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rand: () => number, min: number, max: number) {
  return min + rand() * (max - min);
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function addHours(d: Date, hours: number) {
  return new Date(d.getTime() + hours * 3600_000);
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86400_000);
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function todayEastern(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
}

/** Wholesale unit cost derived from retail — gift cards near face, boards ~35–55%. */
function baseUnitCost(v: Variant): number {
  const retail = Number(v.retail_price ?? 0);
  if (!(retail > 0)) return 8.5;
  if (/gift card/i.test(v.title)) return money(retail * 0.92);
  if (/ski wax/i.test(v.title)) return money(retail * 0.42);
  return money(retail * 0.45);
}

function skuFor(v: Variant, supplierKey: string): string {
  if (v.sku?.trim()) return `${v.sku}-${supplierKey.slice(0, 3).toUpperCase()}`;
  const slug = v.title
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28)
    .toUpperCase();
  return `${slug}-${supplierKey.slice(0, 3).toUpperCase()}`;
}

async function wipePurchasingData(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  console.log("Wiping prior purchasing data for THIS real workspace only…");

  const { data: existingPos } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("workspace_id", workspaceId);
  const poIds = (existingPos ?? []).map((p) => p.id as string);

  if (poIds.length) {
    const { data: receipts } = await supabase
      .from("receipts")
      .select("id")
      .in("po_id", poIds);
    const receiptIds = (receipts ?? []).map((r) => r.id as string);
    if (receiptIds.length) {
      await supabase
        .from("receipt_line_items")
        .delete()
        .in("receipt_id", receiptIds);
      await supabase.from("receipts").delete().in("id", receiptIds);
    }

    const { data: shipments } = await supabase
      .from("po_shipments")
      .select("id")
      .in("po_id", poIds);
    const shipmentIds = (shipments ?? []).map((s) => s.id as string);
    if (shipmentIds.length) {
      await supabase
        .from("po_shipment_lines")
        .delete()
        .in("shipment_id", shipmentIds);
      await supabase.from("po_shipments").delete().in("id", shipmentIds);
    }

    await supabase.from("po_timeline_events").delete().in("po_id", poIds);
    await supabase.from("supplier_link_tokens").delete().in("po_id", poIds);
    await supabase.from("po_documents").delete().in("po_id", poIds);
    await supabase.from("po_line_items").delete().in("po_id", poIds);
    await supabase.from("purchase_orders").delete().in("id", poIds);
  }

  // Prices cascade via supplier_products FK in most schemas; delete products then suppliers.
  const { data: sps } = await supabase
    .from("supplier_products")
    .select("id")
    .eq("workspace_id", workspaceId);
  const spIds = (sps ?? []).map((s) => s.id as string);
  if (spIds.length) {
    await supabase
      .from("supplier_product_prices")
      .delete()
      .in("supplier_product_id", spIds);
  }
  await supabase.from("supplier_products").delete().eq("workspace_id", workspaceId);
  await supabase.from("suppliers").delete().eq("workspace_id", workspaceId);

  // Clear stale AI tiles so agents regenerate against new data
  await supabase.from("ai_insights").delete().eq("workspace_id", workspaceId);
}

async function main() {
  loadEnv();
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("════════════════════════════════════════════════════════");
  console.log(" REAL WORKSPACE SEED — Salt & Fern / requisly.myshopify.com");
  console.log(" Will NOT touch any is_demo = true workspace.");
  console.log("════════════════════════════════════════════════════════");

  const { data: workspace, error: wsErr } = await supabase
    .from("workspaces")
    .select("id, name, shopify_domain, is_demo")
    .eq("shopify_domain", REAL_SHOPIFY_DOMAIN)
    .maybeSingle();
  if (wsErr) throw wsErr;
  if (!workspace) {
    throw new Error(
      `No workspace found for shopify_domain=${REAL_SHOPIFY_DOMAIN}`,
    );
  }
  if (workspace.is_demo === true) {
    throw new Error(
      `Refusing to seed: workspace ${workspace.id} has is_demo=true. ` +
        `Use scripts/seed-demo.ts for the demo workspace instead.`,
    );
  }

  const workspaceId = workspace.id as string;
  console.log(
    `Target: ${workspace.name} (${workspace.shopify_domain}) id=${workspaceId} is_demo=${workspace.is_demo}`,
  );
  if (
    workspace.name &&
    !String(workspace.name).includes("Salt") &&
    workspace.name !== REAL_WORKSPACE_NAME_HINT
  ) {
    console.warn(
      `Note: workspace name is "${workspace.name}" (expected hint "${REAL_WORKSPACE_NAME_HINT}") — continuing because domain matches.`,
    );
  }

  const { data: variantsRaw, error: vErr } = await supabase
    .from("product_variants")
    .select("id, title, sku, retail_price")
    .eq("workspace_id", workspaceId)
    .order("title");
  if (vErr) throw vErr;
  const variants: Variant[] = (variantsRaw ?? []).map((v) => ({
    id: v.id as string,
    title: v.title as string,
    sku: (v.sku as string | null) ?? null,
    retail_price:
      v.retail_price == null ? null : Number(v.retail_price),
  }));
  if (!variants.length) {
    throw new Error(
      "No synced product_variants on this workspace — sync Shopify catalog first.",
    );
  }
  console.log(`Synced variants: ${variants.length}`);

  let { data: location } = await supabase
    .from("locations")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("is_primary", true)
    .maybeSingle();
  if (!location) {
    const { data: anyLoc } = await supabase
      .from("locations")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle();
    location = anyLoc;
  }
  if (!location) {
    throw new Error("No locations synced — sync Shopify locations first.");
  }
  console.log(`Primary location: ${location.name} (${location.id})`);

  await wipePurchasingData(supabase, workspaceId);

  const rand = mulberry32(20260814);
  const now = new Date();
  const historyStart = addDays(now, -150);
  const today = todayEastern();
  const futurePriceDate = isoDate(addDays(now, 21));

  // Prefer non-gift-card variants for multi-supplier competition demos
  const competitive = variants
    .filter((v) => !/gift card/i.test(v.title))
    .slice(0, 6);
  const multiSupplierVariantIds = new Set(
    competitive.slice(0, 4).map((v) => v.id),
  );
  console.log(
    `Multi-supplier competitive variants (${multiSupplierVariantIds.size}):`,
  );
  for (const v of competitive.slice(0, 4)) {
    console.log(`  - ${v.title} @ retail $${v.retail_price ?? "?"}`);
  }

  type SpRow = {
    id: string;
    supplier_id: string;
    product_variant_id: string | null;
    title: string;
    sku: string | null;
    unit_cost: number;
  };

  const supplierIds = new Map<string, string>();
  const productsBySupplier = new Map<string, SpRow[]>();

  for (const spec of SUPPLIERS) {
    const { data: supplier, error } = await supabase
      .from("suppliers")
      .insert({
        workspace_id: workspaceId,
        name: spec.name,
        email: spec.email,
        contact_name: spec.contact_name,
        payment_terms: spec.payment_terms,
        notes: spec.notes,
        currency: "USD",
      })
      .select("id")
      .single();
    if (error) throw error;
    supplierIds.set(spec.key, supplier.id as string);

    const rows = variants.map((v) => {
      const base = baseUnitCost(v);
      const unit = money(base * spec.costFactor);
      return {
        workspace_id: workspaceId,
        supplier_id: supplier.id,
        product_variant_id: v.id,
        title: v.title,
        sku: skuFor(v, spec.key),
        unit_cost: unit,
        case_qty: /gift card/i.test(v.title) ? 25 : 6,
        moq: /gift card/i.test(v.title) ? 50 : 12,
      };
    });

    // Fernvale focuses packaging/gift + a few boards; still link all for catalog density
    // but Cascade + Pacific both always cover multi-supplier set.
    const { data: inserted, error: spErr } = await supabase
      .from("supplier_products")
      .insert(rows)
      .select("id, supplier_id, product_variant_id, title, sku, unit_cost");
    if (spErr) throw spErr;

    const spRows: SpRow[] = (inserted ?? []).map((r) => ({
      id: r.id as string,
      supplier_id: r.supplier_id as string,
      product_variant_id: (r.product_variant_id as string | null) ?? null,
      title: r.title as string,
      sku: (r.sku as string | null) ?? null,
      unit_cost: Number(r.unit_cost),
    }));
    productsBySupplier.set(spec.key, spRows);

    const priceRows: Array<{
      supplier_product_id: string;
      unit_cost: number;
      effective_date: string;
    }> = [];

    for (const sp of spRows) {
      priceRows.push({
        supplier_product_id: sp.id,
        unit_cost: sp.unit_cost,
        effective_date: today,
      });
    }

    // Cascade: one multi-supplier SKU gets a future scheduled bump for Products UI
    if (spec.key === "cascade") {
      const futureSp = spRows.find(
        (sp) =>
          sp.product_variant_id &&
          multiSupplierVariantIds.has(sp.product_variant_id),
      );
      if (futureSp) {
        const bumped = money(futureSp.unit_cost * 1.08);
        priceRows.push({
          supplier_product_id: futureSp.id,
          unit_cost: bumped,
          effective_date: futurePriceDate,
        });
        console.log(
          `Scheduled price: ${futureSp.title} → $${bumped} on ${futurePriceDate} (current $${futureSp.unit_cost})`,
        );
      }
    }

    const { error: priceErr } = await supabase
      .from("supplier_product_prices")
      .insert(priceRows);
    if (priceErr) throw priceErr;

    console.log(`Supplier ${spec.name}: ${spRows.length} catalog links`);
  }

  // Log multi-supplier cost spreads
  console.log("Multi-supplier cost spreads:");
  for (const vid of multiSupplierVariantIds) {
    const costs: string[] = [];
    for (const spec of SUPPLIERS) {
      const sp = productsBySupplier
        .get(spec.key)
        ?.find((p) => p.product_variant_id === vid);
      if (sp) costs.push(`${spec.key}=$${sp.unit_cost}`);
    }
    const title =
      variants.find((v) => v.id === vid)?.title ?? vid.slice(0, 8);
    console.log(`  ${title}: ${costs.join(" | ")}`);
  }

  let poSeq = 0;
  const nextPoNumber = () => {
    poSeq += 1;
    return `${PO_PREFIX}${String(poSeq).padStart(4, "0")}`;
  };

  type TimelineEvent = {
    po_id: string;
    event_type: string;
    actor: string;
    occurred_at: string;
    metadata?: Record<string, unknown>;
  };

  async function insertPo(opts: {
    supplierKey: string;
    status: string;
    createdAt: Date;
    requestedShip?: Date;
    confirmedShip?: Date;
    eta?: Date;
    notes?: string;
    lineProducts: SpRow[];
    qtys?: number[];
    events: Omit<TimelineEvent, "po_id">[];
    withReceipt?: {
      at: Date;
      partial?: boolean;
      damage?: boolean;
      backorder?: boolean;
    };
    withShipments?: boolean;
    withDocument?: boolean;
    rejected?: boolean;
  }) {
    const supplierId = supplierIds.get(opts.supplierKey)!;
    const lines = opts.lineProducts.map((sp, i) => {
      const qty = opts.qtys?.[i] ?? 12 + Math.floor(rand() * 4) * 6;
      const unit = sp.unit_cost;
      return {
        supplier_product_id: sp.id,
        description: sp.title,
        sku: sp.sku,
        is_free_text: false,
        qty,
        unit_cost: unit,
        line_total: money(qty * unit),
        sort_order: i,
      };
    });
    const subtotal = money(lines.reduce((s, l) => s + l.line_total, 0));
    const tax = money(subtotal * 0.0);
    const total = money(subtotal + tax);
    const poNumber = nextPoNumber();
    const updatedAt =
      opts.events.length > 0
        ? new Date(
            opts.events[opts.events.length - 1]!.occurred_at,
          ).toISOString()
        : opts.createdAt.toISOString();

    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .insert({
        workspace_id: workspaceId,
        po_number: poNumber,
        supplier_id: supplierId,
        location_id: location!.id,
        status: opts.status,
        currency: "USD",
        notes: opts.notes ?? `Salt & Fern real-workspace seed (${opts.status})`,
        subtotal,
        tax_amount: tax,
        total,
        requested_ship_date: opts.requestedShip
          ? isoDate(opts.requestedShip)
          : null,
        confirmed_ship_date: opts.confirmedShip
          ? isoDate(opts.confirmedShip)
          : null,
        estimated_arrival_date: opts.eta ? isoDate(opts.eta) : null,
        created_at: opts.createdAt.toISOString(),
        updated_at: updatedAt,
      })
      .select("id")
      .single();
    if (poErr) throw poErr;

    const { data: insertedLines, error: lineErr } = await supabase
      .from("po_line_items")
      .insert(lines.map((l) => ({ ...l, po_id: po.id })))
      .select("id, qty");
    if (lineErr) throw lineErr;

    const events: TimelineEvent[] = opts.events.map((e) => ({
      ...e,
      po_id: po.id as string,
    }));
    const { error: evErr } = await supabase
      .from("po_timeline_events")
      .insert(events);
    if (evErr) throw evErr;

    if (opts.withReceipt && insertedLines?.length) {
      const { data: receipt, error: rErr } = await supabase
        .from("receipts")
        .insert({
          po_id: po.id,
          workspace_id: workspaceId,
          note: opts.withReceipt.partial
            ? "Partial receive — Salt & Fern real seed"
            : "Full receive — Salt & Fern real seed",
          created_at: opts.withReceipt.at.toISOString(),
        })
        .select("id")
        .single();
      if (rErr) throw rErr;

      const receiptLines: Array<{
        receipt_id: string;
        po_line_item_id: string;
        qty_received: number;
        condition: "good" | "damaged" | "wrong_item" | "backorder";
        reason_note: string | null;
      }> = [];

      insertedLines.forEach((line, idx) => {
        if (idx === 0 && opts.withReceipt!.damage) {
          const good = Math.max(1, Math.floor(line.qty * 0.75));
          receiptLines.push({
            receipt_id: receipt.id,
            po_line_item_id: line.id,
            qty_received: good,
            condition: "good",
            reason_note: null,
          });
          receiptLines.push({
            receipt_id: receipt.id,
            po_line_item_id: line.id,
            qty_received: line.qty - good,
            condition: "damaged",
            reason_note: "Edge ding / carton crush on arrival",
          });
        } else if (idx === 0 && opts.withReceipt!.backorder) {
          const got = Math.max(1, Math.floor(line.qty * 0.6));
          receiptLines.push({
            receipt_id: receipt.id,
            po_line_item_id: line.id,
            qty_received: got,
            condition: "good",
            reason_note: null,
          });
          receiptLines.push({
            receipt_id: receipt.id,
            po_line_item_id: line.id,
            qty_received: 0,
            condition: "backorder",
            reason_note: `Backordered ${line.qty - got} units — supplier short`,
          });
        } else if (opts.withReceipt!.partial && idx === insertedLines.length - 1) {
          const got = Math.max(1, Math.floor(line.qty * 0.5));
          receiptLines.push({
            receipt_id: receipt.id,
            po_line_item_id: line.id,
            qty_received: got,
            condition: "good",
            reason_note: null,
          });
        } else {
          receiptLines.push({
            receipt_id: receipt.id,
            po_line_item_id: line.id,
            qty_received: line.qty,
            condition: "good",
            reason_note: null,
          });
        }
      });

      const { error: rlErr } = await supabase
        .from("receipt_line_items")
        .insert(receiptLines);
      if (rlErr) throw rlErr;
    }

    if (opts.withShipments && insertedLines && insertedLines.length >= 2) {
      const ship1At = addDays(opts.createdAt, 20);
      const ship2At = addDays(opts.createdAt, 27);
      const { data: ship1, error: s1Err } = await supabase
        .from("po_shipments")
        .insert({
          workspace_id: workspaceId,
          po_id: po.id,
          tracking_number: `1ZSF${Math.floor(rand() * 1e10)}`,
          carrier: "UPS",
          estimated_arrival_date: isoDate(addDays(ship1At, 4)),
          shipped_at: ship1At.toISOString(),
          note: "First carton wave",
          created_by: "supplier",
        })
        .select("id")
        .single();
      if (s1Err) throw s1Err;
      const { data: ship2, error: s2Err } = await supabase
        .from("po_shipments")
        .insert({
          workspace_id: workspaceId,
          po_id: po.id,
          tracking_number: `FXSF${Math.floor(rand() * 1e10)}`,
          carrier: "FedEx",
          estimated_arrival_date: isoDate(addDays(ship2At, 3)),
          shipped_at: ship2At.toISOString(),
          note: "Remainder / second wave",
          created_by: "supplier",
        })
        .select("id")
        .single();
      if (s2Err) throw s2Err;

      const half = Math.max(1, Math.floor(insertedLines[0]!.qty / 2));
      await supabase.from("po_shipment_lines").insert([
        {
          shipment_id: ship1.id,
          po_line_item_id: insertedLines[0]!.id,
          qty: half,
        },
        {
          shipment_id: ship1.id,
          po_line_item_id: insertedLines[1]!.id,
          qty: insertedLines[1]!.qty,
        },
        {
          shipment_id: ship2.id,
          po_line_item_id: insertedLines[0]!.id,
          qty: insertedLines[0]!.qty - half,
        },
      ]);
    }

    if (opts.withDocument) {
      const path = `${workspaceId}/${po.id}/seed-packing-list.pdf`;
      const pdf =
        "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nSalt & Fern packing list seed\n";
      const { error: upErr } = await supabase.storage
        .from("po-documents")
        .upload(path, pdf, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) {
        console.warn(`Document upload skipped: ${upErr.message}`);
      }
      await supabase.from("po_documents").insert({
        po_id: po.id,
        workspace_id: workspaceId,
        file_path: path,
        file_name: `${poNumber}-packing-list.pdf`,
        file_type: "application/pdf",
        kind: "packing_slip",
      });
    }

    return po.id as string;
  }

  function catalogFor(key: string): SpRow[] {
    return productsBySupplier.get(key) ?? [];
  }

  function pickLines(key: string, n: number): SpRow[] {
    const all = catalogFor(key);
    const preferred = all.filter(
      (p) =>
        p.product_variant_id &&
        multiSupplierVariantIds.has(p.product_variant_id),
    );
    const pool = preferred.length >= n ? preferred : all;
    const out: SpRow[] = [];
    const used = new Set<string>();
    while (out.length < n && out.length < pool.length) {
      const sp = pick(rand, pool);
      if (used.has(sp.id)) continue;
      used.add(sp.id);
      out.push(sp);
    }
    return out;
  }

  // ── Closed POs per supplier (scorecard unlock) ──────────────────────────
  console.log("Seeding closed POs…");
  for (const spec of SUPPLIERS) {
    for (let i = 0; i < spec.closedCount; i++) {
      const createdAt = addDays(
        historyStart,
        between(rand, 5, 140) + i * 3,
      );
      const sentAt = addHours(createdAt, between(rand, 1, 12));
      const viewedAt = addHours(sentAt, between(rand, 2, 36));
      const confirmedAt = addHours(
        sentAt,
        between(rand, spec.confirmHours[0], spec.confirmHours[1]),
      );
      const requestedShip = addDays(confirmedAt, Math.round(between(rand, 14, 28)));
      const shipOffset = between(
        rand,
        spec.shipDayOffset[0],
        spec.shipDayOffset[1],
      );
      const shippedAt = addDays(requestedShip, shipOffset);
      const receivedAt = addDays(shippedAt, between(rand, 48, 120));
      const closedAt = addHours(receivedAt, between(rand, 2, 24));
      const hadProduction = rand() > 0.4;
      const productionAt = addDays(confirmedAt, between(rand, 2, 7));

      const events: Omit<TimelineEvent, "po_id">[] = [
        { event_type: "draft", actor: "merchant", occurred_at: createdAt.toISOString() },
        { event_type: "sent", actor: "merchant", occurred_at: sentAt.toISOString() },
        { event_type: "viewed", actor: "system", occurred_at: viewedAt.toISOString() },
        {
          event_type: "confirmed",
          actor: "supplier",
          occurred_at: confirmedAt.toISOString(),
          metadata: { confirmed_ship_date: isoDate(shippedAt) },
        },
      ];
      if (hadProduction) {
        events.push({
          event_type: "production",
          actor: "supplier",
          occurred_at: productionAt.toISOString(),
        });
      }
      events.push({
        event_type: "shipped",
        actor: "supplier",
        occurred_at: shippedAt.toISOString(),
        metadata: {
          tracking_number: `1Z${Math.floor(rand() * 1e12)}`,
          carrier: pick(rand, ["UPS", "FedEx", "DHL"]),
        },
      });
      if (rand() > 0.35) {
        events.push({
          event_type: "in_transit",
          actor: "system",
          occurred_at: addHours(shippedAt, 24).toISOString(),
        });
      }
      events.push({
        event_type: "received",
        actor: "merchant",
        occurred_at: receivedAt.toISOString(),
      });
      events.push({
        event_type: "closed",
        actor: "merchant",
        occurred_at: closedAt.toISOString(),
      });

      await insertPo({
        supplierKey: spec.key,
        status: "closed",
        createdAt,
        requestedShip,
        confirmedShip: shippedAt,
        eta: addDays(shippedAt, 5),
        lineProducts: pickLines(spec.key, 2 + Math.floor(rand() * 2)),
        events,
        withReceipt: { at: receivedAt },
        withShipments: i === 0 && spec.key === "cascade",
        withDocument: i === 0 && spec.key === "cascade",
      });
    }
  }

  // ── Drafts ──────────────────────────────────────────────────────────────
  console.log("Seeding drafts / open lifecycle POs…");
  for (let i = 0; i < 3; i++) {
    const createdAt = addDays(now, -between(rand, 1, 8));
    await insertPo({
      supplierKey: pick(rand, ["cascade", "fernvale"] as const),
      status: "draft",
      createdAt,
      requestedShip: addDays(now, between(rand, 10, 25)),
      lineProducts: pickLines("cascade", 2),
      notes: "Draft — not sent yet (Salt & Fern real seed)",
      events: [
        {
          event_type: "draft",
          actor: "merchant",
          occurred_at: createdAt.toISOString(),
        },
      ],
    });
  }

  // Sent / viewed (awaiting confirm)
  for (let i = 0; i < 2; i++) {
    const createdAt = addDays(now, -between(rand, 3, 12));
    const sentAt = addHours(createdAt, 4);
    const key = i === 0 ? "pacific" : "fernvale";
    const events: Omit<TimelineEvent, "po_id">[] = [
      { event_type: "draft", actor: "merchant", occurred_at: createdAt.toISOString() },
      { event_type: "sent", actor: "merchant", occurred_at: sentAt.toISOString() },
    ];
    if (i === 1) {
      events.push({
        event_type: "viewed",
        actor: "system",
        occurred_at: addHours(sentAt, 18).toISOString(),
      });
    }
    await insertPo({
      supplierKey: key,
      status: i === 1 ? "viewed" : "sent",
      createdAt,
      requestedShip: addDays(now, 14),
      lineProducts: pickLines(key, 2),
      notes:
        i === 0
          ? "Sent — supplier has not opened yet"
          : "Viewed — waiting on confirmation",
      events,
    });
  }

  // Confirmed / production / shipped open
  {
    const createdAt = addDays(now, -18);
    const sentAt = addHours(createdAt, 3);
    const confirmedAt = addHours(sentAt, 20);
    await insertPo({
      supplierKey: "cascade",
      status: "confirmed",
      createdAt,
      requestedShip: addDays(now, 12),
      confirmedShip: addDays(now, 12),
      lineProducts: pickLines("cascade", 2),
      events: [
        { event_type: "draft", actor: "merchant", occurred_at: createdAt.toISOString() },
        { event_type: "sent", actor: "merchant", occurred_at: sentAt.toISOString() },
        { event_type: "viewed", actor: "system", occurred_at: addHours(sentAt, 6).toISOString() },
        {
          event_type: "confirmed",
          actor: "supplier",
          occurred_at: confirmedAt.toISOString(),
          metadata: { confirmed_ship_date: isoDate(addDays(now, 12)) },
        },
      ],
    });
  }
  {
    const createdAt = addDays(now, -25);
    const sentAt = addHours(createdAt, 2);
    const confirmedAt = addHours(sentAt, 30);
    const productionAt = addDays(confirmedAt, 4);
    await insertPo({
      supplierKey: "fernvale",
      status: "production",
      createdAt,
      requestedShip: addDays(now, 8),
      confirmedShip: addDays(now, 8),
      lineProducts: pickLines("fernvale", 2),
      events: [
        { event_type: "draft", actor: "merchant", occurred_at: createdAt.toISOString() },
        { event_type: "sent", actor: "merchant", occurred_at: sentAt.toISOString() },
        { event_type: "viewed", actor: "system", occurred_at: addHours(sentAt, 8).toISOString() },
        {
          event_type: "confirmed",
          actor: "supplier",
          occurred_at: confirmedAt.toISOString(),
          metadata: { confirmed_ship_date: isoDate(addDays(now, 8)) },
        },
        {
          event_type: "production",
          actor: "supplier",
          occurred_at: productionAt.toISOString(),
        },
      ],
    });
  }
  {
    const createdAt = addDays(now, -30);
    const sentAt = addHours(createdAt, 2);
    const confirmedAt = addHours(sentAt, 16);
    const shippedAt = addDays(now, -2);
    await insertPo({
      supplierKey: "cascade",
      status: "shipped",
      createdAt,
      requestedShip: shippedAt,
      confirmedShip: shippedAt,
      eta: addDays(now, 3),
      lineProducts: pickLines("cascade", 3),
      events: [
        { event_type: "draft", actor: "merchant", occurred_at: createdAt.toISOString() },
        { event_type: "sent", actor: "merchant", occurred_at: sentAt.toISOString() },
        { event_type: "viewed", actor: "system", occurred_at: addHours(sentAt, 5).toISOString() },
        {
          event_type: "confirmed",
          actor: "supplier",
          occurred_at: confirmedAt.toISOString(),
          metadata: { confirmed_ship_date: isoDate(shippedAt) },
        },
        {
          event_type: "shipped",
          actor: "supplier",
          occurred_at: shippedAt.toISOString(),
          metadata: { tracking_number: "1ZSFSHIPPED001", carrier: "UPS" },
        },
      ],
      withShipments: true,
    });
  }

  // Partially received with damage + backorder
  {
    const createdAt = addDays(now, -40);
    const sentAt = addHours(createdAt, 4);
    const confirmedAt = addHours(sentAt, 22);
    const shippedAt = addDays(now, -8);
    const partialAt = addDays(now, -1);
    await insertPo({
      supplierKey: "pacific",
      status: "partially_received",
      createdAt,
      requestedShip: addDays(shippedAt, -2),
      confirmedShip: shippedAt,
      eta: addDays(now, -1),
      lineProducts: pickLines("pacific", 2),
      notes: "Partial receive with damaged units — real seed",
      events: [
        { event_type: "draft", actor: "merchant", occurred_at: createdAt.toISOString() },
        { event_type: "sent", actor: "merchant", occurred_at: sentAt.toISOString() },
        { event_type: "viewed", actor: "system", occurred_at: addHours(sentAt, 10).toISOString() },
        {
          event_type: "confirmed",
          actor: "supplier",
          occurred_at: confirmedAt.toISOString(),
          metadata: { confirmed_ship_date: isoDate(shippedAt) },
        },
        {
          event_type: "shipped",
          actor: "supplier",
          occurred_at: shippedAt.toISOString(),
          metadata: { tracking_number: "1ZPARTIAL001", carrier: "FedEx" },
        },
        {
          event_type: "partially_received",
          actor: "merchant",
          occurred_at: partialAt.toISOString(),
        },
      ],
      withReceipt: {
        at: partialAt,
        partial: true,
        damage: true,
        backorder: true,
      },
    });
  }

  // Rejected
  {
    const createdAt = addDays(now, -20);
    const sentAt = addHours(createdAt, 2);
    const viewedAt = addHours(sentAt, 30);
    const rejectedAt = addHours(viewedAt, 12);
    await insertPo({
      supplierKey: "pacific",
      status: "rejected",
      createdAt,
      requestedShip: addDays(now, 20),
      lineProducts: pickLines("pacific", 2),
      notes: "Supplier rejected — capacity / MOQ (real seed)",
      events: [
        { event_type: "draft", actor: "merchant", occurred_at: createdAt.toISOString() },
        { event_type: "sent", actor: "merchant", occurred_at: sentAt.toISOString() },
        { event_type: "viewed", actor: "system", occurred_at: viewedAt.toISOString() },
        {
          event_type: "rejected",
          actor: "supplier",
          occurred_at: rejectedAt.toISOString(),
          metadata: { reason: "Cannot meet MOQ this season" },
        },
      ],
      rejected: true,
    });
  }

  // Verify scorecards
  const { data: scorecards, error: scErr } = await supabase
    .from("supplier_scorecards")
    .select(
      "supplier_id, completed_pos, on_time_pct, avg_confirmation_days",
    )
    .eq("workspace_id", workspaceId);
  if (scErr) throw scErr;

  const { data: supplierNames } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  const nameById = new Map(
    (supplierNames ?? []).map((s) => [s.id as string, s.name as string]),
  );

  const { data: statusCounts } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("workspace_id", workspaceId);

  const byStatus = new Map<string, number>();
  for (const row of statusCounts ?? []) {
    const s = row.status as string;
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }

  console.log("\n── Result summary (real workspace only) ──");
  console.log(`POs by status: ${JSON.stringify(Object.fromEntries(byStatus))}`);
  console.log(`Scorecards (need ≥${SCORECARD_MIN_CLOSED} closed):`);
  for (const row of scorecards ?? []) {
    const name = nameById.get(row.supplier_id as string) ?? row.supplier_id;
    const onTime =
      row.on_time_pct == null
        ? "—"
        : `${Math.round(Number(row.on_time_pct) * 1000) / 10}%`;
    console.log(
      `  ${name}: closed=${row.completed_pos} on_time=${onTime} avg_confirm_days=${row.avg_confirmation_days ?? "—"}`,
    );
  }

  console.log("\nDone. Open Salt & Fern in Admin → Today's Work / Products / Analytics.");
  console.log(
    "Optional: npx tsx --env-file=embedded/.env scripts/run-ai-agents.ts --workspace",
    workspaceId,
    "--force",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
