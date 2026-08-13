/**
 * Explicit free-text receiving check.
 * Usage: npx tsx scripts/smoke-freetext-receive.ts
 *
 * Creates a temporary shipped PO with one free-text line (no SKU),
 * runs completeReceiving, asserts receipt rows exist and inventory
 * levels are unchanged, then cleans up.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv(resolve("embedded/.env"));
loadEnv(resolve(".env.local"));
loadEnv(resolve(".env"));

const workspaceId =
  process.env.SMOKE_WORKSPACE_ID || "d9ddbe22-1e49-4be3-9bd0-b6750008af63";

async function main() {
  // Import after env so createServiceClient sees keys.
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: supplier, error: sErr } = await supabase
    .from("suppliers")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();
  if (sErr || !supplier) throw new Error(sErr?.message ?? "No supplier");

  const { data: location } = await supabase
    .from("locations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_primary", true)
    .maybeSingle();

  const { data: levelsBefore } = await supabase
    .from("inventory_levels")
    .select("id, product_variant_id, on_hand, updated_at")
    .eq("workspace_id", workspaceId);
  const beforeFingerprint = JSON.stringify(
    (levelsBefore ?? [])
      .map((r) => ({
        id: r.id,
        on_hand: r.on_hand,
        updated_at: r.updated_at,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

  const poNumber = `PO-FT-SMOKE-${Date.now().toString(36).toUpperCase()}`;
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .insert({
      workspace_id: workspaceId,
      supplier_id: supplier.id,
      location_id: location?.id ?? null,
      po_number: poNumber,
      status: "shipped",
      subtotal: 10,
      total: 10,
      notes: "free-text receive smoke — safe to delete",
    })
    .select("id")
    .single();
  if (poErr) throw new Error(poErr.message);

  const { data: line, error: lineErr } = await supabase
    .from("po_line_items")
    .insert({
      po_id: po.id,
      description: "Smoke free-text packing inserts",
      sku: null,
      qty: 5,
      unit_cost: 2,
      line_total: 10,
      is_free_text: true,
      sort_order: 0,
    })
    .select("id, is_free_text, sku")
    .single();
  if (lineErr) throw new Error(lineErr.message);

  await supabase.from("po_timeline_events").insert({
    po_id: po.id,
    event_type: "shipped",
    actor: "system",
    metadata: { smoke: true },
  });

  // Load receiving module from embedded (relative import via dynamic path).
  const receivingUrl = pathToFileURL(
    resolve("embedded/app/lib/receiving.server.ts"),
  ).href;
  const { completeReceiving } = await import(receivingUrl);

  let receiveError: string | null = null;
  let nextStatus: string | null = null;
  try {
    const result = await completeReceiving({
      workspaceId,
      poId: po.id,
      note: "free-text smoke receive",
      lines: [
        {
          po_line_item_id: line.id,
          qty_received: 5,
          condition: "good",
        },
      ],
      // No Shopify admin — inventory GraphQL must not be required for free-text.
      admin: undefined,
    });
    nextStatus = result.nextStatus;
  } catch (err) {
    receiveError = err instanceof Error ? err.message : String(err);
  }

  const { data: receipts } = await supabase
    .from("receipts")
    .select("id, note, receipt_line_items(id, po_line_item_id, qty_received, condition)")
    .eq("po_id", po.id);

  const { data: levelsAfter } = await supabase
    .from("inventory_levels")
    .select("id, product_variant_id, on_hand, updated_at")
    .eq("workspace_id", workspaceId);
  const afterFingerprint = JSON.stringify(
    (levelsAfter ?? [])
      .map((r) => ({
        id: r.id,
        on_hand: r.on_hand,
        updated_at: r.updated_at,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

  const receiptLines =
    (receipts ?? []).flatMap(
      (r) =>
        (r.receipt_line_items as Array<{
          po_line_item_id: string;
          qty_received: number;
          condition: string;
        }>) ?? [],
    ) ?? [];

  const report = {
    poNumber,
    poId: po.id,
    line: {
      id: line.id,
      is_free_text: line.is_free_text,
      sku: line.sku,
    },
    receiveError,
    nextStatus,
    receiptCount: receipts?.length ?? 0,
    receiptLine: receiptLines[0] ?? null,
    inventoryLevelsUnchanged: beforeFingerprint === afterFingerprint,
    inventoryLevelCountBefore: levelsBefore?.length ?? 0,
    inventoryLevelCountAfter: levelsAfter?.length ?? 0,
  };

  // Cleanup smoke PO (cascades receipt / lines / timeline).
  await supabase.from("purchase_orders").delete().eq("id", po.id);

  console.log(JSON.stringify(report, null, 2));

  const ok =
    !receiveError &&
    report.receiptCount === 1 &&
    report.receiptLine?.qty_received === 5 &&
    report.receiptLine?.po_line_item_id === line.id &&
    report.inventoryLevelsUnchanged &&
    (nextStatus === "closed" || nextStatus === "partially_received");

  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
