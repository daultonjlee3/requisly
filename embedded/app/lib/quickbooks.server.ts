import { createServiceClient } from "./supabase.server";
import {
  buildQboAuthorizeUrl,
  isInvalidGrant,
  parseQboFault,
  qboBillUrl,
  type QboMappingMode,
  type QboCatalogProduct,
  type QboNamedRef,
} from "./quickbooks-map";
import {
  signQboOauthState,
  verifyQboOauthState,
  type QboOauthStatePayload,
} from "./quickbooks-oauth.server";

const QBO_MINORVERSION = "75";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";

export class QboReconnectNeededError extends Error {
  constructor(message = "Reconnect QuickBooks in Settings — the connection expired or was revoked.") {
    super(message);
    this.name = "QboReconnectNeededError";
  }
}

export class QboApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QboApiError";
  }
}

export type QboEnvironment = "sandbox" | "production";

export type QboAppConfig = {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  env: QboEnvironment;
  appUrl: string;
  missing: string[];
};

export type QboConnection = {
  connected: boolean;
  reconnectNeeded: boolean;
  realmId: string | null;
  companyName: string | null;
  connectedAt: string | null;
  lastError: string | null;
  status: "connected" | "reconnect_needed" | "disconnected";
};

export type QboSettings = {
  mappingMode: QboMappingMode;
  defaultExpenseAccountId: string | null;
  defaultExpenseAccountName: string | null;
};

type CredentialRow = {
  workspace_id: string;
  access_token: string;
  refresh_token: string;
  realm_id: string;
  connected_at: string;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  company_name: string | null;
  status: "connected" | "reconnect_needed";
  last_error: string | null;
};

function appUrl(): string {
  return (
    process.env.QBO_REDIRECT_ORIGIN ||
    process.env.SHOPIFY_APP_URL ||
    process.env.EMBEDDED_APP_URL ||
    "https://app.requisly.com"
  ).replace(/\/$/, "");
}

export function getQboAppConfig(): QboAppConfig {
  const clientId = (process.env.QBO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.QBO_CLIENT_SECRET ?? "").trim();
  const envRaw = (process.env.QBO_ENV ?? process.env.QBO_ENVIRONMENT ?? "sandbox")
    .trim()
    .toLowerCase();
  const env: QboEnvironment = envRaw === "production" ? "production" : "sandbox";
  const origin = appUrl();
  const redirectUri = (
    process.env.QBO_REDIRECT_URI ?? `${origin}/quickbooks/callback`
  ).trim();
  const missing: string[] = [];
  if (!clientId) missing.push("QBO_CLIENT_ID");
  if (!clientSecret) missing.push("QBO_CLIENT_SECRET");
  return {
    configured: missing.length === 0,
    clientId,
    clientSecret,
    redirectUri,
    env,
    appUrl: origin,
    missing,
  };
}

export function qboAccountingBase(env: QboEnvironment, realmId: string): string {
  const host =
    env === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com";
  return `${host}/v3/company/${encodeURIComponent(realmId)}`;
}

export function shopifyAdminEmbeddedUrl(shopDomain: string, path: string): string {
  const shop = shopDomain.replace(/\.myshopify\.com$/i, "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `https://admin.shopify.com/store/${encodeURIComponent(shop)}/apps/${encodeURIComponent(apiKey)}${suffix}`;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

export function buildConnectAuthorizeUrl(opts: {
  workspaceId: string;
  shop: string;
}): string {
  const config = getQboAppConfig();
  if (!config.configured) {
    throw new Error(
      `QuickBooks is not configured on this app (missing ${config.missing.join(", ")}).`,
    );
  }
  const state = signQboOauthState(
    { workspaceId: opts.workspaceId, shop: opts.shop },
    config.clientSecret,
  );
  return buildQboAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
  });
}

export function readConnectState(state: string): QboOauthStatePayload {
  const config = getQboAppConfig();
  if (!config.configured) {
    throw new Error("QuickBooks is not configured on this app.");
  }
  return verifyQboOauthState(state, config.clientSecret);
}

async function tokenRequest(
  body: URLSearchParams,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
}> {
  const config = getQboAppConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(config.clientId, config.clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    if (isInvalidGrant(json, res.status)) {
      throw new QboReconnectNeededError();
    }
    throw new QboApiError(parseQboFault(json) || `Token request failed (${res.status})`);
  }
  const access = String(json?.access_token ?? "");
  const refresh = String(json?.refresh_token ?? "");
  if (!access || !refresh) {
    throw new QboApiError("QuickBooks token response was missing access or refresh token.");
  }
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: Number(json?.expires_in) || 3600,
    x_refresh_token_expires_in: Number(json?.x_refresh_token_expires_in) || undefined,
  };
}

