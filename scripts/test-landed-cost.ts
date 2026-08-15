/**
 * Item 10 — landed cost on supplier_product_prices.
 *
 *   npx tsx --env-file=embedded/.env scripts/test-landed-cost.ts
 */
const SALT_FERN_ID = "eb7e12e6-4572-466a-8424-71cc515502cd";
const PRODUCT_ID = "8864e397-8f42-4267-9524-64e35c4029e9"; // Gift Card $10

async function main() {
  const {
    allocateLandedCosts,
    computeLandedUnitCost,
    currentLandedUnitCostAsOf,
    currentUnitCostAsOf,
    todayDateInputValue,
  } = await import("../embedded/app/lib/pricing.ts");
  const {
    getSupplierProductDetail,
    scheduleSupplierProductPrice,
    deleteSupplierProductPrice,
  } = await import("../embedded/app/lib/products.server.ts");
  const { createServiceClient } = await import(
    "../embedded/app/lib/supabase.server.ts"
  );

  // Pure allocation: $100 freight across 2 lines by value
  const alloc = allocateLandedCosts({
    freightTotal: 100,
    dutyTotal: 20,
    customsTotal: 5,
    method: "by_value",
    lines: [
      { key: "a", qty: 10, unitCost: 10 }, // value 100
      { key: "b", qty: 5, unitCost: 20 }, // value 100
    ],
  });
  console.log("Allocation by_value:", alloc);
  const freightSum = alloc.reduce((s, l) => s + l.freightPerUnit * l.qty, 0);
  console.log(
    "Freight totals ~100:",
    Math.abs(freightSum - 100) < 0.02 ? "yes" : `NO (${freightSum})`,
  );

  const form = new FormData();
  form.set("supplier_product_id", PRODUCT_ID);
  form.set("unit_cost", "9.20");
  form.set("freight_per_unit", "0.50");
  form.set("duty_per_unit", "0.25");
  form.set("customs_per_unit", "0.10");
  form.set("effective_date", todayDateInputValue());

  await scheduleSupplierProductPrice(SALT_FERN_ID, form);

  const detail = await getSupplierProductDetail(SALT_FERN_ID, PRODUCT_ID);
  console.log("Detail current FOB:", detail?.currentCost);
  console.log("Detail current landed:", detail?.currentLandedCost);
  const current = detail?.schedule.find((s) => s.status === "Current");
  console.log("Current schedule row:", current);

  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("supplier_product_prices")
    .select(
      "id, unit_cost, freight_per_unit, duty_per_unit, customs_per_unit, landed_unit_cost, effective_date, created_at",
    )
    .eq("supplier_product_id", PRODUCT_ID)
    .eq("effective_date", todayDateInputValue())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log("DB row:", row);
  const expected = 9.2 + 0.5 + 0.25 + 0.1;
  const landed = Number(row?.landed_unit_cost);
  console.log(
    "Generated landed == 10.05:",
    Math.abs(landed - expected) < 0.001 ? "yes" : `NO (${landed})`,
  );
  console.log(
    "Helper computeLanded:",
    computeLandedUnitCost(row as never),
  );
  console.log(
    "AsOf FOB/landed:",
    currentUnitCostAsOf([row as never], todayDateInputValue()),
    currentLandedUnitCostAsOf([row as never], todayDateInputValue()),
  );

  const { data: viewRow } = await supabase
    .from("supplier_product_pricing")
    .select("current_unit_cost, current_landed_unit_cost")
    .eq("supplier_product_id", PRODUCT_ID)
    .maybeSingle();
  console.log("View:", viewRow);

  const { data: rpcLanded } = await supabase.rpc(
    "current_supplier_product_landed_unit_cost",
    { p_supplier_product_id: PRODUCT_ID },
  );
  console.log("RPC landed:", rpcLanded);

  // Cleanup the test schedule row we just added (keep prior history)
  if (row?.id) {
    await deleteSupplierProductPrice(SALT_FERN_ID, row.id as string);
    console.log("Deleted test price row", row.id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
