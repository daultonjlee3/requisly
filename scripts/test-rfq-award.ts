/**
 * Smoke-test RFQ comparison + award-to-PO (Salt & Fern).
 *
 *   npx tsx --env-file=embedded/.env scripts/test-rfq-award.ts
 */
const WS = "eb7e12e6-4572-466a-8424-71cc515502cd";
const CASCADE = "3418f53d-82cd-4d82-9a8a-47efc4ce2ae6";
const FERNVALE = "f98dc15f-4ba2-4dad-9c62-34d44d12c1c1";
const LOCATION = "51cacdcf-91fb-4920-a64d-47e83c103186";

async function main() {
  const {
    createQuoteRequest,
    getQuoteRequestDetail,
    awardQuoteRequest,
  } = await import("../embedded/app/lib/quote-requests.server.ts");
  const { createServiceClient } = await import(
    "../embedded/app/lib/supabase.server.ts"
  );
  const { parseSupplierQuoteReply, matchParsedQuotesToLines } = await import(
    "../embedded/app/lib/email-reply-parse.server.ts"
  );

  const { id } = await createQuoteRequest({
    workspaceId: WS,
    title: "RFQ smoke — wax + hangtags",
    notes: "Please quote unit price + lead time",
    neededBy: "2026-09-01",
    supplierIds: [CASCADE, FERNVALE],
    lines: [
      {
        description: "Selling Plans Ski Wax",
        sku: "WAX-1",
        qty: 100,
        is_free_text: true,
      },
      {
        description: "Hangtag — Kraft",
        sku: "TAG-KFT",
        qty: 500,
        is_free_text: true,
      },
    ],
  });
  console.log("Created RFQ", id);

  const supabase = createServiceClient();
  // Mark sent so responses are accepted
  await supabase
    .from("quote_requests")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id);

  const { data: invites } = await supabase
    .from("quote_request_suppliers")
    .select("id, supplier_id, token")
    .eq("quote_request_id", id);

  const { data: lines } = await supabase
    .from("quote_request_lines")
    .select("id, description, sku, sort_order")
    .eq("quote_request_id", id)
    .order("sort_order");

  const wax = lines![0]!;
  const tag = lines![1]!;
  const cascade = invites!.find((i) => i.supplier_id === CASCADE)!;
  const fernvale = invites!.find((i) => i.supplier_id === FERNVALE)!;

  // Cascade: cheaper on wax, dearer on tags
  await supabase.rpc("quote_request_link_submit", {
    p_token: cascade.token,
    p_responses: [
      {
        quote_request_line_id: wax.id,
        unit_cost: 4.1,
        lead_time_days: 10,
      },
      {
        quote_request_line_id: tag.id,
        unit_cost: 0.3,
        lead_time_days: 14,
      },
    ],
  });

  // Fernvale: dearer wax, cheaper tags — for split award
  await supabase.rpc("quote_request_link_submit", {
    p_token: fernvale.token,
    p_responses: [
      {
        quote_request_line_id: wax.id,
        unit_cost: 4.5,
        lead_time_days: 7,
      },
      {
        quote_request_line_id: tag.id,
        unit_cost: 0.22,
        lead_time_days: 12,
      },
    ],
  });

  const detail = await getQuoteRequestDetail(WS, id);
  console.log("\n=== Comparison ===");
  for (const line of detail!.comparison) {
    console.log(
      line.description,
      "→",
      line.cells.map((c) => ({
        supplier: c.supplierName,
        cost: c.unitCost,
        cheapest: c.isCheapest,
      })),
    );
  }

  // Email parser smoke
  const parsed = parseSupplierQuoteReply(
    "WAX-1 $4.25 9 days\nTAG-KFT 0.28 / 11d",
  );
  const matched = matchParsedQuotesToLines(
    parsed,
    lines!.map((l) => ({
      id: l.id as string,
      sku: (l.sku as string | null) ?? null,
      description: l.description as string,
    })),
  );
  console.log("\nEmail parse match:", matched);

  // Split award: Cascade wins wax, Fernvale wins tags
  const awarded = await awardQuoteRequest({
    workspaceId: WS,
    quoteRequestId: id,
    locationId: LOCATION,
    awards: {
      [wax.id as string]: cascade.id as string,
      [tag.id as string]: fernvale.id as string,
    },
  });

  console.log("\n=== Award → draft POs ===");
  console.log(awarded.purchaseOrders);

  for (const po of awarded.purchaseOrders) {
    const { data: poRow } = await supabase
      .from("purchase_orders")
      .select("id, po_number, status, total, supplier_id")
      .eq("id", po.poId)
      .single();
    const { data: poLines } = await supabase
      .from("po_line_items")
      .select("description, qty, unit_cost")
      .eq("po_id", po.poId);
    console.log(poRow, poLines);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
