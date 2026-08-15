import { useFetcher } from "@remix-run/react";
import { useCallback, useEffect, useRef } from "react";
import { downloadListCsv } from "./csv";
import { exportSearchParams } from "./list-table";

type ExportPayload<T> = {
  exportToken?: number | null;
  exportRows?: T[] | null;
};

type MapRow<T> = (row: T) => Array<string | number | null | undefined>;

/**
 * Loads the same list route with ?export=1 (current URL filters) and
 * downloads via the shared CSV helpers — not the current page only.
 */
export function useFilteredCsvExport<T>(opts: {
  path: string;
  searchParams: URLSearchParams;
  prefix: string;
  headers: string[];
  mapRow: MapRow<T>;
}) {
  const fetcher = useFetcher<ExportPayload<T>>();
  const lastToken = useRef<number | null>(null);
  const mapRowRef = useRef<MapRow<T>>(opts.mapRow);
  const headersRef = useRef(opts.headers);
  const prefixRef = useRef(opts.prefix);
  mapRowRef.current = opts.mapRow;
  headersRef.current = opts.headers;
  prefixRef.current = opts.prefix;

  useEffect(() => {
    const token = fetcher.data?.exportToken;
    const rows = fetcher.data?.exportRows;
    if (!token || token === lastToken.current || !rows) return;
    lastToken.current = token;
    downloadListCsv(
      prefixRef.current,
      headersRef.current,
      rows.map((row) => mapRowRef.current(row as T)),
    );
  }, [fetcher.data]);

  const search = opts.searchParams.toString();
  const exportCsv = useCallback(() => {
    const params = new URLSearchParams(search);
    fetcher.load(`${opts.path}${exportSearchParams(params)}`);
  }, [fetcher, opts.path, search]);

  return {
    exporting: fetcher.state !== "idle",
    exportCsv,
  };
}