export async function exchangeAuthorizationCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
}> {
  const config = getQboAppConfig();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  );
}

async function refreshAccessToken(refreshToken: string) {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

async function markReconnectNeeded(workspaceId: string, error: string) {
  const supabase = createServiceClient();
  await supabase
    .from("workspace_quickbooks_credentials")
    .update({
      status: "reconnect_needed",
      last_error: error.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
}

export async function saveQboConnection(opts: {
  workspaceId: string;
  realmId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn?: number;
  companyName?: string | null;
}): Promise<void> {
  const supabase = createServiceClient();
  const now = Date.now();
  const { error } = await supabase.from("workspace_quickbooks_credentials").upsert(
    {
      workspace_id: opts.workspaceId,
      access_token: opts.accessToken,
      refresh_token: opts.refreshToken,
      realm_id: opts.realmId,
      connected_at: new Date().toISOString(),
      access_token_expires_at: new Date(now + opts.expiresIn * 1000).toISOString(),
      refresh_token_expires_at: opts.refreshExpiresIn
        ? new Date(now + opts.refreshExpiresIn * 1000).toISOString()
        : null,
      company_name: opts.companyName ?? null,
      status: "connected",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw new Error(error.message);
}

export async function getQboConnection(workspaceId: string): Promise<QboConnection> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("workspace_quickbooks_credentials")
    .select(
      "realm_id, company_name, connected_at, status, last_error",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return {
      connected: false,
      reconnectNeeded: false,
      realmId: null,
      companyName: null,
      connectedAt: null,
      lastError: null,
      status: "disconnected",
    };
  }
  const reconnectNeeded = data.status === "reconnect_needed";
  return {
    connected: true,
    reconnectNeeded,
    realmId: data.realm_id,
    companyName: data.company_name,
    connectedAt: data.connected_at,
    lastError: data.last_error,
    status: reconnectNeeded ? "reconnect_needed" : "connected",
  };
}

export async function getQboSettings(workspaceId: string): Promise<QboSettings> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("workspace_quickbooks_settings")
    .select("mapping_mode, default_expense_account_id, default_expense_account_name")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    mappingMode: data?.mapping_mode === "item" ? "item" : "account",
    defaultExpenseAccountId: data?.default_expense_account_id ?? null,
    defaultExpenseAccountName: data?.default_expense_account_name ?? null,
  };
}

export async function saveQboSettings(
  workspaceId: string,
  patch: Partial<QboSettings> & { mappingMode?: QboMappingMode },
): Promise<QboSettings> {
  const current = await getQboSettings(workspaceId);
  const mappingMode = patch.mappingMode ?? current.mappingMode;
  if (mappingMode !== "account" && mappingMode !== "item") {
    throw new Error("Mapping mode must be account or item.");
  }
  const next: QboSettings = {
    mappingMode,
    defaultExpenseAccountId:
      patch.defaultExpenseAccountId === undefined
        ? current.defaultExpenseAccountId
        : patch.defaultExpenseAccountId,
    defaultExpenseAccountName:
      patch.defaultExpenseAccountName === undefined
        ? current.defaultExpenseAccountName
        : patch.defaultExpenseAccountName,
  };
  const supabase = createServiceClient();
  const { error } = await supabase.from("workspace_quickbooks_settings").upsert(
    {
      workspace_id: workspaceId,
      mapping_mode: next.mappingMode,
      default_expense_account_id: next.defaultExpenseAccountId,
      default_expense_account_name: next.defaultExpenseAccountName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw new Error(error.message);
  return next;
}

async function loadCredentials(workspaceId: string): Promise<CredentialRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("workspace_quickbooks_credentials")
    .select(
      "workspace_id, access_token, refresh_token, realm_id, connected_at, access_token_expires_at, refresh_token_expires_at, company_name, status, last_error",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new QboReconnectNeededError("Connect QuickBooks in Settings before pushing.");
  }
  if (data.status === "reconnect_needed") {
    throw new QboReconnectNeededError();
  }
  return data as CredentialRow;
}

async function persistTokens(
  workspaceId: string,
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in?: number;
  },
) {
  const supabase = createServiceClient();
  const now = Date.now();
  const { error } = await supabase
    .from("workspace_quickbooks_credentials")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
      refresh_token_expires_at: tokens.x_refresh_token_expires_in
        ? new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString()
        : undefined,
      status: "connected",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

async function ensureFreshAccessToken(row: CredentialRow): Promise<CredentialRow> {
  const expiresAt = row.access_token_expires_at
    ? Date.parse(row.access_token_expires_at)
    : 0;
  const refreshSoon = !expiresAt || expiresAt - Date.now() < 2 * 60 * 1000;
  if (!refreshSoon) return row;
  try {
    const tokens = await refreshAccessToken(row.refresh_token);
    await persistTokens(row.workspace_id, tokens);
    return {
      ...row,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      status: "connected",
      last_error: null,
    };
  } catch (err) {
    if (err instanceof QboReconnectNeededError) {
      await markReconnectNeeded(row.workspace_id, err.message);
    }
    throw err;
  }
}

type QboJson = Record<string, unknown>;

async function qboFetch(
  workspaceId: string,
  pathAndQuery: string,
  init?: { method?: string; body?: unknown },
): Promise<QboJson> {
  const config = getQboAppConfig();
  let row = await ensureFreshAccessToken(await loadCredentials(workspaceId));
  const url = `${qboAccountingBase(config.env, row.realm_id)}${pathAndQuery}${
    pathAndQuery.includes("?") ? "&" : "?"
  }minorversion=${QBO_MINORVERSION}`;

  const run = async (accessToken: string) =>
    fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: init?.body == null ? undefined : JSON.stringify(init.body),
    });

  let res = await run(row.access_token);
  let json = (await res.json().catch(() => null)) as QboJson | null;

  if (res.status === 401) {
    try {
      const tokens = await refreshAccessToken(row.refresh_token);
      await persistTokens(workspaceId, tokens);
      row = { ...row, access_token: tokens.access_token, refresh_token: tokens.refresh_token };
      res = await run(row.access_token);
      json = (await res.json().catch(() => null)) as QboJson | null;
    } catch (err) {
      if (err instanceof QboReconnectNeededError) {
        await markReconnectNeeded(workspaceId, err.message);
      }
      throw err;
    }
  }

  if (!res.ok) {
    const message = parseQboFault(json);
    if (isInvalidGrant(json, res.status)) {
      await markReconnectNeeded(workspaceId, message);
      throw new QboReconnectNeededError(message);
    }
    throw new QboApiError(message);
  }
  return json ?? {};
}

function queryPath(sql: string): string {
  return `/query?query=${encodeURIComponent(sql)}`;
}

export async function qboQuery<T>(
  workspaceId: string,
  sql: string,
  entity: string,
): Promise<T[]> {
  const json = await qboFetch(workspaceId, queryPath(sql));
  const queryResponse = json.QueryResponse as Record<string, unknown> | undefined;
  const rows = queryResponse?.[entity];
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function fetchQboCompanyName(
  workspaceId: string,
  realmId: string,
): Promise<string | null> {
  try {
    const json = await qboFetch(workspaceId, `/companyinfo/${encodeURIComponent(realmId)}`);
    const info = json.CompanyInfo as { CompanyName?: string } | undefined;
    return info?.CompanyName ?? null;
  } catch {
    return null;
  }
}

export async function listQboVendors(workspaceId: string): Promise<QboNamedRef[]> {
  const rows = await qboQuery<{ Id?: string; DisplayName?: string }>(
    workspaceId,
    "select Id, DisplayName from Vendor where Active = true MAXRESULTS 1000",
    "Vendor",
  );
  return rows
    .map((row) => ({ id: String(row.Id ?? ""), name: String(row.DisplayName ?? "") }))
    .filter((row) => row.id && row.name);
}

export async function listQboItems(workspaceId: string): Promise<QboNamedRef[]> {
  const rows = await qboQuery<{ Id?: string; Name?: string; FullyQualifiedName?: string }>(
    workspaceId,
    "select Id, Name, FullyQualifiedName from Item where Active = true MAXRESULTS 1000",
    "Item",
  );
  return rows
    .map((row) => ({
      id: String(row.Id ?? ""),
      name: String(row.FullyQualifiedName || row.Name || ""),
    }))
    .filter((row) => row.id && row.name);
}

const EXPENSE_ACCOUNT_TYPES = new Set([
  "Expense",
  "Cost of Goods Sold",
  "Other Expense",
]);

export async function listQboExpenseAccounts(workspaceId: string): Promise<QboNamedRef[]> {
  const rows = await qboQuery<{
    Id?: string;
    Name?: string;
    FullyQualifiedName?: string;
    AccountType?: string;
  }>(
    workspaceId,
    "select Id, Name, FullyQualifiedName, AccountType from Account where Active = true MAXRESULTS 1000",
    "Account",
  );
  return rows
    .filter((row) => EXPENSE_ACCOUNT_TYPES.has(String(row.AccountType ?? "")))
    .map((row) => ({
      id: String(row.Id ?? ""),
      name: String(row.FullyQualifiedName || row.Name || ""),
    }))
    .filter((row) => row.id && row.name);
}

export async function createQboVendor(
  workspaceId: string,
  displayName: string,
): Promise<QboNamedRef> {
  const json = await qboFetch(workspaceId, "/vendor", {
    method: "POST",
    body: { DisplayName: displayName.trim().slice(0, 500) },
  });
  const vendor = json.Vendor as { Id?: string; DisplayName?: string } | undefined;
  const id = String(vendor?.Id ?? "");
  const name = String(vendor?.DisplayName ?? displayName);
  if (!id) throw new QboApiError("QuickBooks did not return a vendor id.");
  return { id, name };
}

export async function createQboItem(
  workspaceId: string,
  opts: { name: string; expenseAccountId: string },
): Promise<QboNamedRef> {
  const name = opts.name.trim().slice(0, 100);
  const body = {
    Name: name,
    Type: "NonInventory",
    ExpenseAccountRef: { value: opts.expenseAccountId },
  };
  try {
    const json = await qboFetch(workspaceId, "/item", { method: "POST", body });
    const item = json.Item as { Id?: string; Name?: string } | undefined;
    const id = String(item?.Id ?? "");
    if (!id) throw new QboApiError("QuickBooks did not return an item id.");
    return { id, name: String(item?.Name ?? name) };
  } catch (err) {
    if (!(err instanceof QboApiError)) throw err;
    const fallback = await qboFetch(workspaceId, "/item", {
      method: "POST",
      body: {
        Name: name,
        Type: "Service",
        ExpenseAccountRef: { value: opts.expenseAccountId },
      },
    });
    const item = fallback.Item as { Id?: string; Name?: string } | undefined;
    const id = String(item?.Id ?? "");
    if (!id) throw err;
    return { id, name: String(item?.Name ?? name) };
  }
}

export async function getQboBill(
  workspaceId: string,
  billId: string,
): Promise<Record<string, unknown>> {
  const json = await qboFetch(
    workspaceId,
    `/bill/${encodeURIComponent(billId)}`,
  );
  const bill = json.Bill as Record<string, unknown> | undefined;
  if (!bill?.Id) throw new QboApiError(`QuickBooks Bill ${billId} was not found.`);
  return bill;
}

export async function createQboBill(
  workspaceId: string,
  bill: Record<string, unknown>,
): Promise<{ id: string; docNumber: string | null }> {
  const json = await qboFetch(workspaceId, "/bill", { method: "POST", body: bill });
  const created = json.Bill as { Id?: string; DocNumber?: string } | undefined;
  const id = String(created?.Id ?? "");
  if (!id) throw new QboApiError("QuickBooks did not return a bill id.");
  return { id, docNumber: created?.DocNumber ? String(created.DocNumber) : null };
}

export function billDeepLink(billId: string): string {
  return qboBillUrl({ env: getQboAppConfig().env, billId });
}

export async function disconnectQbo(workspaceId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("workspace_quickbooks_credentials")
    .select("refresh_token, access_token")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const config = getQboAppConfig();
  const token = data?.refresh_token || data?.access_token;
  if (token && config.configured) {
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth(config.clientId, config.clientSecret)}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ token }),
      });
    } catch {
      // Revoke is best-effort; still drop local credentials.
    }
  }
  const { error } = await supabase
    .from("workspace_quickbooks_credentials")
    .delete()
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function findWorkspaceByRealmId(realmId: string): Promise<{
  workspaceId: string;
  shopDomain: string | null;
} | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("workspace_quickbooks_credentials")
    .select("workspace_id")
    .eq("realm_id", realmId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, shopify_domain")
    .eq("id", data.workspace_id)
    .maybeSingle();
  return {
    workspaceId: data.workspace_id,
    shopDomain: workspace?.shopify_domain ?? null,
  };
}

