import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPoLineItemsCsv, csvFileName } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Token-gated CSV of the PO line items. GET only — a download, not an inbox.
 * Uploading or emailing this file back does not change the order.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() ?? "";

  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();

    const { data: link, error: linkError } = await admin
      .from("supplier_link_tokens")
      .select("po_id")
      .eq("token", token)
      .maybeSingle();

    if (linkError || !link?.po_id) {
      return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    }

    const { data: po, error: poError } = await admin
      .from("purchase_orders")
      .select(
        "po_number, po_line_items(description, sku, qty, unit_cost, line_total, sort_order)",
      )
      .eq("id", link.po_id)
      .maybeSingle();

    if (poError || !po) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const lines = (
      (po.po_line_items ?? []) as Array<{
        description: string;
        sku: string | null;
        qty: number;
        unit_cost: number;
        line_total: number | null;
        sort_order: number | null;
      }>
    )
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const csv = buildPoLineItemsCsv(
      lines.map((line) => ({
        description: line.description,
        sku: line.sku,
        qty: Number(line.qty),
        unitCost: Number(line.unit_cost),
        lineTotal:
          line.line_total != null ? Number(line.line_total) : undefined,
      })),
    );

    const fileName = csvFileName(String(po.po_number ?? "PO"));

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
