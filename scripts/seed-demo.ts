/**
 * Seed a demo workspace (is_demo = true) with realistic PO history for Phase 2 analytics.
 *
 * Usage:
 *   npx tsx scripts/seed-demo.ts
 *   npx tsx scripts/seed-demo.ts --attach-profile <profile-uuid>
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local
 *
 * Idempotent for the named demo workspace: deletes prior demo suppliers/POs and reseeds.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEMO_WORKSPACE_NAME = "Requisly Demo";
const MIN_HISTORY = 5;

type SupplierPersona = {
  key: string;
  name: string;
  email: string;
  contact_name: string;
  payment_terms: string;
  notes: string;
  /** Closed POs to generate */
  closedCount: number;
  /** Hours until confirm after send — [min, max] */
  confirmHours: [number, number];
  /** Days ship vs requested_ship_date — negative = early */
  shipDayOffset: [number, number];
  /** Probability a line has a quality issue */
  damageRate: number;
  backorderRate: number;
  catalog: Array<{ description: string; sku: string; unit_cost: number }>;
};

const PERSONAS: SupplierPersona[] = [
  {
    key: "harbor",
    name: "Harbor Textile Co",
    email: "orders@harbortextile.example",
    contact_name: "Mei Chen",
    payment_terms: "Net 30",
    notes: "Reliable mill — usually confirms same day.",
    closedCount: 12,
    confirmHours: [2, 28],
    shipDayOffset: [-2, 1],
    damageRate: 0.04,
    backorderRate: 0.02,
    catalog: [
      { description: "Organic cotton jersey — Natural", sku: "HT-JER-NAT", unit_cost: 4.25 },
      { description: "Organic cotton jersey — Ink", sku: "HT-JER-INK", unit_cost: 4.4 },
      { description: "French terry — Heather", sku: "HT-FT-HEA", unit_cost: 5.1 },
      { description: "Rib cuff roll — Black", sku: "HT-RIB-BLK", unit_cost: 1.85 },
    ],
  },
  {
    key: "pacific",
    name: "Pacific Packaging Ltd",
    email: "ops@pacificpack.example",
    contact_name: "Diego Morales",
    payment_terms: "Net 45",
    notes: "Slow to confirm; ships late often.",
    closedCount: 10,
    confirmHours: [48, 120],
    shipDayOffset: [2, 9],
    damageRate: 0.08,
    backorderRate: 0.12,
    catalog: [
      { description: "Mailer box — Medium", sku: "PP-BOX-M", unit_cost: 0.92 },
      { description: "Mailer box — Large", sku: "PP-BOX-L", unit_cost: 1.35 },
      { description: "Tissue sheets — Brand print", sku: "PP-TIS-BR", unit_cost: 0.18 },
      { description: "Poly mailer — 10x13", sku: "PP-PLY-1013", unit_cost: 0.11 },
    ],
  },
  {
    key: "northline",
    name: "Northline Components",
    email: "desk@northline.example",
    contact_name: "Sara Okonkwo",
    payment_terms: "Net 30",
    notes: "Mixed quality — occasional damaged cartons.",
    closedCount: 8,
    confirmHours: [12, 60],
    shipDayOffset: [-1, 4],
    damageRate: 0.22,
    backorderRate: 0.08,
    catalog: [
      { description: "YKK zipper #5 — Black", sku: "NL-ZIP-5B", unit_cost: 0.42 },
      { description: "Metal logo tag — Antique brass", sku: "NL-TAG-AB", unit_cost: 0.65 },
      { description: "Drawcord — 5mm natural", sku: "NL-CORD-5N", unit_cost: 0.28 },
      { description: "Eyelets pack — Antique brass", sku: "NL-EYE-AB", unit_cost: 0.09 },
    ],
  },
  {
    key: "atlas",
    name: "Atlas Trim Supply",
    email: "hello@atlastrim.example",
    contact_name: "Jon Park",
    payment_terms: "Prepaid",
    notes: "New supplier — not enough closed history for scorecards yet.",
    closedCount: 3, // intentionally < MIN_HISTORY
    confirmHours: [6, 36],
    shipDayOffset: [0, 2],
    damageRate: 0.05,
    backorderRate: 0.05,
    catalog: [
      { description: "Woven label — Main", sku: "AT-LAB-MAIN", unit_cost: 0.14 },
      { description: "Care label — Standard", sku: "AT-LAB-CARE", unit_cost: 0.08 },
      { description: "Hangtag — Kraft", sku: "AT-TAG-KFT", unit_cost: 0.22 },
    ],
  },
  {
    key: "metro",
    name: "Metro Labels Inc",
    email: "fulfillment@metrolabels.example",
    contact_name: "Priya Shah",
    payment_terms: "Net 15",
    notes: "High volume; occasional backorders on specialty SKUs.",
    closedCount: 14,
    confirmHours: [4, 40],
    shipDayOffset: [-1, 3],
    damageRate: 0.03,
    backorderRate: 0.15,
    catalog: [
      { description: "Heat transfer — Size set", sku: "ML-HT-SIZE", unit_cost: 0.31 },
      { description: "Heat transfer — Brand mark", sku: "ML-HT-BRAND", unit_cost: 0.48 },
      { description: "Sticker sheet — Thank you", sku: "ML-STK-TY", unit_cost: 0.06 },
      { description: "Barcode label roll", sku: "ML-BC-ROLL", unit_cost: 12.5 },
    ],
  },
];

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
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

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function mulberry32(seed: number) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function between(rand: () => number, min: number, max: number) {
  return min + rand() * (max - min);
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

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const attachProfile =
    argValue("--attach-profile") ?? process.env.DEMO_ATTACH_PROFILE_ID;

  console.log(`Seeding demo workspace "${DEMO_WORKSPACE_NAME}"…`);
  console.log(`Scorecard threshold: ${MIN_HISTORY} completed POs`);

  // Find or create demo workspace
  let { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, is_demo")
    .eq("name", DEMO_WORKSPACE_NAME)
    .maybeSingle();

  if (!workspace) {
    const { data: created, error } = await supabase
      .from("workspaces")
      .insert({ name: DEMO_WORKSPACE_NAME, is_demo: true })
      .select("id, name, is_demo")
      .single();
    if (error) throw error;
    workspace = created;
    console.log("Created workspace", workspace.id);
  } else {
    await supabase
      .from("workspaces")
      .update({ is_demo: true })
      .eq("id", workspace.id);
    console.log("Reusing workspace", workspace.id);
  }

  const workspaceId = workspace.id as string;

  // Wipe prior demo purchasing data (order matters for FKs)
  const { data: existingPos } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("workspace_id", workspaceId);
  const poIds = (existingPos ?? []).map((p) => p.id);

  if (poIds.length) {
    const { data: receipts } = await supabase
      .from("receipts")
      .select("id")
      .in("po_id", poIds);
    const receiptIds = (receipts ?? []).map((r) => r.id);
    if (receiptIds.length) {
      await supabase.from("receipt_line_items").delete().in("receipt_id", receiptIds);
      await supabase.from("receipts").delete().in("id", receiptIds);
    }
    await supabase.from("po_timeline_events").delete().in("po_id", poIds);
    await supabase.from("supplier_link_tokens").delete().in("po_id", poIds);
    await supabase.from("po_documents").delete().in("po_id", poIds);
    // proposals cascade via line items; delete lines then POs
    await supabase.from("po_line_items").delete().in("po_id", poIds);
    await supabase.from("purchase_orders").delete().in("id", poIds);
  }

  await supabase.from("supplier_products").delete().eq("workspace_id", workspaceId);
  await supabase.from("suppliers").delete().eq("workspace_id", workspaceId);
  await supabase.from("notification_log").delete().eq("workspace_id", workspaceId);
  await supabase.from("notification_rules").delete().eq("workspace_id", workspaceId);

  // Location
  let { data: location } = await supabase
    .from("locations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_primary", true)
    .maybeSingle();

  if (!location) {
    const { data: loc, error } = await supabase
      .from("locations")
      .insert({
        workspace_id: workspaceId,
        name: "Primary warehouse",
        is_primary: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    location = loc;
  }

  // Add explorer as a member of the demo workspace — never re-point home workspace_id.
  let profileId = attachProfile;
  if (!profileId) {
    const { data: owners } = await supabase
      .from("profiles")
      .select("id, workspace_id, full_name")
      .eq("role", "owner")
      .limit(5);
    if (owners?.length === 1) {
      profileId = owners[0]!.id;
      console.log(
        `Linking sole owner profile ${owners[0]!.full_name ?? profileId} as demo member`,
      );
    } else if (owners && owners.length > 1) {
      console.warn(
        "Multiple owner profiles found. Pass --attach-profile <uuid> to add demo membership.",
      );
    } else {
      console.warn("No owner profile found — seed will run without created_by/received_by.");
    }
  }

  let previousWorkspaceId: string | null = null;
  if (profileId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, workspace_id, active_workspace_id")
      .eq("id", profileId)
      .maybeSingle();
    if (!profile) throw new Error(`Profile not found: ${profileId}`);
    previousWorkspaceId = profile.workspace_id;

    const { error: memberErr } = await supabase.from("workspace_members").upsert(
      {
        workspace_id: workspaceId,
        profile_id: profileId,
        role: "owner",
        joined_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,profile_id" },
    );
    if (memberErr) throw memberErr;
    console.log(
      `Ensured workspace_members row for demo (home workspace unchanged: ${previousWorkspaceId})`,
    );
  }

  // Default notification rules for the demo workspace
  await supabase.from("notification_rules").insert([
    { workspace_id: workspaceId, rule_type: "po_not_confirmed", enabled: true, threshold_value: 3 },
    { workspace_id: workspaceId, rule_type: "shipment_delayed", enabled: true, threshold_value: 1 },
    { workspace_id: workspaceId, rule_type: "arriving_soon", enabled: true, threshold_value: 1 },
    { workspace_id: workspaceId, rule_type: "inventory_low", enabled: false, threshold_value: null },
  ]);

  const rand = mulberry32(20260805);
  let poSeq = 0;
  const now = new Date();
  // Spread history across ~8 months
  const historyStart = addDays(now, -240);

  type InsertedSupplier = { id: string; persona: SupplierPersona };
  const suppliers: InsertedSupplier[] = [];

  for (const persona of PERSONAS) {
    const { data: supplier, error } = await supabase
      .from("suppliers")
      .insert({
        workspace_id: workspaceId,
        name: persona.name,
        email: persona.email,
        contact_name: persona.contact_name,
        payment_terms: persona.payment_terms,
        notes: persona.notes,
        currency: "USD",
      })
      .select("id")
      .single();
    if (error) throw error;
    suppliers.push({ id: supplier.id, persona });

    const products = persona.catalog.map((c) => ({
      workspace_id: workspaceId,
      supplier_id: supplier.id,
      title: c.description,
      sku: c.sku,
      unit_cost: c.unit_cost, // deprecated cache; schedule row is source of truth
      case_qty: 12,
      moq: 24,
    }));
    const { data: insertedProducts, error: prodErr } = await supabase
      .from("supplier_products")
      .insert(products)
      .select("id, unit_cost, created_at");
    if (prodErr) throw prodErr;

    if (insertedProducts?.length) {
      const priceRows = insertedProducts
        .filter((p) => p.unit_cost != null)
        .map((p) => ({
          supplier_product_id: p.id,
          unit_cost: p.unit_cost,
          // Calendar date in US Eastern — avoid UTC day-shift from created_at.
          effective_date: new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/New_York",
          }).format(new Date(p.created_at as string)),
        }));
      if (priceRows.length) {
        const { error: priceErr } = await supabase
          .from("supplier_product_prices")
          .insert(priceRows);
        if (priceErr) throw priceErr;
      }
    }
  }

  let closedTotal = 0;
  let openTotal = 0;
  let damagedLines = 0;
  let backorderLines = 0;

  for (const { id: supplierId, persona } of suppliers) {
    for (let i = 0; i < persona.closedCount; i++) {
      poSeq += 1;
      const createdAt = addDays(
        historyStart,
        between(rand, 0, 230) + i * 0.3,
      );
      const sentAt = addHours(createdAt, between(rand, 1, 18));
      const viewedAt = addHours(sentAt, between(rand, 1, 30));
      const confirmHours = between(
        rand,
        persona.confirmHours[0],
        persona.confirmHours[1],
      );
      const confirmedAt = addHours(sentAt, confirmHours);

      const leadDays = Math.round(between(rand, 14, 35));
      const requestedShip = addDays(confirmedAt, leadDays);
      const shipOffset = between(
        rand,
        persona.shipDayOffset[0],
        persona.shipDayOffset[1],
      );
      const shippedAt = addDays(requestedShip, shipOffset);
      const confirmedShipDate = isoDate(shippedAt);
      const inTransitAt = addHours(shippedAt, between(rand, 12, 48));
      const receivedAt = addDays(shippedAt, between(rand, 3, 10));
      const closedAt = addHours(receivedAt, between(rand, 1, 12));

      const lineCount = 2 + Math.floor(rand() * 3);
      const lines = Array.from({ length: lineCount }, (_, li) => {
        const item = pick(rand, persona.catalog);
        const qty = 24 + Math.floor(rand() * 10) * 12;
        const unit = money(item.unit_cost * between(rand, 0.95, 1.08));
        return {
          description: item.description,
          sku: item.sku,
          is_free_text: true,
          qty,
          unit_cost: unit,
          line_total: money(qty * unit),
          sort_order: li,
        };
      });
      const total = money(lines.reduce((s, l) => s + l.line_total, 0));

      const poNumber = `PO-D${String(poSeq).padStart(4, "0")}`;
      const { data: po, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({
          workspace_id: workspaceId,
          po_number: poNumber,
          supplier_id: supplierId,
          location_id: location!.id,
          status: "closed",
          currency: "USD",
          notes: "Seeded demo PO",
          subtotal: total,
          total,
          requested_ship_date: isoDate(requestedShip),
          confirmed_ship_date: confirmedShipDate,
          estimated_arrival_date: isoDate(addDays(shippedAt, 5)),
          created_by: profileId ?? null,
          created_at: createdAt.toISOString(),
          updated_at: closedAt.toISOString(),
        })
        .select("id")
        .single();
      if (poErr) throw poErr;

      const lineRows = lines.map((l) => ({ ...l, po_id: po.id }));
      const { data: insertedLines, error: lineErr } = await supabase
        .from("po_line_items")
        .insert(lineRows)
        .select("id, qty");
      if (lineErr) throw lineErr;

      const events: Array<{
        po_id: string;
        event_type: string;
        actor: string;
        occurred_at: string;
        metadata?: Record<string, unknown>;
      }> = [
        { po_id: po.id, event_type: "draft", actor: "merchant", occurred_at: createdAt.toISOString() },
        { po_id: po.id, event_type: "sent", actor: "merchant", occurred_at: sentAt.toISOString() },
        { po_id: po.id, event_type: "viewed", actor: "system", occurred_at: viewedAt.toISOString() },
        {
          po_id: po.id,
          event_type: "confirmed",
          actor: "supplier",
          occurred_at: confirmedAt.toISOString(),
          metadata: { confirmed_ship_date: confirmedShipDate },
        },
      ];
      if (rand() > 0.35) {
        events.push({
          po_id: po.id,
          event_type: "production",
          actor: "supplier",
          occurred_at: addDays(confirmedAt, between(rand, 2, 8)).toISOString(),
        });
      }
      events.push({
        po_id: po.id,
        event_type: "shipped",
        actor: "supplier",
        occurred_at: shippedAt.toISOString(),
        metadata: {
          tracking_number: `1Z${Math.floor(rand() * 1e12)}`,
          carrier: pick(rand, ["UPS", "FedEx", "DHL"]),
        },
      });
      if (rand() > 0.4) {
        events.push({
          po_id: po.id,
          event_type: "in_transit",
          actor: "system",
          occurred_at: inTransitAt.toISOString(),
        });
      }

      // Receipts — mostly full good; some damaged / backorder shortfalls
      const receiptLines: Array<{
        po_line_item_id: string;
        qty_received: number;
        condition: "good" | "damaged" | "wrong_item" | "backorder";
        reason_note: string | null;
      }> = [];

      let anyPartial = false;
      for (const line of insertedLines ?? []) {
        const roll = rand();
        if (roll < persona.damageRate) {
          const goodQty = Math.max(0, line.qty - Math.ceil(line.qty * between(rand, 0.05, 0.2)));
          const damagedQty = line.qty - goodQty;
          receiptLines.push({
            po_line_item_id: line.id,
            qty_received: goodQty,
            condition: "good",
            reason_note: null,
          });
          receiptLines.push({
            po_line_item_id: line.id,
            qty_received: damagedQty,
            condition: "damaged",
            reason_note: "Carton crushed in transit — seed demo",
          });
          damagedLines += 1;
          anyPartial = true;
        } else if (roll < persona.damageRate + persona.backorderRate) {
          const received = Math.floor(line.qty * between(rand, 0.55, 0.85));
          receiptLines.push({
            po_line_item_id: line.id,
            qty_received: received,
            condition: "good",
            reason_note: null,
          });
          receiptLines.push({
            po_line_item_id: line.id,
            qty_received: 0,
            condition: "backorder",
            reason_note: `Backordered ${line.qty - received} units — seed demo`,
          });
          backorderLines += 1;
          anyPartial = true;
        } else {
          receiptLines.push({
            po_line_item_id: line.id,
            qty_received: line.qty,
            condition: "good",
            reason_note: null,
          });
        }
      }

      if (anyPartial) {
        events.push({
          po_id: po.id,
          event_type: "partially_received",
          actor: "merchant",
          occurred_at: receivedAt.toISOString(),
        });
      }
      events.push({
        po_id: po.id,
        event_type: "received",
        actor: "merchant",
        occurred_at: addHours(receivedAt, anyPartial ? 2 : 0).toISOString(),
      });
      events.push({
        po_id: po.id,
        event_type: "closed",
        actor: anyPartial ? "merchant" : "system",
        occurred_at: closedAt.toISOString(),
        metadata: anyPartial ? { reason: "manual_close_shortfall" } : {},
      });

      const { error: evErr } = await supabase.from("po_timeline_events").insert(events);
      if (evErr) throw evErr;

      const { data: receipt, error: recErr } = await supabase
        .from("receipts")
        .insert({
          po_id: po.id,
          workspace_id: workspaceId,
          received_by: profileId ?? null,
          note: anyPartial ? "Partial receive — demo seed" : null,
          created_at: receivedAt.toISOString(),
        })
        .select("id")
        .single();
      if (recErr) throw recErr;

      const { error: rliErr } = await supabase.from("receipt_line_items").insert(
        receiptLines.map((r) => ({ ...r, receipt_id: receipt.id })),
      );
      if (rliErr) throw rliErr;

      closedTotal += 1;
    }

    // A few open POs in flight for dashboard realism
    const openStatuses: Array<"sent" | "viewed" | "confirmed" | "shipped" | "in_transit"> = [
      "sent",
      "viewed",
      "confirmed",
      "shipped",
      "in_transit",
    ];
    for (const status of openStatuses.slice(0, persona.key === "atlas" ? 2 : 3)) {
      poSeq += 1;
      const createdAt = addDays(now, -between(rand, 2, 20));
      const sentAt = addHours(createdAt, 4);
      const item = pick(rand, persona.catalog);
      const qty = 48;
      const unit = item.unit_cost;
      const total = money(qty * unit);
      const requestedShip = addDays(now, between(rand, 5, 25));

      const { data: po, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({
          workspace_id: workspaceId,
          po_number: `PO-D${String(poSeq).padStart(4, "0")}`,
          supplier_id: supplierId,
          location_id: location!.id,
          status,
          currency: "USD",
          subtotal: total,
          total,
          requested_ship_date: isoDate(requestedShip),
          confirmed_ship_date:
            status === "confirmed" || status === "shipped" || status === "in_transit"
              ? isoDate(requestedShip)
              : null,
          estimated_arrival_date:
            status === "shipped" || status === "in_transit"
              ? isoDate(addDays(requestedShip, 5))
              : null,
          created_by: profileId ?? null,
          created_at: createdAt.toISOString(),
          updated_at: sentAt.toISOString(),
        })
        .select("id")
        .single();
      if (poErr) throw poErr;

      await supabase.from("po_line_items").insert({
        po_id: po.id,
        description: item.description,
        sku: item.sku,
        is_free_text: true,
        qty,
        unit_cost: unit,
        line_total: total,
        sort_order: 0,
      });

      const openEvents: Array<{
        po_id: string;
        event_type: string;
        actor: string;
        occurred_at: string;
      }> = [
        { po_id: po.id, event_type: "draft", actor: "merchant", occurred_at: createdAt.toISOString() },
        { po_id: po.id, event_type: "sent", actor: "merchant", occurred_at: sentAt.toISOString() },
      ];
      if (["viewed", "confirmed", "shipped", "in_transit"].includes(status)) {
        openEvents.push({
          po_id: po.id,
          event_type: "viewed",
          actor: "system",
          occurred_at: addHours(sentAt, 6).toISOString(),
        });
      }
      if (["confirmed", "shipped", "in_transit"].includes(status)) {
        openEvents.push({
          po_id: po.id,
          event_type: "confirmed",
          actor: "supplier",
          occurred_at: addHours(sentAt, 24).toISOString(),
        });
      }
      if (["shipped", "in_transit"].includes(status)) {
        openEvents.push({
          po_id: po.id,
          event_type: "shipped",
          actor: "supplier",
          occurred_at: addDays(sentAt, 10).toISOString(),
        });
      }
      if (status === "in_transit") {
        openEvents.push({
          po_id: po.id,
          event_type: "in_transit",
          actor: "system",
          occurred_at: addDays(sentAt, 11).toISOString(),
        });
      }
      await supabase.from("po_timeline_events").insert(openEvents);
      openTotal += 1;
    }
  }

  // Verify scorecards
  const { data: scorecards, error: scErr } = await supabase
    .from("supplier_scorecards")
    .select("*")
    .eq("workspace_id", workspaceId);
  if (scErr) throw scErr;

  console.log("\nSeed complete.");
  console.log({
    workspaceId,
    is_demo: true,
    closedPos: closedTotal,
    openPos: openTotal,
    damagedLineEvents: damagedLines,
    backorderLineEvents: backorderLines,
    memberProfileId: profileId ?? null,
    homeWorkspaceUnchanged: previousWorkspaceId,
  });
  console.log("\nScorecards:");
  for (const row of scorecards ?? []) {
    const supplier = suppliers.find((s) => s.id === row.supplier_id);
    const enough = (row.completed_pos ?? 0) >= MIN_HISTORY;
    console.log(
      `  ${supplier?.persona.name ?? row.supplier_id}: completed=${row.completed_pos}` +
        ` on_time=${row.on_time_pct == null ? "—" : `${Math.round(Number(row.on_time_pct) * 100)}%`}` +
        ` fill=${row.fill_rate == null ? "—" : `${Math.round(Number(row.fill_rate) * 100)}%`}` +
        ` confirm_days=${row.avg_confirmation_days == null ? "—" : Number(row.avg_confirmation_days).toFixed(1)}` +
        (enough ? "" : "  ← not enough history"),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
