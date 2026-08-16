import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { money } from "./format";

export type QboMappingMode = "account" | "item";

export type QboNamedRef = {
  id: string;
  name: string;
};

export type QboVendorMatch = {
  exact: QboNamedRef | null;
  suggestions: Array<QboNamedRef & { score: number }>;
};

export type BillLineMapping =
  | { type: "item"; itemId: string; itemName: string }
  | { type: "account"; accountId: string; accountName: string };

export type BillLineInput = {
  description: string;
  qty: number;
  unitCost: number;
  amount: number;
  mapping: BillLineMapping;
};

export type BillExtraLine = {
  description: string;
  amount: number;
  accountId: string;
  accountName: string;
};

const LEGAL_SUFFIX =
  /\b(inc|incorporated|llc|ltd|limited|co|corp|corporation|company|lp|plc)\b/g;

export function normalizeVendorName(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? b.length;
}

export function vendorSimilarity(supplierName: string, vendorName: string): number {
  const a = normalizeVendorName(supplierName);
  const b = normalizeVendorName(vendorName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return shorter / longer;
  }
  const dist = levenshtein(a, b);
  const longer = Math.max(a.length, b.length);
  return Math.max(0, 1 - dist / longer);
}

export function matchQboVendor(
  supplierName: string,
  vendors: QboNamedRef[],
): QboVendorMatch {
  const exactNeedle = supplierName.trim().toLowerCase();
  const normalizedNeedle = normalizeVendorName(supplierName);
  let exact: QboNamedRef | null = null;
  const scored: Array<QboNamedRef & { score: number }> = [];

  for (const vendor of vendors) {
    const display = vendor.name.trim();
    if (!display) continue;
    if (
      display.toLowerCase() === exactNeedle ||
      normalizeVendorName(display) === normalizedNeedle
    ) {
      exact = vendor;
    }
    const score = vendorSimilarity(supplierName, display);
    if (score >= 0.55) {
      scored.push({ ...vendor, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const suggestions = scored
    .filter((row, index, all) => all.findIndex((x) => x.id === row.id) === index)
    .slice(0, 8);

  return { exact, suggestions };
}

export function suggestedLineMappingType(opts: {
  isFreeText: boolean;
  mappingMode: QboMappingMode;
}): QboMappingMode {
  if (opts.isFreeText) return "account";
  return opts.mappingMode;
}

export function roundMoney(n: number): number {
  return Number((Number(n) || 0).toFixed(2));
}

export function clipQboDocNumber(poNumber: string): string {
  const trimmed = poNumber.trim() || "PO";
  return trimmed.length <= 21 ? trimmed : trimmed.slice(0, 21);
}

export function qboBillUrl(opts: {
  env: "sandbox" | "production";
  billId: string;
}): string {
  const host =
    opts.env === "production"
      ? "https://app.qbo.intuit.com"
      : "https://app.sandbox.qbo.intuit.com";
  return `${host}/app/bill?txnId=${encodeURIComponent(opts.billId)}`;
}

export function parseQboFault(body: unknown): string {
  if (!body || typeof body !== "object") return "QuickBooks returned an unknown error.";
  const record = body as Record<string, unknown>;
  const fault = record.Fault as
    | { Error?: Array<{ Message?: string; Detail?: string; code?: string }> }
    | undefined;
  const first = fault?.Error?.[0];
  if (first?.Message && first?.Detail) {
    return `${first.Message}: ${first.Detail}`;
  }
  if (first?.Message) return first.Message;
  if (typeof record.error === "string") return record.error;
  if (typeof record.error_description === "string") {
    return record.error_description;
  }
  return "QuickBooks returned an unknown error.";
}

export function isInvalidGrant(body: unknown, status?: number): boolean {
  if (status === 401) return true;
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  if (record.error === "invalid_grant") return true;
  const text = parseQboFault(body).toLowerCase();
  return (
    text.includes("invalid_grant") ||
    text.includes("token revoked") ||
    text.includes("refresh token") && text.includes("expired")
  );
}

export type QboOauthStatePayload = {
  workspaceId: string;
  shop: string;
  nonce: string;
  ts: number;
};

export function signQboOauthState(
  payload: Omit<QboOauthStatePayload, "nonce" | "ts"> & {
    nonce?: string;
    ts?: number;
  },
  secret: string,
): string {
  const full: QboOauthStatePayload = {
    workspaceId: payload.workspaceId,
    shop: payload.shop,
    nonce: payload.nonce ?? randomBytes(16).toString("hex"),
    ts: payload.ts ?? Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyQboOauthState(
  state: string,
  secret: string,
  opts?: { maxAgeMs?: number; now?: number },
): QboOauthStatePayload {
  const maxAgeMs = opts?.maxAgeMs ?? 15 * 60 * 1000;
  const now = opts?.now ?? Date.now();
  const dot = state.lastIndexOf(".");
  if (dot <= 0) throw new Error("QuickBooks sign-in state is invalid.");
  const encoded = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new Error("QuickBooks sign-in state is invalid.");
  }
  let payload: QboOauthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as QboOauthStatePayload;
  } catch {
    throw new Error("QuickBooks sign-in state is invalid.");
  }
  if (!payload.workspaceId || !payload.shop || !payload.nonce || !payload.ts) {
    throw new Error("QuickBooks sign-in state is invalid.");
  }
  if (Math.abs(now - payload.ts) > maxAgeMs) {
    throw new Error("QuickBooks sign-in expired. Start Connect again from Settings.");
  }
  return payload;
}

export function buildQboAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
}

export function buildBillPayload(opts: {
  vendorId: string;
  docNumber: string;
  txnDate: string;
  privateNote: string;
  lines: BillLineInput[];
  extras: BillExtraLine[];
}): {
  bill: Record<string, unknown>;
  previewTotal: number;
  previewLines: Array<{
    description: string;
    mappingLabel: string;
    mappingType: "item" | "account";
    qty: number | null;
    unitCost: number | null;
    amount: number;
  }>;
} {
  const qboLines: Array<Record<string, unknown>> = [];
  const previewLines: Array<{
    description: string;
    mappingLabel: string;
    mappingType: "item" | "account";
    qty: number | null;
    unitCost: number | null;
    amount: number;
  }> = [];
  let total = 0;
  let lineNum = 1;

  for (const line of opts.lines) {
    const amount = roundMoney(line.amount);
    total = roundMoney(total + amount);
    if (line.mapping.type === "item") {
      qboLines.push({
        Id: String(lineNum),
        DetailType: "ItemBasedExpenseLineDetail",
        Amount: amount,
        Description: line.description,
        ItemBasedExpenseLineDetail: {
          ItemRef: { value: line.mapping.itemId, name: line.mapping.itemName },
          Qty: line.qty,
          UnitPrice: roundMoney(line.unitCost),
        },
      });
      previewLines.push({
        description: line.description,
        mappingLabel: `Item · ${line.mapping.itemName}`,
        mappingType: "item",
        qty: line.qty,
        unitCost: roundMoney(line.unitCost),
        amount,
      });
    } else {
      qboLines.push({
        Id: String(lineNum),
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: amount,
        Description: line.description,
        AccountBasedExpenseLineDetail: {
          AccountRef: {
            value: line.mapping.accountId,
            name: line.mapping.accountName,
          },
        },
      });
      previewLines.push({
        description: line.description,
        mappingLabel: `Account · ${line.mapping.accountName}`,
        mappingType: "account",
        qty: line.qty,
        unitCost: roundMoney(line.unitCost),
        amount,
      });
    }
    lineNum += 1;
  }

  for (const extra of opts.extras) {
    const amount = roundMoney(extra.amount);
    if (Math.abs(amount) < 0.005) continue;
    total = roundMoney(total + amount);
    qboLines.push({
      Id: String(lineNum),
      DetailType: "AccountBasedExpenseLineDetail",
      Amount: amount,
      Description: extra.description,
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: extra.accountId, name: extra.accountName },
      },
    });
    previewLines.push({
      description: extra.description,
      mappingLabel: `Account · ${extra.accountName}`,
      mappingType: "account",
      qty: null,
      unitCost: null,
      amount,
    });
    lineNum += 1;
  }

  return {
    bill: {
      VendorRef: { value: opts.vendorId },
      DocNumber: clipQboDocNumber(opts.docNumber),
      TxnDate: opts.txnDate,
      PrivateNote: opts.privateNote.slice(0, 4000),
      Line: qboLines,
    },
    previewTotal: total,
    previewLines,
  };
}

export function varianceExtra(opts: {
  invoiceAmount: number;
  lineTotal: number;
  accountId: string;
  accountName: string;
}): BillExtraLine | null {
  const amount = roundMoney(opts.invoiceAmount - opts.lineTotal);
  if (Math.abs(amount) < 0.005) return null;
  return {
    description:
      amount > 0
        ? `Invoice variance (${money(amount)})`
        : `Invoice variance (${money(amount)})`,
    amount,
    accountId: opts.accountId,
    accountName: opts.accountName,
  };
}

export function qboItemCreateName(description: string, sku?: string | null): string {
  const base = description.trim() || sku?.trim() || "Item";
  return base.slice(0, 100);
}
