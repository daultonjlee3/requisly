import { createServiceClient } from "./supabase.server";
import { money, relativeTime, shortDate } from "./format";
import {
  buildPurchaseOrderPdf,
  pdfFileName,
} from "./po-pdf.server";
import { statusLabel, type PoStatus } from "./po-status";

const BUCKET = "po-documents";

export type PoDocumentKind =
  | "po_pdf"
  | "upload"
  | "invoice"
  | "packing_slip"
  | "other";

export type PoDocumentRow = {
  id: string;
  fileName: string;
  fileType: string | null;
  kind: PoDocumentKind;
  kindLabel: string;
  createdAt: string;
  createdLabel: string;
  downloadUrl: string | null;
};

function kindLabel(kind: string): string {
  switch (kind) {
    case "po_pdf":
      return "PO PDF";
    case "invoice":
      return "Invoice";
    case "packing_slip":
      return "Packing slip";
    case "other":
      return "Other";
    default:
      return "Upload";
  }
}

async function signedUrl(filePath: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

export async function listPoDocuments(
  workspaceId: string,
  poId: string,
): Promise<PoDocumentRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("po_documents")
    .select("id, file_path, file_name, file_type, kind, created_at")
    .eq("workspace_id", workspaceId)
    .eq("po_id", poId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows: PoDocumentRow[] = [];
  for (const row of data ?? []) {
    rows.push({
      id: row.id,
      fileName: row.file_name,
      fileType: row.file_type,
      kind: (row.kind as PoDocumentKind) ?? "upload",
      kindLabel: kindLabel(row.kind ?? "upload"),
      createdAt: row.created_at,
      createdLabel: relativeTime(row.created_at),
      downloadUrl: await signedUrl(row.file_path),
    });
  }
  return rows;
}

export async function getDocumentSignedUrl(
  workspaceId: string,
  documentId: string,
): Promise<{ url: string; fileName: string } | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("po_documents")
    .select("file_path, file_name")
    .eq("id", documentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const url = await signedUrl(data.file_path);
  if (!url) return null;
  return { url, fileName: data.file_name };
}

async function storeDocument(opts: {
  workspaceId: string;
  poId: string;
  fileName: string;
  fileType: string;
  kind: PoDocumentKind;
  bytes: Buffer;
}): Promise<PoDocumentRow> {
  const supabase = createServiceClient();
  const path = `${opts.workspaceId}/${opts.poId}/${Date.now()}-${opts.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, opts.bytes, {
      contentType: opts.fileType,
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase
    .from("po_documents")
    .insert({
      workspace_id: opts.workspaceId,
      po_id: opts.poId,
      file_path: path,
      file_name: opts.fileName,
      file_type: opts.fileType,
      kind: opts.kind,
      uploaded_by: null,
    })
    .select("id, file_path, file_name, file_type, kind, created_at")
    .single();
  if (error) throw new Error(error.message);

  return {
    id: data.id,
    fileName: data.file_name,
    fileType: data.file_type,
    kind: (data.kind as PoDocumentKind) ?? opts.kind,
    kindLabel: kindLabel(data.kind ?? opts.kind),
    createdAt: data.created_at,
    createdLabel: shortDate(data.created_at),
    downloadUrl: await signedUrl(data.file_path),
  };
}

export async function generateAndStorePoPdf(opts: {
  workspaceId: string;
  poId: string;
  workspaceName: string;
}): Promise<PoDocumentRow> {
  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select(
      "*, suppliers(name, email), locations(name), po_line_items(description, sku, qty, unit_cost, line_total, sort_order)",
    )
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!po) throw new Error("Purchase order not found");

  const supplier = po.suppliers as unknown as {
    name: string;
    email: string;
  } | null;
  const location = po.locations as unknown as { name: string } | null;
  const lines = (
    (po.po_line_items ?? []) as Array<{
      description: string;
      sku: string | null;
      qty: number;
      unit_cost: number;
      line_total: number;
      sort_order: number;
    }>
  ).sort((a, b) => a.sort_order - b.sort_order);

  const bytes = await buildPurchaseOrderPdf({
    workspaceName: opts.workspaceName,
    poNumber: po.po_number,
    statusLabel: statusLabel(po.status as PoStatus),
    createdAt: shortDate(po.created_at),
    supplierName: supplier?.name ?? "—",
    supplierEmail: supplier?.email ?? "—",
    shipTo: location?.name ?? "—",
    paymentTerms: po.payment_terms ?? null,
    referenceNumber: po.reference_number ?? null,
    requestedShipDate: shortDate(po.requested_ship_date),
    confirmedShipDate: shortDate(po.confirmed_ship_date),
    notes: po.notes,
    subtotal: money(po.subtotal),
    taxAmount: money(po.tax_amount ?? 0),
    shippingAmount: money(po.shipping_amount ?? 0),
    adjustmentAmount: money(po.adjustment_amount ?? 0),
    total: money(po.total),
    lineItems: lines.map((line) => ({
      description: line.description,
      sku: line.sku || "—",
      qty: String(line.qty),
      unitCost: money(line.unit_cost),
      lineTotal: money(line.line_total),
    })),
  });

  const { data: prior } = await supabase
    .from("po_documents")
    .select("id, file_path")
    .eq("workspace_id", opts.workspaceId)
    .eq("po_id", opts.poId)
    .eq("kind", "po_pdf");
  for (const row of prior ?? []) {
    await supabase.storage.from(BUCKET).remove([row.file_path]);
    await supabase.from("po_documents").delete().eq("id", row.id);
  }

  return storeDocument({
    workspaceId: opts.workspaceId,
    poId: opts.poId,
    fileName: pdfFileName(po.po_number),
    fileType: "application/pdf",
    kind: "po_pdf",
    bytes,
  });
}

export async function uploadPoDocument(opts: {
  workspaceId: string;
  poId: string;
  fileName: string;
  fileType: string;
  kind: PoDocumentKind;
  bytes: Buffer;
}): Promise<PoDocumentRow> {
  const supabase = createServiceClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (!po) throw new Error("Purchase order not found");

  const kind = opts.kind === "po_pdf" ? "upload" : opts.kind;
  return storeDocument({
    workspaceId: opts.workspaceId,
    poId: opts.poId,
    fileName: opts.fileName,
    fileType: opts.fileType || "application/octet-stream",
    kind,
    bytes: opts.bytes,
  });
}
