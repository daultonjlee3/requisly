/**
 * Quote Requests (RFQ) — multi-supplier competitive quotes.
 * Award creates draft POs via createPurchaseOrder (golden workflow starts at draft).
 */
import { createServiceClient } from "./supabase.server";
import { randomToken } from "./format";
import { createPurchaseOrder } from "./purchase-orders.server";
import { money } from "./format";

export type QuoteRequestStatus =
  | "draft"
  | "sent"
  | "partially_responded"
  | "responded"
  | "awarded"
  | "cancelled";

export type QuoteLineInput = {
  description: string;
  sku?: string | null;
  qty: number;
  is_free_text: boolean;
  supplier_product_id?: string | null;
};

export type QuoteRequestListItem = {
  id: string;
  title: string;
  status: QuoteRequestStatus;
  supplierCount: number;
  responseCount: number;
  lineCount: number;
  createdAt: string;
  neededBy: string | null;
};

export type ComparisonCell = {
  quoteRequestSupplierId: string;
  supplierId: string;
  supplierName: string;
  unitCost: number | null;
  leadTimeDays: number | null;
  notes: string | null;
  source: "link" | "email" | null;
  isCheapest: boolean;
  hasResponse: boolean;
};

export type ComparisonLine = {
  lineId: string;
  description: string;
  sku: string | null;
  qty: number;
  isFreeText: boolean;
  supplierProductId: string | null;
  awardedQuoteRequestSupplierId: string | null;
  cells: ComparisonCell[];
  cheapestUnitCost: number | null;
};

export type QuoteRequestDetail = {
  id: string;
  title: string;
  status: QuoteRequestStatus;
  notes: string | null;
  neededBy: string | null;
  createdAt: string;
  sentAt: string | null;
  awardedAt: string | null;
  lines: Array<{
    id: string;
    description: string;
    sku: string | null;
    qty: number;
    isFreeText: boolean;
    supplierProductId: string | null;
    sortOrder: number;
    awardedQuoteRequestSupplierId: string | null;
  }>;
  suppliers: Array<{
    id: string;
    supplierId: string;
    supplierName: string;
    supplierEmail: string | null;
    token: string;
    status: string;
    linkUrl: string;
    respondedAt: string | null;
    purchaseOrderId: string | null;
  }>;
  comparison: ComparisonLine[];
  responses: Array<{
    quoteRequestSupplierId: string;
    quoteRequestLineId: string;
    unitCost: number;
    leadTimeDays: number | null;
    notes: string | null;
    source: string;
  }>;
};

function supplierLinkBase(): string {
  return (
    process.env.SUPPLIER_LINK_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://requisly.com"
  ).replace(/\/$/, "");
}

export function quoteRequestLinkUrl(token: string): string {
  return `${supplierLinkBase()}/q/${token}`;
}

export async function listQuoteRequests(
  workspaceId: string,
): Promise<QuoteRequestListItem[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("quote_requests")
    .select(
      "id, title, status, created_at, needed_by, quote_request_lines(id), quote_request_suppliers(id, status)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const suppliers = (row.quote_request_suppliers ?? []) as Array<{
      id: string;
      status: string;
    }>;
    return {
      id: row.id as string,
      title: row.title as string,
      status: row.status as QuoteRequestStatus,
      supplierCount: suppliers.length,
      responseCount: suppliers.filter((s) => s.status === "responded").length,
      lineCount: ((row.quote_request_lines ?? []) as Array<{ id: string }>)
        .length,
      createdAt: row.created_at as string,
      neededBy: (row.needed_by as string | null) ?? null,
    };
  });
}

