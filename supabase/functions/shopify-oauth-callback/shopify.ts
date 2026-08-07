export const SHOPIFY_API_VERSION = "2025-01";

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

export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function timingSafeEqualHex(
  a: string,
  b: string,
): Promise<boolean> {
  if (a.length !== b.length) return false;
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i]! ^ bb[i]!;
  return out === 0;
}

/** Verify Shopify OAuth callback hmac query param. */
export async function verifyShopifyOAuthHmac(
  searchParams: URLSearchParams,
  secret: string,
): Promise<boolean> {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;
  const entries: string[] = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === "hmac" || key === "signature") continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const message = entries.join("&");
  const digest = await hmacSha256Hex(secret, message);
  return timingSafeEqualHex(digest, hmac);
}

export type OAuthStatePayload = {
  workspaceId: string;
  exp: number;
  nonce: string;
};

export async function signOAuthState(
  payload: OAuthStatePayload,
  secret: string,
): Promise<string> {
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = await hmacSha256Hex(secret, body);
  return `${body}.${sig}`;
}

export async function verifyOAuthState(
  state: string,
  secret: string,
): Promise<OAuthStatePayload | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = await hmacSha256Hex(secret, body);
  if (!(await timingSafeEqualHex(expected, sig))) return null;
  try {
    const padded = body.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const payload = JSON.parse(json) as OAuthStatePayload;
    if (!payload.workspaceId || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function shopifyFetch(
  shop: string,
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http")
    ? path
    : `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export type SyncCounts = {
  locations: number;
  variants: number;
  inventoryLevels: number;
};

type ShopifyLocation = {
  id: number;
  name: string;
  active: boolean;
  legacy: boolean;
};

type ShopifyProduct = {
  id: number;
  title: string;
  image: { src: string } | null;
  images: Array<{ id: number; src: string }>;
  variants: Array<{
    id: number;
    title: string;
    sku: string | null;
    price: string;
    inventory_item_id: number;
    image_id: number | null;
  }>;
};

type ShopifyInventoryLevel = {
  inventory_item_id: number;
  location_id: number;
  available: number | null;
};

export async function syncShopifyCatalog(opts: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  workspaceId: string;
  shop: string;
  accessToken: string;
}): Promise<SyncCounts> {
  const { supabase, workspaceId, shop, accessToken } = opts;

  // --- Locations ---
  const locRes = await shopifyFetch(shop, accessToken, "/locations.json");
  if (!locRes.ok) {
    throw new Error(`Shopify locations failed: ${locRes.status}`);
  }
  const locJson = (await locRes.json()) as { locations: ShopifyLocation[] };
  const shopifyLocations = (locJson.locations ?? []).filter((l) => l.active);

  // Clear primary on local-only placeholders before upserting.
  await supabase
    .from("locations")
    .update({ is_primary: false })
    .eq("workspace_id", workspaceId);

  let primarySet = false;
  for (const loc of shopifyLocations) {
    const isPrimary = !primarySet;
    if (isPrimary) primarySet = true;
    const { error } = await supabase.from("locations").upsert(
      {
        workspace_id: workspaceId,
        shopify_location_id: String(loc.id),
        name: loc.name,
        is_primary: isPrimary,
      },
      { onConflict: "workspace_id,shopify_location_id" },
    );
    if (error) throw new Error(error.message);
  }

  const { data: locationRows, error: locReadErr } = await supabase
    .from("locations")
    .select("id, shopify_location_id")
    .eq("workspace_id", workspaceId)
    .not("shopify_location_id", "is", null);
  if (locReadErr) throw new Error(locReadErr.message);

  const locationIdByShopify = new Map<string, string>();
  for (const row of locationRows ?? []) {
    if (row.shopify_location_id) {
      locationIdByShopify.set(row.shopify_location_id, row.id);
    }
  }

  // --- Products / variants (paginated) ---
  let nextUrl: string | null =
    `/products.json?limit=250&fields=id,title,image,images,variants`;
  const inventoryItemToVariantId = new Map<string, string>();
  let variantCount = 0;

  while (nextUrl) {
    const res = await shopifyFetch(shop, accessToken, nextUrl);
    if (!res.ok) {
      throw new Error(`Shopify products failed: ${res.status}`);
    }
    const json = (await res.json()) as { products: ShopifyProduct[] };
    const products = json.products ?? [];

    for (const product of products) {
      const imageById = new Map(
        (product.images ?? []).map((img) => [img.id, img.src] as const),
      );
      const fallbackImage = product.image?.src ?? null;

      for (const variant of product.variants ?? []) {
        const title =
          variant.title && variant.title !== "Default Title"
            ? `${product.title} — ${variant.title}`
            : product.title;
        const imageUrl =
          (variant.image_id != null
            ? imageById.get(variant.image_id) ?? null
            : null) ?? fallbackImage;
        const retail = Number(variant.price);
        const retailPrice = Number.isFinite(retail) ? retail : null;

        const { data: upserted, error } = await supabase
          .from("product_variants")
          .upsert(
            {
              workspace_id: workspaceId,
              shopify_product_id: String(product.id),
              shopify_variant_id: String(variant.id),
              shopify_inventory_item_id: String(variant.inventory_item_id),
              title,
              sku: variant.sku || null,
              image_url: imageUrl,
              retail_price: retailPrice,
            },
            { onConflict: "workspace_id,shopify_variant_id" },
          )
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        inventoryItemToVariantId.set(
          String(variant.inventory_item_id),
          upserted.id,
        );
        variantCount += 1;
      }
    }

    const link = res.headers.get("link");
    nextUrl = parseNextLink(link);
  }

  // --- Inventory levels ---
  const inventoryItemIds = [...inventoryItemToVariantId.keys()];
  const locationShopifyIds = [...locationIdByShopify.keys()];
  let inventoryCount = 0;

  for (let i = 0; i < inventoryItemIds.length; i += 50) {
    const chunk = inventoryItemIds.slice(i, i + 50);
    // Shopify allows filtering by location_ids and inventory_item_ids
    for (let j = 0; j < locationShopifyIds.length; j += 1) {
      // One location at a time keeps URLs short and responses predictable.
      const locShopifyId = locationShopifyIds[j]!;
      const qs = new URLSearchParams({
        location_ids: locShopifyId,
        inventory_item_ids: chunk.join(","),
      });
      const invRes = await shopifyFetch(
        shop,
        accessToken,
        `/inventory_levels.json?${qs.toString()}`,
      );
      if (!invRes.ok) {
        throw new Error(`Shopify inventory_levels failed: ${invRes.status}`);
      }
      const invJson = (await invRes.json()) as {
        inventory_levels: ShopifyInventoryLevel[];
      };

      for (const level of invJson.inventory_levels ?? []) {
        const variantId = inventoryItemToVariantId.get(
          String(level.inventory_item_id),
        );
        const locationId = locationIdByShopify.get(String(level.location_id));
        if (!variantId || !locationId) continue;
        const onHand = level.available ?? 0;
        const { error } = await supabase.from("inventory_levels").upsert(
          {
            workspace_id: workspaceId,
            product_variant_id: variantId,
            location_id: locationId,
            on_hand: onHand,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "product_variant_id,location_id" },
        );
        if (error) throw new Error(error.message);
        inventoryCount += 1;
      }
    }
  }

  const { error: stampErr } = await supabase
    .from("workspaces")
    .update({ shopify_synced_at: new Date().toISOString() })
    .eq("id", workspaceId);
  if (stampErr) throw new Error(stampErr.message);

  return {
    locations: shopifyLocations.length,
    variants: variantCount,
    inventoryLevels: inventoryCount,
  };
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // <https://...>; rel="next"
  const parts = linkHeader.split(",");
  for (const part of parts) {
    if (!part.includes('rel="next"')) continue;
    const match = part.match(/<([^>]+)>/);
    if (match?.[1]) return match[1];
  }
  return null;
}
