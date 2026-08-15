/**
 * Shared list/table windowing for embedded IndexTables.
 * Page size is fixed so every list paginates the same way.
 */

export const LIST_PAGE_SIZE = 50;
export const LIST_EXPORT_CAP = 5000;
export const LIST_VIEW_CAP = 500;

export type ListPageOpts = {
  q?: string | null;
  page?: number;
  pageSize?: number;
  forExport?: boolean;
  /** Hard cap without page math (kanban / calendar / picker). */
  cap?: number;
};

export type ListPageResult<T> = {
  rows: T[];
  total: number;
};

export function parseListPage(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function parseListQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, 80);
}

/** Strip PostgREST ilike wildcards so user input cannot widen a filter. */
export function sanitizeSearch(q: string | null | undefined): string {
  return parseListQuery(q).replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

export function resolveListWindow(opts?: ListPageOpts): {
  page: number;
  pageSize: number;
  from: number;
  to: number;
} {
  if (opts?.forExport) {
    return {
      page: 1,
      pageSize: LIST_EXPORT_CAP,
      from: 0,
      to: LIST_EXPORT_CAP - 1,
    };
  }
  if (opts?.cap != null) {
    const cap = Math.max(1, opts.cap);
    return { page: 1, pageSize: cap, from: 0, to: cap - 1 };
  }
  if (opts?.page == null && opts?.pageSize == null) {
    return {
      page: 1,
      pageSize: LIST_VIEW_CAP,
      from: 0,
      to: LIST_VIEW_CAP - 1,
    };
  }
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = opts?.pageSize ?? LIST_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

export function indexTablePagination(opts: {
  page: number;
  total: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}) {
  const pageSize = opts.pageSize ?? LIST_PAGE_SIZE;
  const start = opts.total === 0 ? 0 : (opts.page - 1) * pageSize + 1;
  const end = Math.min(opts.page * pageSize, opts.total);
  return {
    hasPrevious: opts.page > 1,
    hasNext: end < opts.total,
    onPrevious: () => opts.onPageChange(Math.max(1, opts.page - 1)),
    onNext: () => opts.onPageChange(opts.page + 1),
    label: opts.total === 0 ? "0 of 0" : `${start}–${end} of ${opts.total}`,
  };
}

export function exportSearchParams(searchParams: URLSearchParams): string {
  const next = new URLSearchParams(searchParams);
  next.set("export", "1");
  return `?${next.toString()}`;
}

/** Merge list filters into the URL. Changing anything except page resets to page 1. */
export function patchListParams(
  current: URLSearchParams,
  patch: Record<string, string | null>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (!value) next.delete(key);
    else next.set(key, value);
  }
  const resetsPage = Object.keys(patch).some(
    (key) => key !== "export" && !key.endsWith("page"),
  );
  if (resetsPage && !Object.keys(patch).some((key) => key.endsWith("page"))) {
    for (const key of [...next.keys()]) {
      if (key === "page" || key.endsWith("page")) next.delete(key);
    }
  }
  next.delete("export");
  return next;
}