export async function getSupplierVendorMapping(
  workspaceId: string,
  supplierId: string,
): Promise<QboNamedRef | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("supplier_quickbooks_vendors")
    .select("qbo_vendor_id, qbo_vendor_name")
    .eq("workspace_id", workspaceId)
    .eq("supplier_id", supplierId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.qbo_vendor_id, name: data.qbo_vendor_name };
}

export async function saveSupplierVendorMapping(opts: {
  workspaceId: string;
  supplierId: string;
  vendor: QboNamedRef;
}): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("supplier_quickbooks_vendors").upsert(
    {
      workspace_id: opts.workspaceId,
      supplier_id: opts.supplierId,
      qbo_vendor_id: opts.vendor.id,
      qbo_vendor_name: opts.vendor.name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,supplier_id" },
  );
  if (error) throw new Error(error.message);
}

export async function getProductItemMappings(
  workspaceId: string,
  supplierProductIds: string[],
): Promise<Map<string, QboNamedRef>> {
  const map = new Map<string, QboNamedRef>();
  const ids = supplierProductIds.filter(Boolean);
  if (!ids.length) return map;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("product_quickbooks_items")
    .select("supplier_product_id, qbo_item_id, qbo_item_name")
    .eq("workspace_id", workspaceId)
    .in("supplier_product_id", ids);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    map.set(row.supplier_product_id, {
      id: row.qbo_item_id,
      name: row.qbo_item_name,
    });
  }
  return map;
}

