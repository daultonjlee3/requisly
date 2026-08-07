import { createHmac, timingSafeEqual } from "node:crypto";

export const SHOPIFY_SCOPES = [
  "read_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
].join(",");

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

type OAuthStatePayload = {
  workspaceId: string;
  exp: number;
  nonce: string;
};

function hmacHex(secret: string, message: string) {
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function signOAuthState(
  workspaceId: string,
  secret: string,
  ttlMs = 15 * 60 * 1000,
): string {
  const payload: OAuthStatePayload = {
    workspaceId,
    exp: Date.now() + ttlMs,
    nonce: crypto.randomUUID(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = hmacHex(secret, body);
  return `${body}.${sig}`;
}

export function verifyOAuthState(
  state: string,
  secret: string,
): OAuthStatePayload | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = hmacHex(secret, body);
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as OAuthStatePayload;
    if (!payload.workspaceId || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function shopifyAuthorizeUrl(shop: string, state: string) {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!apiKey || !supabaseUrl) {
    throw new Error("SHOPIFY_API_KEY / NEXT_PUBLIC_SUPABASE_URL not configured");
  }
  const redirectUri = `${supabaseUrl}/functions/v1/shopify-oauth-callback`;
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}
