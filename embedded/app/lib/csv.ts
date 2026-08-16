/**
 * Minimal CSV helpers for merchant exports (accountant-friendly raw rows).
 * Encoding lives in src/lib/csv.ts so Supplier Link can reuse the same file.
 */
export {
  escapeCsvCell,
  stampFilename,
  toCsv,
} from "../../../src/lib/csv";

import { stampFilename, toCsv } from "../../../src/lib/csv";

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Shared list/table export — same helpers as POs / Suppliers / Analytics. */
export function downloadListCsv(
  prefix: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  downloadCsv(stampFilename(prefix), toCsv(headers, rows));
}
