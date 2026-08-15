/**
 * Item 7 — make-to-order suggestions (never auto-create).
 *
 *   npx tsx --env-file=embedded/.env scripts/test-mto-suggestions.ts
 */
const SALT_FERN_ID = "eb7e12e6-4572-466a-8424-71cc515502cd";
const COMPARE_AT_VARIANT = "891eb656-52fb-437a-9185-85a901f43c95";

async function main() {
  const {
    listMakeToOrderSuggestions,
    acceptMakeToOrderSuggestion,
  } = await import("../embedded/app/lib/manufacturing.server.ts");
  const { createServiceClient } = await import(
    "../embedded/app/lib/supabase.server.ts"
  );

  const supabase = createServiceClient();

  // Snapshot + zero finished stock so #1005 Compare-at creates a shortfall.
  const { data: levels, error: levErr } = await supabase
    .from("inventory_levels")
    .select("id, location_id, on_hand")
    .eq("workspace_id", SALT_FERN_ID)
    .eq("product_variant_id", COMPARE_AT_VARIANT);
  if (levErr) throw new Error(levErr.message);
  const snapshot = (levels ?? []).map((l) => ({
    id: l.id as string,
    on_hand: Number(l.on_hand ?? 0),
  }));
  console.log("Snapshot on_hand:", snapshot);

  for (const row of snapshot) {
    const { error } = await supabase
      .from("inventory_levels")
      .update({ on_hand: 0, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("workspace_id", SALT_FERN_ID);
    if (error) throw new Error(error.message);
  }

  try {
    const before = await listMakeToOrderSuggestions(SALT_FERN_ID);
    console.log(
      "Suggestions after zero stock:",
      before.map((s) => ({
        order: s.orderName,
        product: s.finishedTitle,
        need: s.lineQuantity,
        onHand: s.onHandTotal,
        make: s.qtyToMake,
        synthetic: s.isSyntheticTest,
      })),
    );

    const hit = before.find(
      (s) => s.productVariantId === COMPARE_AT_VARIANT,
    );
    if (!hit) {
      throw new Error("Expected Compare-at MTO suggestion after zeroing stock");
    }

    const { id: moId } = await acceptMakeToOrderSuggestion({
      workspaceId: SALT_FERN_ID,
      salesOrderId: hit.salesOrderId,
      productVariantId: hit.productVariantId,
      qtyToMake: hit.qtyToMake,
      locationId: hit.suggestedLocationId,
    });
    console.log("Accepted → draft MO", moId);

    const after = await listMakeToOrderSuggestions(SALT_FERN_ID);
    const stillThere = after.find(
      (s) =>
        s.salesOrderId === hit.salesOrderId &&
        s.productVariantId === hit.productVariantId,
    );
    console.log(
      "Suggestion cleared after accept:",
      stillThere ? "NO (bug)" : "yes",
    );

    const { data: mo, error: moErr } = await supabase
      .from("manufacturing_orders")
      .select("id, mode, status, linked_sales_order_id, qty_to_make, notes")
      .eq("id", moId)
      .single();
    if (moErr) throw new Error(moErr.message);
    console.log("MO row:", mo);

    // Dedup: accept again must fail
    let dedupOk = false;
    try {
      await acceptMakeToOrderSuggestion({
        workspaceId: SALT_FERN_ID,
        salesOrderId: hit.salesOrderId,
        productVariantId: hit.productVariantId,
        qtyToMake: hit.qtyToMake,
        locationId: hit.suggestedLocationId,
      });
    } catch (err) {
      dedupOk = String(err).includes("already exists");
      console.log("Dedup reject:", String(err));
    }
    console.log("Dedup enforced:", dedupOk ? "yes" : "NO (bug)");
  } finally {
    for (const row of snapshot) {
      await supabase
        .from("inventory_levels")
        .update({
          on_hand: row.on_hand,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("workspace_id", SALT_FERN_ID);
    }
    console.log("Restored on_hand snapshot");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
