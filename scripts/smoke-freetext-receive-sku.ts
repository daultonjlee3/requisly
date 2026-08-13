/**
 * Free-text line that still has a catalog-matching SKU — inventory must skip.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

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

const workspaceId =
  process.env.SMOKE_WORKSPACE_ID || "d9ddbe22-1e49-4be3-9bd0-b6750008af63";

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: variant, error: vErr } = await supabase
    .from("product_variants")
    .select("id, sku")
    .eq("workspace_id", workspaceId)
    .not("sku", "is", null)
    .limit(1)
    .single();
  if (vErr || !variant?.sku) throw new Error(vErr?.message ?? "No variant");

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1)
    .single();
  const { data: location } = await supabase
    .from("locations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_primary", true)
    .maybeSingle();

  const { data: levelsBefore } = await supabase
    .from("inventory_levels")
    .select("id, on_hand, updated_at")
    .eq("workspace_id", workspaceId);
  const before = JSON.stringify(
    (levelsBefore ?? [])
      .map((r) => ({ id: r.id, on_hand: r.on_hand, updated_at: r.updated_at }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

  const poNumber = `PO-FT-SKU-${Date.now().toString(36).toUpperCase()}`;
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .insert({
      workspace_id: workspaceId,
      supplier_id: supplier!.id,
      location_id: location?.id ?? null,
      po_number: poNumber,
      status: "shipped",
      subtotal: 3,
      total: 3,
      notes: "free-text+catalog-sku smoke",
    })
    .select("id")
    .single();
  if (poErr) throw new Error(poErr.message);

  const { data: line, error: lineErr } = await supabase
    .from("po_line_items")
    .insert({
      po_id: po.id,
      description: "Free-text but catalog SKU",
      sku: variant.sku,
      qty: 3,
      unit_cost: 1,
      line_total: 3,
      is_free_text: true,
      sort_order: 0,
    })
    .select("id, sku, is_free_text")
    .single();
  if (lineErr) throw new Error(lineErr.message);

  await supabase.from("po_timeline_events").insert({
    po_id: po.id,
    event_type: "shipped",
    actor: "system",
    metadata: { smoke: true },
  });

  const { completeReceiving } = await import(
    pathToFileURL(resolve("embedded/app/lib/receiving.server.ts")).href
  );

  let receiveError: string | null = null;
  let nextStatus: string | null = null;
  try {
    const result = await completeReceiving({
      workspaceId,
      poId: po.id,
      note: "sku match free-text",
      lines: [
        {
          po_line_item_id: line.id,
          qty_received: 3,
          condition: "good",
        },
      ],
    });
    nextStatus = result.nextStatus;
  } catch (err) {
    receiveError = err instanceof Error ? err.message : String(err);
  }

  const { data: receipts } = await supabase
    .from("receipts")
    .select("id, receipt_line_items(qty_received)")
    .eq("po_id", po.id);

  const { data: levelsAfter } = await supabase
    .from("inventory_levels")
    .select("id, on_hand, updated_at")
    .eq("workspace_id", workspaceId);
  const after = JSON.stringify(
    (levelsAfter ?? [])
      .map((r) => ({ id: r.id, on_hand: r.on_hand, updated_at: r.updated_at }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

  await supabase.from("purchase_orders").delete().eq("id", po.id);

  const report = {
    matchedSku: variant.sku,
    isFreeText: line.is_free_text,
    receiveError,
    nextStatus,
    receiptCount: receipts?.length ?? 0,
    inventoryUnchanged: before === after,
  };
  console.log(JSON.stringify(report, null, 2));

  if (
    receiveError ||
    !report.inventoryUnchanged ||
    report.receiptCount !== 1
  ) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
