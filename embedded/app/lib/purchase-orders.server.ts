import { createServiceClient } from "./supabase.server";
import { money, randomToken, relativeTime, shortDate } from "./format";
import {
  resolveListWindow,
  sanitizeSearch,
  type ListPageResult,
} from "./list-table";
import { currentLandedUnitCostAsOf, todayDateInputValue } from "./pricing";
import type {
  NewPoFormData,
  NewPoShopifyVariant,
  NewPoSupplierProduct,
} from "./po-types";
import {
  buildTimelineState,
  canCancelPurchaseOrder,
  statusBadgeTone,
  statusLabel,
  timelineProgress,
  type PoStatus,
  type TimelineEvent,
} from "./po-status";
import {
  buildThreeWayMatch,
  type ThreeWayMatch,
} from "./three-way-match";
import { billDeepLink } from "./quickbooks.server";

export type { NewPoFormData, NewPoSupplierProduct };

/** Public Supplier Link base (Next.js app). Not the embedded tunnel origin. */
export function supplierLinkBaseUrl() {
  return (
    process.env.SUPPLIER_LINK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/$/, "");
}

export type PurchaseOrderListItem = {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierId: string;
  status: PoStatus;
  statusLabel: string;
  statusTone: ReturnType<typeof statusBadgeTone>;
  total: string;
  totalRaw: number;
  shipDate: string;
  requestedShipDateRaw: string | null;
  estimatedArrivalRaw: string | null;
  updated: string;
  createdAtRaw: string | null;
};

export type PurchaseOrderDetail = {
  id: string;
  poNumber: string;
  status: PoStatus;
  statusLabel: string;
  statusTone: ReturnType<typeof statusBadgeTone>;
  progress: number;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  adjustmentAmount: string;
  total: string;
  taxAmountRaw: number;
  shippingAmountRaw: number;
  adjustmentAmountRaw: number;
  paymentTerms: string | null;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
  requestedShipDate: string;
  requestedShipDateRaw: string;
  confirmedShipDate: string;
  estimatedArrivalDate: string;
  canReceive: boolean;
  canClose: boolean;
  canCancel: boolean;
  canSend: boolean;
  canEdit: boolean;
  confirmationStale: boolean;
  supplierLinkToken: string | null;
  supplierLinkUrl: string | null;
  estimatedArrivalRaw: string;
  supplier: { id: string; name: string; email: string; paymentTerms: string | null };
  locationId: string | null;
  shipTo: string;
  tracking: string | null;
  carrier: string | null;
  timelineSteps: Array<{
    key: PoStatus;
    label: string;
    state: "done" | "current" | "future" | "skip";
    occurredAt: string | null;
    dateLabel: string;
  }>;
  lineItems: Array<{
    id: string;
    description: string;
    sku: string;
    qty: string;
    qtyRaw: number;
    unitCost: string;
    unitCostRaw: number;
    lineTotal: string;
    isFreeText: boolean;
    supplierProductId: string | null;
  }>;
  pendingProposals: Array<{
    id: string;
    lineItemId: string;
    lineDescription: string;
    currentQty: number;
    currentUnitCost: number;
    proposedQty: number | null;
    proposedUnitCost: number | null;
    note: string | null;
  }>;
  receipts: Array<{
    id: string;
    note: string | null;
    createdLabel: string;
    lineCount: number;
    totalQty: number;
  }>;
  activity: Array<{
    id: string;
    eventType: string;
    actor: string;
    dateLabel: string;
    metadata: string | null;
  }>;
  invoiceAmountRaw: number | null;
  qbPushedAt: string | null;
  qbBillId: string | null;
  qbBillUrl: string | null;
  threeWayMatch: ThreeWayMatch;
};

type CreateLineInput = {
  description: string;
  sku: string;
  qty: number;
  unit_cost: number;
  is_free_text: boolean;
  supplier_product_id?: string | null;
};

function supplierName(value: unknown) {
  const s = value as { name: string } | null;
  return s?.name ?? "—";
}