export async function createQuoteRequest(opts: {
  workspaceId: string;
  title: string;
  notes?: string | null;
  neededBy?: string | null;
  supplierIds: string[];
  lines: QuoteLineInput[];
}): Promise<{ id: string }> {
  const title = opts.title.trim();
  if (!title) throw new Error("Title is required");
  const supplierIds = [...new Set(opts.supplierIds.filter(Boolean))];
  if (!supplierIds.length) throw new Error("Select at least one supplier");
  const lines = opts.lines
    .map((l, index) => ({
      description: String(l.description ?? "").trim(),
      sku: String(l.sku ?? "").trim() || null,
      qty: Math.floor(Number(l.qty)),
      is_free_text: Boolean(l.is_free_text),
      supplier_product_id: l.is_free_text
        ? null
        : l.supplier_product_id || null,
      sort_order: index,
    }))
    .filter((l) => l.description && l.qty > 0);
  if (!lines.length) throw new Error("Add at least one line item");

  const supabase = createServiceClient();

  const catalogIds = [
    ...new Set(
      lines
        .map((l) => l.supplier_product_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (catalogIds.length) {
    const { data: catalog, error: cErr } = await supabase
      .from("supplier_products")
      .select("id")
      .eq("workspace_id", opts.workspaceId)
      .in("id", catalogIds);
    if (cErr) throw new Error(cErr.message);
    if ((catalog ?? []).length !== catalogIds.length) {
      throw new Error("Catalog product is not in this workspace");
    }
  }

  const { data: suppliers, error: sErr } = await supabase
    .from("suppliers")
    .select("id")
    .eq("workspace_id", opts.workspaceId)
    .in("id", supplierIds);
  if (sErr) throw new Error(sErr.message);
  if ((suppliers ?? []).length !== supplierIds.length) {
    throw new Error("One or more suppliers are not in this workspace");
  }

  const { data: qr, error } = await supabase
    .from("quote_requests")
    .insert({
      workspace_id: opts.workspaceId,
      title,
      notes: opts.notes?.trim() || null,
      needed_by: opts.neededBy?.trim() || null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: lineErr } = await supabase.from("quote_request_lines").insert(
    lines.map((l) => ({
      quote_request_id: qr.id,
      ...l,
    })),
  );
  if (lineErr) throw new Error(lineErr.message);

  const { error: invErr } = await supabase
    .from("quote_request_suppliers")
    .insert(
      supplierIds.map((supplierId) => ({
        quote_request_id: qr.id,
        supplier_id: supplierId,
        token: randomToken(24),
        status: "invited",
      })),
    );
  if (invErr) throw new Error(invErr.message);

  return { id: qr.id as string };
}

export async function getQuoteRequestDetail(
  workspaceId: string,
  quoteRequestId: string,
): Promise<QuoteRequestDetail | null> {
  const supabase = createServiceClient();
  const { data: qr, error } = await supabase
    .from("quote_requests")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", quoteRequestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!qr) return null;

  const [{ data: lines }, { data: suppliers }] = await Promise.all([
    supabase
      .from("quote_request_lines")
      .select("*")
      .eq("quote_request_id", quoteRequestId)
      .order("sort_order"),
    supabase
      .from("quote_request_suppliers")
      .select("*, suppliers(id, name, email)")
      .eq("quote_request_id", quoteRequestId),
  ]);

  const supplierIds = (suppliers ?? []).map((s) => s.id as string);
  const { data: responses } = supplierIds.length
    ? await supabase
        .from("quote_request_responses")
        .select(
          "quote_request_supplier_id, quote_request_line_id, unit_cost, lead_time_days, notes, source",
        )
        .in("quote_request_supplier_id", supplierIds)
    : { data: [] as Array<Record<string, unknown>> };

  const supplierRows = (suppliers ?? []).map((s) => {
    const sup = s.suppliers as unknown as {
      id: string;
      name: string;
      email: string | null;
    } | null;
    return {
      id: s.id as string,
      supplierId: s.supplier_id as string,
      supplierName: sup?.name ?? "—",
      supplierEmail: sup?.email ?? null,
      token: s.token as string,
      status: s.status as string,
      linkUrl: quoteRequestLinkUrl(s.token as string),
      respondedAt: (s.responded_at as string | null) ?? null,
      purchaseOrderId: (s.purchase_order_id as string | null) ?? null,
    };
  });

  const responseRows = (responses ?? []).map((r) => ({
    quoteRequestSupplierId: r.quote_request_supplier_id as string,
    quoteRequestLineId: r.quote_request_line_id as string,
    unitCost: Number(r.unit_cost),
    leadTimeDays:
      r.lead_time_days != null ? Number(r.lead_time_days) : null,
    notes: (r.notes as string | null) ?? null,
    source: r.source as string,
  }));

  const responseKey = (sid: string, lid: string) => `${sid}::${lid}`;
  const responseMap = new Map(
    responseRows.map((r) => [
      responseKey(r.quoteRequestSupplierId, r.quoteRequestLineId),
      r,
    ]),
  );

  const comparison: ComparisonLine[] = (lines ?? []).map((line) => {
    const lineId = line.id as string;
    const costs = supplierRows
      .map((s) => responseMap.get(responseKey(s.id, lineId))?.unitCost)
      .filter((c): c is number => c != null && Number.isFinite(c));
    const cheapest = costs.length ? Math.min(...costs) : null;

    const cells: ComparisonCell[] = supplierRows.map((s) => {
      const resp = responseMap.get(responseKey(s.id, lineId));
      const unitCost = resp?.unitCost ?? null;
      return {
        quoteRequestSupplierId: s.id,
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        unitCost,
        leadTimeDays: resp?.leadTimeDays ?? null,
        notes: resp?.notes ?? null,
        source: (resp?.source as "link" | "email" | undefined) ?? null,
        hasResponse: Boolean(resp),
        isCheapest:
          cheapest != null && unitCost != null && unitCost === cheapest,
      };
    });

    return {
      lineId,
      description: line.description as string,
      sku: (line.sku as string | null) ?? null,
      qty: Number(line.qty),
      isFreeText: Boolean(line.is_free_text),
      supplierProductId: (line.supplier_product_id as string | null) ?? null,
      awardedQuoteRequestSupplierId:
        (line.awarded_quote_request_supplier_id as string | null) ?? null,
      cells,
      cheapestUnitCost: cheapest,
    };
  });

  return {
    id: qr.id as string,
    title: qr.title as string,
    status: qr.status as QuoteRequestStatus,
    notes: (qr.notes as string | null) ?? null,
    neededBy: (qr.needed_by as string | null) ?? null,
    createdAt: qr.created_at as string,
    sentAt: (qr.sent_at as string | null) ?? null,
    awardedAt: (qr.awarded_at as string | null) ?? null,
    lines: (lines ?? []).map((l) => ({
      id: l.id as string,
      description: l.description as string,
      sku: (l.sku as string | null) ?? null,
      qty: Number(l.qty),
      isFreeText: Boolean(l.is_free_text),
      supplierProductId: (l.supplier_product_id as string | null) ?? null,
      sortOrder: Number(l.sort_order),
      awardedQuoteRequestSupplierId:
        (l.awarded_quote_request_supplier_id as string | null) ?? null,
    })),
    suppliers: supplierRows,
    comparison,
    responses: responseRows,
  };
}

export async function sendQuoteRequest(opts: {
  workspaceId: string;
  quoteRequestId: string;
  workspaceName: string;
}): Promise<{ emailed: number; links: Array<{ supplierName: string; url: string }> }> {
  const detail = await getQuoteRequestDetail(
    opts.workspaceId,
    opts.quoteRequestId,
  );
  if (!detail) throw new Error("Quote request not found");
  if (detail.status === "cancelled" || detail.status === "awarded") {
    throw new Error("Cannot send a cancelled or awarded quote request");
  }

  const { sendQuoteRequestEmail } = await import("./quote-request-email.server");
  const supabase = createServiceClient();
  let emailed = 0;
  const links: Array<{ supplierName: string; url: string }> = [];

  for (const inv of detail.suppliers) {
    links.push({ supplierName: inv.supplierName, url: inv.linkUrl });
    if (inv.supplierEmail) {
      await sendQuoteRequestEmail({
        to: inv.supplierEmail,
        workspaceName: opts.workspaceName,
        supplierName: inv.supplierName,
        title: detail.title,
        neededBy: detail.neededBy,
        quoteLinkUrl: inv.linkUrl,
        replyToToken: inv.token,
        lines: detail.lines.map((l) => ({
          description: l.description,
          sku: l.sku,
          qty: l.qty,
        })),
      });
      emailed += 1;
    }
  }

  const { error } = await supabase
    .from("quote_requests")
    .update({
      status: detail.status === "draft" ? "sent" : detail.status,
      sent_at: detail.sentAt ?? new Date().toISOString(),
    })
    .eq("id", opts.quoteRequestId)
    .eq("workspace_id", opts.workspaceId);
  if (error) throw new Error(error.message);

  return { emailed, links };
}

/**
 * Award lines to suppliers (can split across suppliers), then create one
 * draft PO per supplier with their awarded lines. Never auto-sends / confirms.
 */
export async function awardQuoteRequest(opts: {
  workspaceId: string;
  quoteRequestId: string;
  /** lineId → quoteRequestSupplierId */
  awards: Record<string, string>;
  locationId: string | null;
}): Promise<{
  purchaseOrders: Array<{
    supplierId: string;
    supplierName: string;
    poId: string;
    poNumber: string;
    lineCount: number;
  }>;
}> {
  const detail = await getQuoteRequestDetail(
    opts.workspaceId,
    opts.quoteRequestId,
  );
  if (!detail) throw new Error("Quote request not found");
  if (detail.status === "cancelled") {
    throw new Error("Cannot award a cancelled quote request");
  }
  if (detail.status === "awarded") {
    throw new Error("This quote request is already awarded");
  }

  const awards = opts.awards;
  const awardedLineIds = Object.keys(awards).filter((id) => awards[id]);
  if (!awardedLineIds.length) {
    throw new Error("Select a supplier for at least one line");
  }

  const supplierById = new Map(detail.suppliers.map((s) => [s.id, s]));
  const lineById = new Map(detail.lines.map((l) => [l.id, l]));
  const responseMap = new Map(
    detail.responses.map((r) => [
      `${r.quoteRequestSupplierId}::${r.quoteRequestLineId}`,
      r,
    ]),
  );

  // Group awarded lines by quote_request_supplier
  const bySupplier = new Map<
    string,
    Array<{ lineId: string; unitCost: number; qty: number }>
  >();

  for (const lineId of awardedLineIds) {
    const line = lineById.get(lineId);
    const qsId = awards[lineId];
    if (!line || !qsId) continue;
    const inv = supplierById.get(qsId);
    if (!inv) throw new Error("Invalid supplier award selection");
    const resp = responseMap.get(`${qsId}::${lineId}`);
    if (!resp) {
      throw new Error(
        `No quote from ${inv.supplierName} for “${line.description}”`,
      );
    }
    const list = bySupplier.get(qsId) ?? [];
    list.push({ lineId, unitCost: resp.unitCost, qty: line.qty });
    bySupplier.set(qsId, list);
  }

  const supabase = createServiceClient();
  const purchaseOrders: Array<{
    supplierId: string;
    supplierName: string;
    poId: string;
    poNumber: string;
    lineCount: number;
  }> = [];

  for (const [qsId, awarded] of bySupplier) {
    const inv = supplierById.get(qsId)!;

    const { data: rawLines } = await supabase
      .from("quote_request_lines")
      .select("id, supplier_product_id, is_free_text, sku")
      .eq("quote_request_id", opts.quoteRequestId)
      .in(
        "id",
        awarded.map((a) => a.lineId),
      );

    const catalogIds = [
      ...new Set(
        (rawLines ?? [])
          .map((r) => r.supplier_product_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const { data: catalogRows } = catalogIds.length
      ? await supabase
          .from("supplier_products")
          .select("id, product_variant_id, sku, supplier_id")
          .eq("workspace_id", opts.workspaceId)
          .in("id", catalogIds)
      : { data: [] as Array<Record<string, unknown>> };

    const originBySp = new Map(
      (catalogRows ?? []).map((r) => [
        r.id as string,
        {
          productVariantId: (r.product_variant_id as string | null) ?? null,
          sku: ((r.sku as string | null) ?? "").trim().toLowerCase(),
        },
      ]),
    );

    const { data: awardedCatalog } = await supabase
      .from("supplier_products")
      .select("id, product_variant_id, sku")
      .eq("workspace_id", opts.workspaceId)
      .eq("supplier_id", inv.supplierId);

    const byVariant = new Map<string, string>();
    const bySku = new Map<string, string>();
    for (const row of awardedCatalog ?? []) {
      const vid = row.product_variant_id as string | null;
      const sku = ((row.sku as string | null) ?? "").trim().toLowerCase();
      if (vid && !byVariant.has(vid)) byVariant.set(vid, row.id as string);
      if (sku && !bySku.has(sku)) bySku.set(sku, row.id as string);
    }

    const poLinesFinal = awarded.map((a) => {
      const line = lineById.get(a.lineId)!;
      const raw = (rawLines ?? []).find((r) => r.id === a.lineId);
      const originId = (raw?.supplier_product_id as string | null) ?? null;
      const origin = originId ? originBySp.get(originId) : null;
      const remapped =
        (origin?.productVariantId
          ? byVariant.get(origin.productVariantId)
          : undefined) ??
        (origin?.sku ? bySku.get(origin.sku) : undefined) ??
        (line.sku ? bySku.get(line.sku.trim().toLowerCase()) : undefined) ??
        null;
      const isFree = !remapped;
      return {
        description: line.description,
        sku: line.sku,
        qty: a.qty,
        unit_cost: a.unitCost,
        is_free_text: isFree,
        supplier_product_id: remapped,
      };
    });

    const { id: poId, poNumber } = await createPurchaseOrder({
      workspaceId: opts.workspaceId,
      supplierId: inv.supplierId,
      locationId: opts.locationId,
      requestedShipDate: detail.neededBy,
      notes: `Awarded from quote request “${detail.title}”`,
      lines: poLinesFinal,
      source: "quote_request_award",
      referenceNumber: `RFQ:${opts.quoteRequestId.slice(0, 8)}`,
    });

    await supabase
      .from("quote_request_suppliers")
      .update({ purchase_order_id: poId })
      .eq("id", qsId);

    for (const a of awarded) {
      await supabase
        .from("quote_request_lines")
        .update({ awarded_quote_request_supplier_id: qsId })
        .eq("id", a.lineId);
    }

    purchaseOrders.push({
      supplierId: inv.supplierId,
      supplierName: inv.supplierName,
      poId,
      poNumber,
      lineCount: awarded.length,
    });
  }

  const { error } = await supabase
    .from("quote_requests")
    .update({
      status: "awarded",
      awarded_at: new Date().toISOString(),
    })
    .eq("id", opts.quoteRequestId)
    .eq("workspace_id", opts.workspaceId);
  if (error) throw new Error(error.message);

  return { purchaseOrders };
}

/** Format helper for comparison cells in UI. */
export function formatComparisonCost(unitCost: number | null): string {
  return unitCost == null ? "—" : money(unitCost);
}

/**
 * Apply an email-parsed quote for a supplier invite token.
 * Reuses parseSupplierQuoteReply + matchParsedQuotesToLines.
 */
export async function applyEmailQuoteResponse(opts: {
  token: string;
  emailBody: string;
}): Promise<{ applied: number; confidence: string }> {
  const {
    parseSupplierQuoteReply,
    matchParsedQuotesToLines,
  } = await import("./email-reply-parse.server");
  const supabase = createServiceClient();

  const { data: inv, error } = await supabase
    .from("quote_request_suppliers")
    .select("id, quote_request_id, token")
    .eq("token", opts.token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) throw new Error("Unknown RFQ token");

  const { data: qr } = await supabase
    .from("quote_requests")
    .select("id, status")
    .eq("id", inv.quote_request_id)
    .maybeSingle();
  if (!qr || ["cancelled", "awarded", "draft"].includes(qr.status as string)) {
    throw new Error("Quote request is not open for responses");
  }

  const { data: lines } = await supabase
    .from("quote_request_lines")
    .select("id, sku, description")
    .eq("quote_request_id", inv.quote_request_id)
    .order("sort_order");

  const parsed = parseSupplierQuoteReply(opts.emailBody);
  const matched = matchParsedQuotesToLines(
    parsed,
    (lines ?? []).map((l) => ({
      id: l.id as string,
      sku: (l.sku as string | null) ?? null,
      description: l.description as string,
    })),
  );

  for (const m of matched) {
    await supabase.from("quote_request_responses").upsert(
      {
        quote_request_supplier_id: inv.id,
        quote_request_line_id: m.quoteRequestLineId,
        unit_cost: m.unitCost,
        lead_time_days: m.leadTimeDays,
        source: "email",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "quote_request_supplier_id,quote_request_line_id" },
    );
  }

  if (matched.length) {
    await supabase
      .from("quote_request_suppliers")
      .update({
        status: "responded",
        responded_at: new Date().toISOString(),
      })
      .eq("id", inv.id);

    const { data: allInv } = await supabase
      .from("quote_request_suppliers")
      .select("status")
      .eq("quote_request_id", inv.quote_request_id);
    const total = (allInv ?? []).length;
    const responded = (allInv ?? []).filter(
      (s) => s.status === "responded",
    ).length;
    await supabase
      .from("quote_requests")
      .update({
        status:
          responded >= total
            ? "responded"
            : responded > 0
              ? "partially_responded"
              : qr.status,
      })
      .eq("id", inv.quote_request_id);
  }

  return { applied: matched.length, confidence: parsed.confidence };
}