export async function loadQboProductMappings(workspaceId: string): Promise<{
  products: QboCatalogProduct[];
  items: QboNamedRef[];
  truncated: boolean;
}> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("supplier_products")
    .select("id, title, sku, suppliers(name)")
    .eq("workspace_id", workspaceId)
    .order("title")
    .limit(500);
  if (error) throw new Error(error.message);
  const truncated = (data ?? []).length >= 500;
  const productsRaw = (data ?? []).map((row) => {
    const supplier = row.suppliers as unknown as { name: string } | { name: string }[] | null;
    const supplierName = Array.isArray(supplier)
      ? supplier[0]?.name ?? "—"
      : supplier?.name ?? "—";
    return {
      id: row.id as string,
      title: (row.title as string) || "Untitled",
      sku: (row.sku as string) || "",
      supplierName,
    };
  });
  const [items, mappings] = await Promise.all([
    listQboItems(workspaceId),
    getProductItemMappings(
      workspaceId,
      productsRaw.map((row) => row.id),
    ),
  ]);
  return {
    items,
    truncated,
    products: productsRaw.map((row) => ({
      ...row,
      mapped: mappings.get(row.id) ?? null,
    })),
  };
}

export async function saveProductItemMappings(
  workspaceId: string,
  mappings: Array<{ supplierProductId: string; qboId: string; qboName: string }>,
): Promise<void> {
  const supabase = createServiceClient();
  const keep = mappings.filter((row) => row.supplierProductId && row.qboId);
  const clear = mappings.filter((row) => row.supplierProductId && !row.qboId);
  if (clear.length) {
    const { error } = await supabase
      .from("product_quickbooks_items")
      .delete()
      .eq("workspace_id", workspaceId)
      .in(
        "supplier_product_id",
        clear.map((row) => row.supplierProductId),
      );
    if (error) throw new Error(error.message);
  }
  if (!keep.length) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from("product_quickbooks_items").upsert(
    keep.map((row) => ({
      workspace_id: workspaceId,
      supplier_product_id: row.supplierProductId,
      qbo_item_id: row.qboId,
      qbo_item_name: row.qboName,
      updated_at: now,
    })),
    { onConflict: "workspace_id,supplier_product_id" },
  );
  if (error) throw new Error(error.message);
}

export async function saveProductItemMapping(opts: {
  workspaceId: string;
  supplierProductId: string;
  item: QboNamedRef;
}): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("product_quickbooks_items").upsert(
    {
      workspace_id: opts.workspaceId,
      supplier_product_id: opts.supplierProductId,
      qbo_item_id: opts.item.id,
      qbo_item_name: opts.item.name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,supplier_product_id" },
  );
  if (error) throw new Error(error.message);
}

export { AUTHORIZE_URL };