export async function listPurchaseOrders(
  workspaceId: string,
  filters?: {
    status?: string | null;
    supplierId?: string | null;
    /** Matches PO number or supplier name. */
    q?: string | null;
    /** Supplier name only (report-builder drill-down). */
    supplierQ?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    page?: number;
    pageSize?: number;
    forExport?: boolean;
    cap?: number;
  },
): Promise<ListPageResult<PurchaseOrderListItem>> {
  const supabase = createServiceClient();
  const window = resolveListWindow(filters);
  const q = sanitizeSearch(filters?.q);
  const supplierQ = sanitizeSearch(filters?.supplierQ);

  let query = supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, total, requested_ship_date, estimated_arrival_date, updated_at, created_at, supplier_id, suppliers(name)",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.supplierId) {
    query = query.eq("supplier_id", filters.supplierId);
  }
  if (filters?.dateFrom) {
    query = query.gte("created_at", `${filters.dateFrom}T00:00:00.000Z`);
  }
  if (filters?.dateTo) {
    const end = new Date(`${filters.dateTo}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }
  if (supplierQ) {
    const { data: named, error: nameErr } = await supabase
      .from("suppliers")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("name", `%${supplierQ}%`);
    if (nameErr) throw new Error(nameErr.message);
    const supplierIds = (named ?? []).map((s) => s.id);
    if (!supplierIds.length) return { rows: [], total: 0 };
    query = query.in("supplier_id", supplierIds);
  }
  if (q) {
    const { data: named, error: nameErr } = await supabase
      .from("suppliers")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("name", `%${q}%`);
    if (nameErr) throw new Error(nameErr.message);
    const supplierIds = (named ?? []).map((s) => s.id);
    query = supplierIds.length
      ? query.or(`po_number.ilike.%${q}%,supplier_id.in.(${supplierIds.join(",")})`)
      : query.ilike("po_number", `%${q}%`);
  }

  const { data, error, count } = await query.range(window.from, window.to);
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((po) => {
    const status = po.status as PoStatus;
    return {
      id: po.id,
      poNumber: po.po_number,
      supplierName: supplierName(po.suppliers),
      supplierId: po.supplier_id,
      status,
      statusLabel: statusLabel(status),
      statusTone: statusBadgeTone(status),
      total: money(po.total),
      totalRaw: Number(po.total) || 0,
      shipDate: shortDate(po.requested_ship_date),
      requestedShipDateRaw: po.requested_ship_date,
      estimatedArrivalRaw: po.estimated_arrival_date,
      updated: relativeTime(po.updated_at),
      createdAtRaw: (po.created_at as string | null) ?? null,
    };
  });
  return { rows, total: count ?? rows.length };
}

export async function getPurchaseOrderDetail(
  workspaceId: string,
  poId: string,
): Promise<PurchaseOrderDetail | null> {
  const supabase = createServiceClient();

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select(
      "*, suppliers(id, name, email, payment_terms), locations(name), po_line_items(*), po_timeline_events(*), supplier_link_tokens(token)",
    )
    .eq("id", poId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!po) return null;

  const supplier = po.suppliers as unknown as {
    id: string;
    name: string;
    email: string;
    payment_terms: string | null;
  } | null;
  const location = po.locations as unknown as { name: string } | null;

  const lines = (
    (po.po_line_items ?? []) as Array<{
      id: string;
      description: string;
      sku: string | null;
      qty: number;
      unit_cost: number;
      line_total: number;
      is_free_text: boolean;
      sort_order: number;
      supplier_product_id: string | null;
    }>
  ).sort((a, b) => a.sort_order - b.sort_order);

  const { data: receiptRows } = await supabase
    .from("receipts")
    .select("id, note, created_at, receipt_line_items(qty_received, po_line_item_id)")
    .eq("po_id", poId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  const events = ((po.po_timeline_events ?? []) as TimelineEvent[]).sort(
    (a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at),
  );

  const status = po.status as PoStatus;
  const steps = buildTimelineState(status, events);

  const shippedEvent = events.find((e) => e.event_type === "shipped");
  const meta = (shippedEvent?.metadata ?? null) as {
    tracking_number?: string;
    carrier?: string;
  } | null;

  const tokens = po.supplier_link_tokens as unknown as Array<{
    token: string;
  }> | null;
  const token = tokens?.[0]?.token ?? null;
  const base = supplierLinkBaseUrl();

  return {
    id: po.id,
    poNumber: po.po_number,
    status,
    statusLabel: statusLabel(status),
    statusTone: statusBadgeTone(status),
    progress: timelineProgress(status),
    subtotal: money(po.subtotal),
    taxAmount: money(po.tax_amount ?? 0),
    shippingAmount: money(po.shipping_amount ?? 0),
    adjustmentAmount: money(po.adjustment_amount ?? 0),
    total: money(po.total),
    taxAmountRaw: Number(po.tax_amount) || 0,
    shippingAmountRaw: Number(po.shipping_amount) || 0,
    adjustmentAmountRaw: Number(po.adjustment_amount) || 0,
    paymentTerms: po.payment_terms ?? supplier?.payment_terms ?? null,
    referenceNumber: po.reference_number ?? null,
    notes: po.notes,
    createdAt: shortDate(po.created_at),
    requestedShipDate: shortDate(po.requested_ship_date),
    requestedShipDateRaw: po.requested_ship_date ?? "",
    confirmedShipDate: shortDate(po.confirmed_ship_date),
    estimatedArrivalDate: shortDate(po.estimated_arrival_date),
    estimatedArrivalRaw: po.estimated_arrival_date ?? "",
    canReceive: ["shipped", "in_transit", "partially_received"].includes(
      status,
    ),
    canClose: status === "partially_received",
    canCancel: canCancelPurchaseOrder(status),
    canSend:
      status === "draft" ||
      status === "sent" ||
      Boolean(po.confirmation_stale) ||
      Boolean(token),
    canEdit: [
      "draft",
      "sent",
      "viewed",
      "confirmed",
      "production",
    ].includes(status),
    confirmationStale: Boolean(po.confirmation_stale),
    supplierLinkToken: token,
    supplierLinkUrl: token && base ? `${base}/s/${token}` : null,
    supplier: {
      id: supplier?.id ?? "",
      name: supplier?.name ?? "—",
      email: supplier?.email ?? "—",
      paymentTerms: supplier?.payment_terms ?? null,
    },
    locationId: po.location_id ?? null,
    shipTo: location?.name ?? "—",
    tracking: meta?.tracking_number ?? null,
    carrier: meta?.carrier ?? null,
    timelineSteps: steps.map((step) => ({
      key: step.key,
      label: step.label,
      state: step.state,
      occurredAt: step.occurredAt,
      dateLabel: step.occurredAt ? shortDate(step.occurredAt) : "—",
    })),
    lineItems: lines.map((line) => ({
      id: line.id,
      description: line.description,
      sku: line.sku || "—",
      qty: String(line.qty),
      qtyRaw: line.qty,
      unitCost: money(line.unit_cost),
      unitCostRaw: Number(line.unit_cost) || 0,
      lineTotal: money(line.line_total),
      isFreeText: line.is_free_text,
      supplierProductId: line.supplier_product_id,
    })),
    pendingProposals: await loadPendingProposals(lines),
    receipts: (receiptRows ?? []).map((receipt) => {
      const items = (receipt.receipt_line_items ?? []) as Array<{
        qty_received: number;
      }>;
      return {
        id: receipt.id,
        note: receipt.note,
        createdLabel: relativeTime(receipt.created_at),
        lineCount: items.length,
        totalQty: items.reduce((sum, i) => sum + (i.qty_received || 0), 0),
      };
    }),
    activity: [...events].reverse().map((event) => {
      const meta = (event.metadata ?? {}) as Record<string, unknown>;
      const summary =
        typeof meta.summary === "string" && meta.summary.trim()
          ? meta.summary.trim()
          : null;
      const rest = { ...meta };
      delete rest.summary;
      const fallback =
        Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
      return {
        id: event.id,
        eventType: statusLabel(event.event_type),
        actor: event.actor,
        dateLabel: shortDate(event.occurred_at),
        metadata: summary ?? fallback,
      };
    }),
    invoiceAmountRaw:
      po.invoice_amount == null ? null : Number(po.invoice_amount),
    qbPushedAt: (po.qb_pushed_at as string | null) ?? null,
    qbBillId: (po.qb_bill_id as string | null) ?? null,
    qbBillUrl: (po.qb_bill_id as string | null)
      ? billDeepLink(po.qb_bill_id as string)
      : null,
    threeWayMatch: buildThreeWayMatch({
      poTotal: Number(po.total) || 0,
      invoiceAmount:
        po.invoice_amount == null ? null : Number(po.invoice_amount),
      lines: lines.map((line) => {
        let qtyReceived = 0;
        for (const receipt of receiptRows ?? []) {
          const items = (receipt.receipt_line_items ?? []) as Array<{
            po_line_item_id?: string;
            qty_received: number;
          }>;
          for (const item of items) {
            if (item.po_line_item_id === line.id) {
              qtyReceived += item.qty_received || 0;
            }
          }
        }
        return { id: line.id, qty: Number(line.qty) || 0, qtyReceived };
      }),
    }),
  };
}

async function loadPendingProposals(
  lines: Array<{
    id: string;
    description: string;
    qty: number;
    unit_cost: number;
  }>,
) {
  if (!lines.length) return [];
  const supabase = createServiceClient();
  const lineIds = lines.map((l) => l.id);
  const { data, error } = await supabase
    .from("po_line_item_proposals")
    .select(
      "id, po_line_item_id, proposed_qty, proposed_unit_cost, note, status",
    )
    .in("po_line_item_id", lineIds)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const byId = new Map(lines.map((l) => [l.id, l]));
  return (data ?? []).map((row) => {
    const line = byId.get(row.po_line_item_id);
    return {
      id: row.id,
      lineItemId: row.po_line_item_id,
      lineDescription: line?.description ?? "Line item",
      currentQty: line?.qty ?? 0,
      currentUnitCost: Number(line?.unit_cost) || 0,
      proposedQty: row.proposed_qty,
      proposedUnitCost:
        row.proposed_unit_cost != null ? Number(row.proposed_unit_cost) : null,
      note: row.note,
    };
  });
}

export async function loadNewPoFormData(
  workspaceId: string,
  defaultSupplierId?: string | null,
): Promise<NewPoFormData> {
  const supabase = createServiceClient();
  const asOf = todayDateInputValue();

  const [{ data: suppliers, error: sErr }, { data: locations, error: lErr }] =
    await Promise.all([
      supabase
        .from("suppliers")
        .select("id, name, payment_terms")
        .eq("workspace_id", workspaceId)
        .order("name"),
      supabase
        .from("locations")
        .select("id, name, is_primary")
        .eq("workspace_id", workspaceId)
        .order("name"),
    ]);
  if (sErr) throw new Error(sErr.message);
  if (lErr) throw new Error(lErr.message);

  const [
    { data: productRows, error: pErr },
    { data: variantRows, error: vErr },
  ] = await Promise.all([
    supabase
      .from("supplier_products")
      .select(
        "id, supplier_id, title, sku, product_variant_id, product_variants(shopify_variant_id), supplier_product_prices(id, unit_cost, freight_per_unit, duty_per_unit, customs_per_unit, landed_unit_cost, effective_date, created_at)",
      )
      .eq("workspace_id", workspaceId)
      .order("title"),
    supabase
      .from("product_variants")
      .select("id, shopify_variant_id, title, sku")
      .eq("workspace_id", workspaceId)
      .order("title")
      .limit(2000),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (vErr) throw new Error(vErr.message);

  const products: NewPoSupplierProduct[] = (productRows ?? []).map((row) => {
    const prices = (row.supplier_product_prices ?? []) as Array<{
      id: string;
      unit_cost: number | string;
      freight_per_unit?: number | string | null;
      duty_per_unit?: number | string | null;
      customs_per_unit?: number | string | null;
      landed_unit_cost?: number | string | null;
      effective_date: string;
      created_at: string;
    }>;
    const variant = row.product_variants as unknown as {
      shopify_variant_id: string;
    } | null;
    return {
      id: row.id,
      supplierId: row.supplier_id,
      title: row.title,
      sku: row.sku,
      // Prefer landed so new POs reflect true import cost when components exist.
      unitCost: currentLandedUnitCostAsOf(prices, asOf),
      productVariantId: row.product_variant_id,
      shopifyVariantId: variant?.shopify_variant_id ?? null,
    };
  });

  const shopifyVariants: NewPoShopifyVariant[] = (variantRows ?? []).map(
    (row) => ({
      id: row.id,
      shopifyVariantId: row.shopify_variant_id,
      title: row.title,
      sku: row.sku,
    }),
  );

  const priorCosts = await loadPriorUnitCosts(workspaceId);

  return {
    suppliers: (suppliers ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      paymentTerms: s.payment_terms ?? null,
    })),
    locations: (locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      isPrimary: Boolean(l.is_primary),
    })),
    products,
    shopifyVariants,
    priorCosts,
    defaultSupplierId: defaultSupplierId ?? null,
  };
}

async function loadPriorUnitCosts(
  workspaceId: string,
): Promise<Record<string, number>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("po_line_items")
    .select(
      "unit_cost, sku, supplier_product_id, purchase_orders!inner(workspace_id, supplier_id, created_at), supplier_products(product_variant_id, product_variants(shopify_variant_id))",
    )
    .eq("purchase_orders.workspace_id", workspaceId)
    .order("created_at", {
      ascending: false,
      foreignTable: "purchase_orders",
    })
    .limit(800);
  if (error) {
    // Non-fatal — create form still works without prior costs.
    console.warn("prior cost lookup failed", error.message);
    return {};
  }

  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    const po = row.purchase_orders as unknown as {
      supplier_id: string;
    };
    if (!po?.supplier_id) continue;
    const cost = Number(row.unit_cost);
    if (!Number.isFinite(cost) || cost < 0) continue;

    const sp = row.supplier_products as unknown as {
      product_variants: { shopify_variant_id: string } | null;
    } | null;
    const shopifyVariantId = sp?.product_variants?.shopify_variant_id;
    if (shopifyVariantId) {
      const variantKey = `${po.supplier_id}:v:${shopifyVariantId}`;
      if (!(variantKey in out)) out[variantKey] = cost;
    }

    const sku = typeof row.sku === "string" ? row.sku.trim().toLowerCase() : "";
    if (sku) {
      const skuKey = `${po.supplier_id}:sku:${sku}`;
      if (!(skuKey in out)) out[skuKey] = cost;
    }
  }
  return out;
}

function rollupTotal(
  subtotal: number,
  tax: number,
  shipping: number,
  adjustment: number,
) {
  return Number((subtotal + tax + shipping + adjustment).toFixed(2));
}

export async function createPurchaseOrder(opts: {
  workspaceId: string;
  supplierId: string;
  locationId: string | null;
  requestedShipDate: string | null;
  notes: string | null;
  paymentTerms?: string | null;
  referenceNumber?: string | null;
  taxAmount?: number;
  shippingAmount?: number;
  adjustmentAmount?: number;
  lines: CreateLineInput[];
  /** Timeline metadata.source — e.g. embedded_create | ai_procurement_agent */
  source?: string;
}): Promise<{ id: string; poNumber: string }> {
  const { workspaceId, supplierId, locationId, requestedShipDate, notes } =
    opts;
  const lines = opts.lines
    .map((line) => ({
      description: String(line.description ?? "").trim(),
      sku: String(line.sku ?? "").trim(),
      qty: Number(line.qty),
      unit_cost: Number(line.unit_cost),
      is_free_text: Boolean(line.is_free_text),
      supplier_product_id: line.supplier_product_id || null,
    }))
    .filter((line) => line.description && line.qty > 0);

  if (!supplierId) throw new Error("Supplier is required");
  if (!lines.length) throw new Error("Add at least one line item");

  const supabase = createServiceClient();
  const subtotal = Number(
    lines.reduce((sum, l) => sum + l.qty * l.unit_cost, 0).toFixed(2),
  );
  const taxAmount = Number(opts.taxAmount) || 0;
  const shippingAmount = Number(opts.shippingAmount) || 0;
  const adjustmentAmount = Number(opts.adjustmentAmount) || 0;
  const poNumber = await nextPoNumber(workspaceId);

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({
      workspace_id: workspaceId,
      po_number: poNumber,
      supplier_id: supplierId,
      location_id: locationId,
      status: "draft",
      notes,
      requested_ship_date: requestedShipDate,
      payment_terms: opts.paymentTerms?.trim() || null,
      reference_number: opts.referenceNumber?.trim() || null,
      tax_amount: taxAmount,
      shipping_amount: shippingAmount,
      adjustment_amount: adjustmentAmount,
      subtotal,
      total: rollupTotal(subtotal, taxAmount, shippingAmount, adjustmentAmount),
      created_by: null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: lineError } = await supabase.from("po_line_items").insert(
    lines.map((line, index) => ({
      po_id: po.id,
      supplier_product_id: line.is_free_text ? null : line.supplier_product_id,
      description: line.description,
      sku: line.sku || null,
      is_free_text: line.is_free_text,
      qty: line.qty,
      unit_cost: line.unit_cost,
      line_total: Number((line.qty * line.unit_cost).toFixed(2)),
      sort_order: index,
    })),
  );
  if (lineError) throw new Error(lineError.message);

  const { error: eventError } = await supabase.from("po_timeline_events").insert({
    po_id: po.id,
    event_type: "draft",
    actor: "merchant",
    metadata: {
      source: opts.source ?? "embedded_create",
      ai_suggested: opts.source === "ai_procurement_agent",
    },
  });
  if (eventError) throw new Error(eventError.message);

  return { id: po.id, poNumber };
}

async function nextPoNumber(workspaceId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("po_number")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  let maxN = 1000;
  for (const row of data ?? []) {
    const digits = String(row.po_number ?? "").replace(/\D/g, "");
    if (!digits) continue;
    const n = Number(digits);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `PO-${maxN + 1}`;
}

export async function sendPurchaseOrder(opts: {
  workspaceId: string;
  poId: string;
  workspaceName: string;
  toEmail?: string | null;
}): Promise<{
  token: string;
  url: string | null;
  pdfDocumentId: string;
  pdfUrl: string | null;
  pdfFileName: string;
  emailSent: boolean;
  emailError: string | null;
  emailTo: string | null;
  confirmAsIsUrl: string | null;
  markShippedUrl: string | null;
}> {
  const { generateAndStorePoPdf } = await import("./documents.server");
  const { issueOneClickTokens } = await import("./supplier-one-click.server");
  const {
    inboundReplyToAddress,
    sendPoSupplierEmail,
  } = await import("./po-supplier-email.server");

  const pdf = await generateAndStorePoPdf({
    workspaceId: opts.workspaceId,
    poId: opts.poId,
    workspaceName: opts.workspaceName,
  });

  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select(
      "id, status, confirmation_stale, po_number, requested_ship_date, confirmed_ship_date, subtotal, tax_amount, shipping_amount, adjustment_amount, total, suppliers(name, email), po_line_items(description, qty, unit_cost, line_total, sort_order)",
    )
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error || !po) throw new Error(error?.message ?? "PO not found");
  const canResendStale =
    Boolean(po.confirmation_stale) &&
    ["sent", "viewed", "confirmed", "production"].includes(po.status);
  const canRefresh =
    po.status === "draft" ||
    po.status === "sent" ||
    po.status === "viewed" ||
    canResendStale;
  if (!canRefresh) {
    throw new Error(
      "Only draft, sent, viewed, or stale-confirmation POs can generate a Supplier Link",
    );
  }

  let token: string | null = null;
  const { data: existing } = await supabase
    .from("supplier_link_tokens")
    .select("token")
    .eq("po_id", opts.poId)
    .maybeSingle();

  if (existing?.token) {
    token = existing.token;
  } else {
    token = randomToken(24);
    const { error: tokenError } = await supabase
      .from("supplier_link_tokens")
      .insert({ po_id: opts.poId, token });
    if (tokenError) throw new Error(tokenError.message);
  }

  const supplier = po.suppliers as unknown as {
    name: string;
    email: string | null;
  } | null;
  const emailTo = opts.toEmail?.trim() || supplier?.email?.trim() || "";
  if (emailTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
    throw new Error("Recipient email looks invalid");
  }

  if (po.status === "draft" || canResendStale) {
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({
        status: "sent",
        // Keep confirmation_stale true until supplier re-confirms the new version.
        confirmation_stale: canResendStale ? true : false,
      })
      .eq("id", opts.poId);
    if (updateError) throw new Error(updateError.message);

    const { error: eventError } = await supabase
      .from("po_timeline_events")
      .insert({
        po_id: opts.poId,
        event_type: "sent",
        actor: "merchant",
        metadata: {
          channel: "email",
          pdf_document_id: pdf.id,
          resent_after_edit: canResendStale,
          to: emailTo || undefined,
        },
      });
    if (eventError) throw new Error(eventError.message);
  } else if (emailTo) {
    const { error: eventError } = await supabase
      .from("po_timeline_events")
      .insert({
        po_id: opts.poId,
        event_type: "sent",
        actor: "merchant",
        metadata: {
          channel: "email",
          pdf_document_id: pdf.id,
          refresh: true,
          to: emailTo,
        },
      });
    if (eventError) throw new Error(eventError.message);
  }

  const shipDate =
    (po.confirmed_ship_date as string | null) ||
    (po.requested_ship_date as string | null) ||
    null;

  const oneClick = await issueOneClickTokens({
    workspaceId: opts.workspaceId,
    poId: opts.poId,
    shipDate,
  });

  const base = supplierLinkBaseUrl();
  const url = base ? `${base}/s/${token}` : null;
  const csvUrl = base
    ? `${base}/api/supplier-link/csv?token=${encodeURIComponent(token!)}`
    : null;

  const rawLines = (po.po_line_items ?? []) as Array<{
    description: string;
    qty: number;
    unit_cost: number;
    line_total: number | null;
    sort_order: number | null;
  }>;
  const lines = [...rawLines]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((line) => ({
      description: line.description,
      qty: Number(line.qty),
      unitCost: Number(line.unit_cost),
      lineTotal:
        line.line_total != null ? Number(line.line_total) : undefined,
    }));

  const emailResult = await sendPoSupplierEmail({
    to: emailTo,
    workspaceName: opts.workspaceName,
    poNumber: String(po.po_number ?? "PO"),
    supplierName: supplier?.name?.trim() || "Supplier",
    shipDateLabel: shipDate ? shortDate(shipDate) : null,
    lines,
    totals: {
      subtotal: Number(po.subtotal) || 0,
      tax: Number(po.tax_amount) || 0,
      shipping: Number(po.shipping_amount) || 0,
      adjustments: Number(po.adjustment_amount) || 0,
      total: Number(po.total) || 0,
    },
    confirmAsIsUrl: oneClick.confirmAsIsUrl,
    markShippedUrl: oneClick.markShippedUrl,
    supplierLinkUrl: url,
    pdfUrl: pdf.downloadUrl,
    csvUrl,
    replyTo: inboundReplyToAddress(token!),
  });

  return {
    token: token!,
    url,
    pdfDocumentId: pdf.id,
    pdfUrl: pdf.downloadUrl,
    pdfFileName: pdf.fileName,
    emailSent: emailResult.sent,
    emailError: emailResult.error ?? null,
    emailTo: emailTo || null,
    confirmAsIsUrl: oneClick.confirmAsIsUrl,
    markShippedUrl: oneClick.markShippedUrl,
  };
}

const EDITABLE_OPEN_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "confirmed",
  "production",
]);

/** @deprecated Use updateOpenPurchaseOrder — kept as alias for draft callers. */
export async function updateDraftPurchaseOrder(opts: {
  workspaceId: string;
  poId: string;
  locationId: string | null;
  requestedShipDate: string | null;
  notes: string | null;
  paymentTerms: string | null;
  referenceNumber: string | null;
  taxAmount: number;
  shippingAmount: number;
  adjustmentAmount: number;
  lines: CreateLineInput[];
  actorLabel?: string | null;
}): Promise<{ confirmationStale: boolean }> {
  return updateOpenPurchaseOrder(opts);
}

/**
 * Edit a draft or open (sent/viewed/confirmed/production) PO.
 * Post-send edits log a timeline event; edits after supplier confirm mark
 * confirmation_stale so the merchant knows to resend.
 */
export async function updateOpenPurchaseOrder(opts: {
  workspaceId: string;
  poId: string;
  locationId: string | null;
  requestedShipDate: string | null;
  notes: string | null;
  paymentTerms: string | null;
  referenceNumber: string | null;
  taxAmount: number;
  shippingAmount: number;
  adjustmentAmount: number;
  lines: CreateLineInput[];
  actorLabel?: string | null;
}): Promise<{ confirmationStale: boolean }> {
  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("id, status, confirmation_stale")
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error || !po) throw new Error(error?.message ?? "PO not found");
  if (!EDITABLE_OPEN_STATUSES.has(po.status)) {
    throw new Error(
      "This purchase order can no longer be edited in its current status",
    );
  }

  const { data: priorLines } = await supabase
    .from("po_line_items")
    .select("description, sku, qty, unit_cost")
    .eq("po_id", opts.poId)
    .order("sort_order");

  const lines = opts.lines
    .map((line) => ({
      description: String(line.description ?? "").trim(),
      sku: String(line.sku ?? "").trim(),
      qty: Number(line.qty),
      unit_cost: Number(line.unit_cost),
      is_free_text: Boolean(line.is_free_text),
      supplier_product_id: line.supplier_product_id || null,
    }))
    .filter((line) => line.description && line.qty > 0);
  if (!lines.length) throw new Error("Add at least one line item");

  const subtotal = Number(
    lines.reduce((sum, l) => sum + l.qty * l.unit_cost, 0).toFixed(2),
  );
  const taxAmount = Number(opts.taxAmount) || 0;
  const shippingAmount = Number(opts.shippingAmount) || 0;
  const adjustmentAmount = Number(opts.adjustmentAmount) || 0;

  const wasConfirmed = ["confirmed", "production"].includes(po.status);
  const confirmationStale = wasConfirmed || Boolean(po.confirmation_stale);

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({
      location_id: opts.locationId,
      notes: opts.notes,
      requested_ship_date: opts.requestedShipDate,
      payment_terms: opts.paymentTerms?.trim() || null,
      reference_number: opts.referenceNumber?.trim() || null,
      tax_amount: taxAmount,
      shipping_amount: shippingAmount,
      adjustment_amount: adjustmentAmount,
      subtotal,
      total: rollupTotal(subtotal, taxAmount, shippingAmount, adjustmentAmount),
      confirmation_stale: confirmationStale,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId);
  if (updateError) throw new Error(updateError.message);

  const { error: deleteError } = await supabase
    .from("po_line_items")
    .delete()
    .eq("po_id", opts.poId);
  if (deleteError) throw new Error(deleteError.message);

  const { error: lineError } = await supabase.from("po_line_items").insert(
    lines.map((line, index) => ({
      po_id: opts.poId,
      supplier_product_id: line.is_free_text ? null : line.supplier_product_id,
      description: line.description,
      sku: line.sku || null,
      is_free_text: line.is_free_text,
      qty: line.qty,
      unit_cost: line.unit_cost,
      line_total: Number((line.qty * line.unit_cost).toFixed(2)),
      sort_order: index,
    })),
  );
  if (lineError) throw new Error(lineError.message);

  if (po.status !== "draft") {
    const priorQty = (priorLines ?? []).reduce(
      (sum, l) => sum + (Number(l.qty) || 0),
      0,
    );
    const nextQty = lines.reduce((sum, l) => sum + l.qty, 0);
    const actor = opts.actorLabel?.trim() || "Merchant";
    const summaryParts = [
      `${actor} edited this PO after sending`,
      priorQty !== nextQty ? "quantities changed" : null,
      (priorLines ?? []).length !== lines.length ? "lines changed" : null,
    ].filter(Boolean);

    await supabase.from("po_timeline_events").insert({
      po_id: opts.poId,
      event_type: po.status,
      actor: "merchant",
      metadata: {
        kind: "post_send_edit",
        summary: summaryParts.join(" — "),
        confirmation_stale: confirmationStale,
        prior_line_count: (priorLines ?? []).length,
        next_line_count: lines.length,
        prior_qty: priorQty,
        next_qty: nextQty,
      },
    });
  }

  return { confirmationStale };
}

export async function updatePoCommercialFields(opts: {
  workspaceId: string;
  poId: string;
  paymentTerms: string | null;
  referenceNumber: string | null;
  taxAmount: number;
  shippingAmount: number;
  adjustmentAmount: number;
}): Promise<void> {
  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("id, subtotal")
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error || !po) throw new Error(error?.message ?? "PO not found");

  const taxAmount = Number(opts.taxAmount) || 0;
  const shippingAmount = Number(opts.shippingAmount) || 0;
  const adjustmentAmount = Number(opts.adjustmentAmount) || 0;
  const subtotal = Number(po.subtotal) || 0;

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({
      payment_terms: opts.paymentTerms?.trim() || null,
      reference_number: opts.referenceNumber?.trim() || null,
      tax_amount: taxAmount,
      shipping_amount: shippingAmount,
      adjustment_amount: adjustmentAmount,
      total: rollupTotal(subtotal, taxAmount, shippingAmount, adjustmentAmount),
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.poId);
  if (updateError) throw new Error(updateError.message);
}

export async function updatePoArrivalDate(opts: {
  workspaceId: string;
  poId: string;
  estimatedArrivalDate: string | null;
}): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ estimated_arrival_date: opts.estimatedArrivalDate })
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId);
  if (error) throw new Error(error.message);
}

export async function duplicatePurchaseOrder(opts: {
  workspaceId: string;
  poId: string;
}): Promise<{ id: string }> {
  const supabase = createServiceClient();
  const { data: source, error } = await supabase
    .from("purchase_orders")
    .select("*, po_line_items(*)")
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error || !source) throw new Error(error?.message ?? "PO not found");

  const poNumber = await nextPoNumber(opts.workspaceId);
  const { data: po, error: insertError } = await supabase
    .from("purchase_orders")
    .insert({
      workspace_id: opts.workspaceId,
      po_number: poNumber,
      supplier_id: source.supplier_id,
      location_id: source.location_id,
      status: "draft",
      notes: source.notes,
      requested_ship_date: source.requested_ship_date,
      subtotal: source.subtotal,
      total: source.total,
      duplicated_from_po_id: source.id,
      created_by: null,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  const lines = (source.po_line_items ?? []) as Array<{
    description: string;
    sku: string | null;
    is_free_text: boolean;
    qty: number;
    unit_cost: number;
    line_total: number;
    sort_order: number;
    supplier_product_id: string | null;
  }>;

  if (lines.length) {
    const { error: lineError } = await supabase.from("po_line_items").insert(
      lines.map((line) => ({
        po_id: po.id,
        supplier_product_id: line.supplier_product_id,
        description: line.description,
        sku: line.sku,
        is_free_text: line.is_free_text,
        qty: line.qty,
        unit_cost: line.unit_cost,
        line_total: line.line_total,
        sort_order: line.sort_order,
      })),
    );
    if (lineError) throw new Error(lineError.message);
  }

  await supabase.from("po_timeline_events").insert({
    po_id: po.id,
    event_type: "draft",
    actor: "merchant",
    metadata: { duplicated_from: source.po_number },
  });

  return { id: po.id };
}

/**
 * Merchant cancel — distinct from supplier `rejected`.
 * Allowed on any PO that is not already received / closed / rejected / cancelled.
 */
export async function cancelPurchaseOrder(opts: {
  workspaceId: string;
  poId: string;
  note?: string | null;
}): Promise<void> {
  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("id, status")
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error || !po) throw new Error(error?.message ?? "PO not found");

  const status = po.status as PoStatus;
  if (!canCancelPurchaseOrder(status)) {
    throw new Error(
      "Cancel is only available before the PO is received, closed, or rejected",
    );
  }

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId);
  if (updateError) throw new Error(updateError.message);

  const note = opts.note?.trim() || null;
  const { error: eventError } = await supabase.from("po_timeline_events").insert({
    po_id: opts.poId,
    event_type: "cancelled",
    actor: "merchant",
    metadata: {
      reason: "merchant_cancel",
      ...(note ? { note } : {}),
    },
  });
  if (eventError) throw new Error(eventError.message);
}

export async function resolveProposal(opts: {
  workspaceId: string;
  proposalId: string;
  accept: boolean;
}): Promise<{ poId: string | null }> {
  const supabase = createServiceClient();

  const { data: proposal, error: pErr } = await supabase
    .from("po_line_item_proposals")
    .select("id, po_line_item_id, proposed_qty, proposed_unit_cost, status")
    .eq("id", opts.proposalId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "pending") throw new Error("Proposal is not pending");

  const { data: line, error: lErr } = await supabase
    .from("po_line_items")
    .select(
      "id, po_id, qty, unit_cost, purchase_orders!inner(id, workspace_id, status, tax_amount, shipping_amount, adjustment_amount)",
    )
    .eq("id", proposal.po_line_item_id)
    .maybeSingle();
  if (lErr) throw new Error(lErr.message);
  if (!line) throw new Error("Line item not found");

  const po = line.purchase_orders as unknown as {
    id: string;
    workspace_id: string;
    status: string;
    tax_amount: number | null;
    shipping_amount: number | null;
    adjustment_amount: number | null;
  };
  if (po.workspace_id !== opts.workspaceId) {
    throw new Error("Proposal not found in this workspace");
  }
  if (po.status === "rejected") throw new Error("This purchase order was rejected");

  if (opts.accept) {
    const qty =
      proposal.proposed_qty != null ? Number(proposal.proposed_qty) : Number(line.qty);
    const unitCost =
      proposal.proposed_unit_cost != null
        ? Number(proposal.proposed_unit_cost)
        : Number(line.unit_cost);
    const { error: lineErr } = await supabase
      .from("po_line_items")
      .update({
        qty,
        unit_cost: unitCost,
        line_total: Number((qty * unitCost).toFixed(2)),
      })
      .eq("id", line.id);
    if (lineErr) throw new Error(lineErr.message);

    const { data: lines, error: sumErr } = await supabase
      .from("po_line_items")
      .select("line_total")
      .eq("po_id", po.id);
    if (sumErr) throw new Error(sumErr.message);
    const subtotal = Number(
      (lines ?? []).reduce((sum, row) => sum + (Number(row.line_total) || 0), 0).toFixed(2),
    );
    const { error: poErr } = await supabase
      .from("purchase_orders")
      .update({
        subtotal,
        total: rollupTotal(
          subtotal,
          Number(po.tax_amount) || 0,
          Number(po.shipping_amount) || 0,
          Number(po.adjustment_amount) || 0,
        ),
        updated_at: new Date().toISOString(),
      })
      .eq("id", po.id)
      .eq("workspace_id", opts.workspaceId);
    if (poErr) throw new Error(poErr.message);
  }

  const { error: resolveErr } = await supabase
    .from("po_line_item_proposals")
    .update({
      status: opts.accept ? "accepted" : "rejected",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", proposal.id);
  if (resolveErr) throw new Error(resolveErr.message);

  return { poId: po.id };
}

export async function submitPoInvoiceAmount(opts: {
  workspaceId: string;
  poId: string;
  invoiceAmount: number;
}): Promise<void> {
  if (!Number.isFinite(opts.invoiceAmount) || opts.invoiceAmount < 0) {
    throw new Error("Enter a valid invoiced amount");
  }
  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("id, status, total")
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!po) throw new Error("Purchase order not found");

  const amount = Number(opts.invoiceAmount.toFixed(2));
  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({
      invoice_amount: amount,
      invoice_submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId);
  if (updateError) throw new Error(updateError.message);

  const { error: eventError } = await supabase.from("po_timeline_events").insert({
    po_id: opts.poId,
    event_type: po.status,
    actor: "merchant",
    metadata: {
      kind: "invoice_submitted",
      summary: `Invoiced amount recorded: ${money(amount)} (PO total ${money(po.total)})`,
      invoice_amount: amount,
    },
  });
  if (eventError) throw new Error(eventError.message);
}

export async function listCalendarPurchaseOrders(workspaceId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, total, requested_ship_date, estimated_arrival_date, suppliers(name)",
    )
    .eq("workspace_id", workspaceId)
    .order("requested_ship_date", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((po) => {
      const plotDate = po.estimated_arrival_date || po.requested_ship_date;
      if (!plotDate) return null;
      const status = po.status as PoStatus;
      const supplier = po.suppliers as unknown as { name: string } | null;
      return {
        id: po.id,
        poNumber: po.po_number,
        status,
        statusLabel: statusLabel(status),
        statusTone: statusBadgeTone(status),
        total: money(po.total),
        plotDate,
        plotLabel: shortDate(plotDate),
        dateSource: po.estimated_arrival_date ? "arrival" : "ship",
        supplierName: supplier?.name ?? "—",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => (a.plotDate < b.plotDate ? -1 : 1));
}
