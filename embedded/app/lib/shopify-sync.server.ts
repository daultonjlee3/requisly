import { createServiceClient } from "./supabase.server";
import { gidToNumericId } from "./format";

export type SyncCounts = {
  locations: number;
  variants: number;
  inventoryLevels: number;
};

type GraphqlAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Catalog sync via Admin GraphQL (locations → variants → inventory levels).
 * Replaces the REST Edge Function path for the embedded app.
 */
export async function syncShopifyCatalogGraphql(opts: {
  admin: GraphqlAdmin;
  workspaceId: string;
}): Promise<SyncCounts> {
  const { admin, workspaceId } = opts;
  const supabase = createServiceClient();

  const shopifyLocations = await fetchAllLocations(admin);

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
        shopify_location_id: loc.id,
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

  const variants = await fetchAllVariants(admin);
  const inventoryItemToVariantId = new Map<string, string>();
  let variantCount = 0;

  for (const variant of variants) {
    const { data: upserted, error } = await supabase
      .from("product_variants")
      .upsert(
        {
          workspace_id: workspaceId,
          shopify_product_id: variant.productId,
          shopify_variant_id: variant.variantId,
          shopify_inventory_item_id: variant.inventoryItemId,
          title: variant.title,
          sku: variant.sku,
          image_url: variant.imageUrl,
          retail_price: variant.retailPrice,
        },
        { onConflict: "workspace_id,shopify_variant_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    inventoryItemToVariantId.set(variant.inventoryItemId, upserted.id);
    variantCount += 1;
  }

  let inventoryCount = 0;
  const inventoryItemIds = [...inventoryItemToVariantId.keys()];

  for (let i = 0; i < inventoryItemIds.length; i += 50) {
    const chunk = inventoryItemIds.slice(i, i + 50);
    const levels = await fetchInventoryLevels(admin, chunk);

    for (const level of levels) {
      const variantId = inventoryItemToVariantId.get(level.inventoryItemId);
      const locationId = locationIdByShopify.get(level.locationId);
      if (!variantId || !locationId) continue;

      const { error } = await supabase.from("inventory_levels").upsert(
        {
          workspace_id: workspaceId,
          product_variant_id: variantId,
          location_id: locationId,
          on_hand: level.onHand,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "product_variant_id,location_id" },
      );
      if (error) throw new Error(error.message);
      inventoryCount += 1;
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

async function adminGraphql<T>(
  admin: GraphqlAdmin,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data");
  }
  return json.data;
}

type LocNode = { id: string; name: string; isActive: boolean };

type LocationsQuery = {
  locations: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: LocNode[];
  };
};

async function fetchAllLocations(admin: GraphqlAdmin) {
  const out: Array<{ id: string; name: string }> = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const data: LocationsQuery = await adminGraphql<LocationsQuery>(
      admin,
      `#graphql
        query RequislyLocations($cursor: String) {
          locations(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { id name isActive }
          }
        }`,
      { cursor },
    );

    for (const node of data.locations.nodes) {
      if (!node.isActive) continue;
      out.push({ id: gidToNumericId(node.id), name: node.name });
    }
    hasNext = data.locations.pageInfo.hasNextPage;
    cursor = data.locations.pageInfo.endCursor;
  }

  return out;
}

type VariantRow = {
  productId: string;
  variantId: string;
  inventoryItemId: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  retailPrice: number | null;
};

type ProductsQuery = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      title: string;
      featuredImage: { url: string } | null;
      variants: {
        nodes: Array<{
          id: string;
          title: string;
          sku: string | null;
          price: string;
          inventoryItem: { id: string } | null;
          image: { url: string } | null;
        }>;
      };
    }>;
  };
};

async function fetchAllVariants(admin: GraphqlAdmin) {
  const out: VariantRow[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const data: ProductsQuery = await adminGraphql<ProductsQuery>(
      admin,
      `#graphql
        query RequislyProducts($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              title
              featuredImage { url }
              variants(first: 100) {
                nodes {
                  id
                  title
                  sku
                  price
                  inventoryItem { id }
                  image { url }
                }
              }
            }
          }
        }`,
      { cursor },
    );

    for (const product of data.products.nodes) {
      const productId = gidToNumericId(product.id);
      const fallbackImage = product.featuredImage?.url ?? null;
      for (const variant of product.variants.nodes) {
        if (!variant.inventoryItem?.id) continue;
        const title =
          variant.title && variant.title !== "Default Title"
            ? `${product.title} — ${variant.title}`
            : product.title;
        const retail = Number(variant.price);
        out.push({
          productId,
          variantId: gidToNumericId(variant.id),
          inventoryItemId: gidToNumericId(variant.inventoryItem.id),
          title,
          sku: variant.sku || null,
          imageUrl: variant.image?.url ?? fallbackImage,
          retailPrice: Number.isFinite(retail) ? retail : null,
        });
      }
    }

    hasNext = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  return out;
}

async function fetchInventoryLevels(
  admin: GraphqlAdmin,
  inventoryItemNumericIds: string[],
) {
  const out: Array<{
    inventoryItemId: string;
    locationId: string;
    onHand: number;
  }> = [];

  // Query by GID list — Shopify accepts inventoryItems with ids filter via nodes.
  const gids = inventoryItemNumericIds.map(
    (id) => `gid://shopify/InventoryItem/${id}`,
  );

  const data = await adminGraphql<{
    nodes: Array<{
      id: string;
      inventoryLevels: {
        nodes: Array<{
          location: { id: string };
          quantities: Array<{ name: string; quantity: number }>;
        }>;
      };
    } | null>;
  }>(
    admin,
    `#graphql
      query RequislyInventoryLevels($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on InventoryItem {
            id
            inventoryLevels(first: 20) {
              nodes {
                location { id }
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }`,
    { ids: gids },
  );

  for (const node of data.nodes) {
    if (!node?.id) continue;
    const inventoryItemId = gidToNumericId(node.id);
    for (const level of node.inventoryLevels?.nodes ?? []) {
      const available =
        level.quantities.find((q) => q.name === "available")?.quantity ?? 0;
      out.push({
        inventoryItemId,
        locationId: gidToNumericId(level.location.id),
        onHand: available,
      });
    }
  }

  return out;
}

/** Sync if never synced, or last sync older than `maxAgeMs` (default 6h). */
export function shouldSyncCatalog(
  shopifySyncedAt: string | null | undefined,
  maxAgeMs = 6 * 60 * 60 * 1000,
): boolean {
  if (!shopifySyncedAt) return true;
  const age = Date.now() - new Date(shopifySyncedAt).getTime();
  return Number.isNaN(age) || age > maxAgeMs;
}
