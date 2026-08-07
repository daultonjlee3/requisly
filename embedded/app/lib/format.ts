export function money(
  amount: number | string | null | undefined,
  currency = "USD",
) {
  const n = parseMoneyNumber(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n ?? 0);
}

/** Parse "$1,234.50" / "12.5" into a finite number, else null. */
export function parseMoneyNumber(
  amount: number | string | null | undefined,
): number | null {
  if (typeof amount === "number") {
    return Number.isFinite(amount) ? amount : null;
  }
  if (amount == null) return null;
  const cleaned = String(amount).trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a cost for Polaris text inputs (empty when unknown). */
export function costInputValue(
  amount: number | string | null | undefined,
): string {
  const n = parseMoneyNumber(amount);
  if (n == null) return "";
  // Keep integers clean; preserve up to 4 decimal places for unit costs.
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

export function normalizeSku(sku: string | null | undefined): string | null {
  const s = sku?.trim().toLowerCase();
  return s ? s : null;
}

function parseDateOnly(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const dateOnly = parseDateOnly(value);
  if (dateOnly) {
    return dateOnly.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return shortDate(value);
}

export function gidToNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? gid;
}

export function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeShopDomain(raw: string): string | null {
  let shop = raw.trim().toLowerCase();
  shop = shop.replace(/^https?:\/\//, "");
  shop = shop.split("/")[0] ?? "";
  shop = shop.split("?")[0] ?? "";
  if (!shop) return null;
  if (!shop.includes(".")) {
    shop = `${shop}.myshopify.com`;
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return null;
  }
  return shop;
}
