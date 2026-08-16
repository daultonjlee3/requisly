/**
 * Shared CSV helpers — same escaping and row shape as merchant exports.
 * Pure functions only. Browser download lives in embedded/app/lib/csv.ts.
 */

export function escapeCsvCell(
  value: string | number | null | undefined,
): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function stampFilename(prefix: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${prefix}-${y}${m}${day}.csv`;
}

/** Columns already used for PO line CSV (Create PO import + merchant exports). */
export const PO_LINE_CSV_HEADERS = [
  "description",
  "sku",
  "qty",
  "unit_cost",
  "line_total",
] as const;

export type PoLineCsvRow = {
  description: string;
  sku?: string | null;
  qty: number;
  unitCost: number;
  lineTotal?: number | null;
};

export function buildPoLineItemsCsv(lines: PoLineCsvRow[]): string {
  return toCsv(
    [...PO_LINE_CSV_HEADERS],
    lines.map((line) => {
      const qty = Number(line.qty);
      const unit = Number(line.unitCost);
      const total =
        line.lineTotal != null && Number.isFinite(Number(line.lineTotal))
          ? Number(line.lineTotal)
          : Number.isFinite(qty) && Number.isFinite(unit)
            ? Number((qty * unit).toFixed(2))
            : "";
      return [
        line.description,
        line.sku ?? "",
        Number.isFinite(qty) ? qty : line.qty,
        Number.isFinite(unit) ? unit : line.unitCost,
        total,
      ];
    }),
  );
}

export function csvFileName(poNumber: string): string {
  const safe = poNumber.replace(/[^a-zA-Z0-9-_]/g, "_") || "PO";
  return `${safe}.csv`;
}
