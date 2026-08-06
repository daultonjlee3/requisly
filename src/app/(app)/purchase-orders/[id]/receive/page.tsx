import Link from "next/link";
import { notFound } from "next/navigation";
import { ReceiveForm } from "@/components/ReceiveForm";
import { Topbar } from "@/components/shell/Topbar";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export default async function ReceivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await getSessionContext();
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, po_number, suppliers(name), locations(name), po_line_items(id, description, qty)")
    .eq("id", id)
    .eq("workspace_id", workspace!.id)
    .maybeSingle();

  if (!po) notFound();

  const { data: receipts } = await supabase
    .from("receipts")
    .select("receipt_line_items(po_line_item_id, qty_received)")
    .eq("po_id", id)
    .eq("workspace_id", workspace!.id);

  const already = new Map<string, number>();
  for (const receipt of receipts ?? []) {
    const items = (receipt.receipt_line_items ?? []) as Array<{
      po_line_item_id: string;
      qty_received: number;
    }>;
    for (const item of items) {
      already.set(
        item.po_line_item_id,
        (already.get(item.po_line_item_id) ?? 0) + item.qty_received,
      );
    }
  }

  const supplier = po.suppliers as unknown as { name: string };
  const location = po.locations as unknown as { name: string } | null;
  const lines = ((po.po_line_items ?? []) as Array<{
    id: string;
    description: string;
    qty: number;
  }>).map((line) => ({
    ...line,
    already_received: already.get(line.id) ?? 0,
  }));

  return (
    <>
      <Topbar
        title={`Receive ${po.po_number}`}
        subline={`${supplier.name} · ${location?.name ?? "Primary"}`}
        actions={
          <Link href={`/purchase-orders/${po.id}`} className="btn btn-secondary">
            Back to PO
          </Link>
        }
      />
      <div className="content">
        <div className="breadcrumb">
          <Link href="/purchase-orders">Purchase Orders</Link>
          {" / "}
          <Link href={`/purchase-orders/${po.id}`} className="po-number">
            {po.po_number}
          </Link>
          {" / Receive"}
        </div>
        <ReceiveForm poId={po.id} lines={lines} />
      </div>
    </>
  );
}
