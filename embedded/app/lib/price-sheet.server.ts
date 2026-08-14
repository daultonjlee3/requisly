/**
 * CSV price-sheet parse + match against Shopify product_variants.
 * Exact matches proposed first; fuzzy candidates require merchant confirm.
 */
import { createServiceClient } from "./supabase.server";
import { todayDateInputValue } from "./pricing";
import { createSupplierProduct } from "./products.server";
import {
  normalizeSku,
  rankSkuCandidates,
  type SkuCandidate,
} from "./sku-match.server";

export type PriceSheetRow = {
  rowIndex: number;
  sku: string;
  title: string;
  unitCost: number | null;
  moq: number | null;
  caseQty: number | null;
  leadTimeDays: number | null;
};

export type MatchedRow = PriceSheetRow & {
  matchKind: "exact" | "fuzzy" | "none";
  productVariantId: string | null;
  candidates: SkuCandidate[];
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function headerIndex(headers: string[], names: string[]): number {
  const normalized = headers.map((h) =>
    h.trim().toLowerCase().replace(/[\s_]+/g, ""),
  );
  for (const name of names) {
    const idx = normalized.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parsePriceSheetCsv(text: string): PriceSheetRow[] {
  const table = parseCsv(text.replace(/^\uFEFF/, ""));
  if (table.length < 2) {
    throw new Error("CSV needs a header row and at least one data row");
  }
  const headers = table[0];
  const skuIdx = headerIndex(headers, ["sku", "skucode", "itemsku"]);
  const titleIdx = headerIndex(headers, [
    "title",
    "name",
    "description",
    "product",
    "item",
  ]);
  const costIdx = headerIndex(headers, [
    "unitcost",
    "cost",
    "price",
    "unitprice",
  ]);
  const moqIdx = headerIndex(headers, ["moq", "minimumorder", "minqty"]);
  const caseIdx = headerIndex(headers, ["caseqty", "case", "packqty"]);
  const leadIdx = headerIndex(headers, ["leadtimedays", "leadtime", "lead"]);

  if (skuIdx < 0 && titleIdx < 0) {
    throw new Error("CSV must include a sku or title column");
  }

  const out: PriceSheetRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cols = table[i];
    const sku = String(cols[skuIdx] ?? "").trim();
    const title = String(cols[titleIdx] ?? "").trim() || sku;
    if (!sku && !title) continue;
    const costRaw = String(cols[costIdx] ?? "").trim();
    const unitCost =
      costRaw === ""
        ? null
        : Number(costRaw.replace(/[^0-9.-]/g, ""));
    const moqRaw = String(cols[moqIdx] ?? "").trim();
    const caseRaw = String(cols[caseIdx] ?? "").trim();
    const leadRaw = String(cols[leadIdx] ?? "").trim();
    out.push({
      rowIndex: i,
      sku,
      title,
      unitCost:
        unitCost != null && Number.isFinite(unitCost) ? unitCost : null,
      moq: moqRaw === "" ? null : Number.parseInt(moqRaw, 10),
      caseQty: caseRaw === "" ? null : Number.parseInt(caseRaw, 10),
      leadTimeDays: leadRaw === "" ? null : Number.parseInt(leadRaw, 10),
    });
  }
  if (!out.length) throw new Error("No usable rows found in CSV");
  return out;
}

export async function matchPriceSheetRows(
  workspaceId: string,
  rows: PriceSheetRow[],
): Promise<MatchedRow[]> {
  const supabase = createServiceClient();
  const { data: variants, error } = await supabase
    .from("product_variants")
    .select("id, title, sku")
    .eq("workspace_id", workspaceId)
    .limit(5000);
  if (error) throw new Error(error.message);

  const byNorm = new Map<string, { id: string; title: string; sku: string }>();
  for (const v of variants ?? []) {
    const key = normalizeSku(v.sku);
    if (key && !byNorm.has(key)) {
      byNorm.set(key, {
        id: v.id,
        title: v.title,
        sku: v.sku ?? "",
      });
    }
  }

  return rows.map((row) => {
    const exact = byNorm.get(normalizeSku(row.sku));
    if (exact) {
      return {
        ...row,
        matchKind: "exact" as const,
        productVariantId: exact.id,
        candidates: [
          {
            productVariantId: exact.id,
            title: exact.title,
            sku: exact.sku,
            confidence: 1,
          },
        ],
      };
    }
    const candidates = rankSkuCandidates(row.sku || row.title, variants ?? [], 3);
    if (candidates.length) {
      return {
        ...row,
        matchKind: "fuzzy" as const,
        productVariantId: null,
        candidates,
      };
    }
    return {
      ...row,
      matchKind: "none" as const,
      productVariantId: null,
      candidates: [],
    };
  });
}

export type ConfirmedImportLine = {
  title: string;
  sku: string;
  unitCost: number | null;
  moq: number | null;
  caseQty: number | null;
  leadTimeDays: number | null;
  productVariantId: string | null;
};

export async function importConfirmedPriceSheetLines(opts: {
  workspaceId: string;
  supplierId: string;
  lines: ConfirmedImportLine[];
}): Promise<{ imported: number }> {
  let imported = 0;
  const effective = todayDateInputValue();
  for (const line of opts.lines) {
    const form = new FormData();
    form.set("supplier_id", opts.supplierId);
    form.set("title", line.title);
    form.set("sku", line.sku);
    if (line.productVariantId) {
      form.set("product_variant_id", line.productVariantId);
    }
    if (line.unitCost != null) {
      form.set("unit_cost", String(line.unitCost));
      form.set("effective_date", effective);
    }
    if (line.moq != null) form.set("moq", String(line.moq));
    if (line.caseQty != null) form.set("case_qty", String(line.caseQty));

    const created = await createSupplierProduct(opts.workspaceId, form);
    if (line.leadTimeDays != null && Number.isFinite(line.leadTimeDays)) {
      const supabase = createServiceClient();
      await supabase
        .from("supplier_products")
        .update({ lead_time_days: line.leadTimeDays })
        .eq("id", created.id)
        .eq("workspace_id", opts.workspaceId);
    }
    imported += 1;
  }
  return { imported };
}
