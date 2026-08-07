import Link from "next/link";
import { OnHandCell, type OnHandByLocation } from "@/components/OnHandCell";
import { ProductThumb } from "@/components/ProductThumb";
import { ResyncShopifyButton } from "@/components/ResyncShopifyButton";
import { ScheduledPriceNote } from "@/components/ScheduledPriceNote";
import { Topbar } from "@/components/shell/Topbar";
import { money, relativeTime } from "@/lib/format";
import {
  currentPriceLabel,
  marginLabel,
  type SupplierProductPricing,
} from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

type VariantRow = {
  id: string;
  title: string;
  sku: string | null;
  shopify_variant_id: string;
  shopify_product_id: string;
  image_url: string | null;
  retail_price: number | string | null;
  created_at: string;
};

type CatalogRow = {
  id: string;
  title: string;
  sku: string | null;
  case_qty: number | null;
  moq: number | null;
  product_variant_id: string | null;
  suppliers: { id: string; name: string } | null;
};

type CatalogGroup = {
  key: string;
  title: string;
  imageUrl: string | null;
  retailPrice: number | null;
  rows: CatalogRow[];
};

function groupCatalog(
  catalog: CatalogRow[],
  variantsById: Map<string, VariantRow>,
): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>();

  for (const row of catalog) {
    const variant = row.product_variant_id
      ? variantsById.get(row.product_variant_id)
      : undefined;
    const key = row.product_variant_id
      ? `v:${row.product_variant_id}`
      : `ft:${row.id}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: variant?.title ?? row.title,
        imageUrl: variant?.image_url ?? null,
        retailPrice:
          variant?.retail_price == null ? null : Number(variant.retail_price),
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  return [...groups.values()].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ shopify?: string; sync?: string; message?: string }>;
}) {
  const { shopify, sync, message } = await searchParams;
  const { workspace } = await getSessionContext();
  const supabase = await createClient();
  const workspaceId = workspace!.id;

  const [
    { data: workspaceRow },
    { data: variants },
    { data: catalog },
    { data: pricingRows },
    { data: locations },
    { data: inventoryRows },
  ] = await Promise.all([
    supabase
      .from("workspaces")
      .select("id, name, shopify_domain, shopify_synced_at")
      .eq("id", workspaceId)
      .maybeSingle(),
    supabase
      .from("product_variants")
      .select(
        "id, title, sku, shopify_variant_id, shopify_product_id, image_url, retail_price, created_at",
      )
      .eq("workspace_id", workspaceId)
      .order("title"),
    supabase
      .from("supplier_products")
      .select(
        "id, title, sku, case_qty, moq, product_variant_id, suppliers(id, name)",
      )
      .eq("workspace_id", workspaceId)
      .order("title"),
    supabase
      .from("supplier_product_pricing")
      .select(
        "supplier_product_id, current_unit_cost, next_unit_cost, next_effective_date",
      )
      .eq("workspace_id", workspaceId),
    supabase
      .from("locations")
      .select("id, name, is_primary")
      .eq("workspace_id", workspaceId)
      .order("name"),
    supabase
      .from("inventory_levels")
      .select("product_variant_id, location_id, on_hand")
      .eq("workspace_id", workspaceId),
  ]);

  const pricingByProduct = new Map<string, SupplierProductPricing>();
  for (const row of pricingRows ?? []) {
    pricingByProduct.set(row.supplier_product_id, {
      supplier_product_id: row.supplier_product_id,
      current_unit_cost:
        row.current_unit_cost == null ? null : Number(row.current_unit_cost),
      next_unit_cost:
        row.next_unit_cost == null ? null : Number(row.next_unit_cost),
      next_effective_date: row.next_effective_date,
    });
  }

  const shopConnected = Boolean(workspaceRow?.shopify_domain);
  const variantCount = variants?.length ?? 0;
  const catalogCount = catalog?.length ?? 0;

  const variantsById = new Map<string, VariantRow>();
  for (const v of (variants ?? []) as VariantRow[]) {
    variantsById.set(v.id, v);
  }

  const locationName = new Map(
    (locations ?? []).map((l) => [l.id, l.name] as const),
  );

  const levelsByVariant = new Map<string, OnHandByLocation[]>();
  for (const row of inventoryRows ?? []) {
    const list = levelsByVariant.get(row.product_variant_id) ?? [];
    list.push({
      locationId: row.location_id,
      locationName: locationName.get(row.location_id) ?? "Location",
      onHand: row.on_hand,
    });
    levelsByVariant.set(row.product_variant_id, list);
  }
  for (const [, list] of levelsByVariant) {
    list.sort((a, b) => a.locationName.localeCompare(b.locationName));
  }

  const catalogRows: CatalogRow[] = (catalog ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    sku: row.sku,
    case_qty: row.case_qty,
    moq: row.moq,
    product_variant_id: row.product_variant_id,
    suppliers: row.suppliers as unknown as { id: string; name: string } | null,
  }));

  const catalogGroups = groupCatalog(catalogRows, variantsById);

  return (
    <>
      <Topbar
        title="Products"
        subline="On-hand inventory + per-supplier pricing"
        actions={
          <>
            {shopConnected ? <ResyncShopifyButton /> : null}
            <Link href="/products/new" className="btn btn-primary">
              Add supplier product
            </Link>
          </>
        }
      />
      <div className="content stack" style={{ gap: 24 }}>
        {shopify === "connected" ? (
          <div className="demo-banner">
            <strong>
              {sync === "ok"
                ? "Shopify connected — catalog synced"
                : "Shopify connected"}
            </strong>
            <span>
              {sync === "error"
                ? message ||
                  "Token saved, but the first sync hit an error. Use Resync Shopify."
                : `Store linked to ${workspaceRow?.shopify_domain ?? "this workspace"}.`}
            </span>
          </div>
        ) : null}

        {!shopConnected ? (
          <div className="demo-banner">
            <strong>Shopify not connected</strong>
            <span>
              On-hand quantities come from synced Shopify inventory. Until a
              store is connected, we show “Not connected” — not a fake zero.
            </span>
            <Link href="/onboarding" className="btn btn-primary btn-sm">
              Connect Shopify
            </Link>
          </div>
        ) : (
          <div className="between">
            <p className="small muted" style={{ margin: 0 }}>
              Connected as{" "}
              <span className="mono">{workspaceRow?.shopify_domain}</span>
              {workspaceRow?.shopify_synced_at
                ? ` · last sync ${relativeTime(workspaceRow.shopify_synced_at)}`
                : ""}
            </p>
            <Link href="/onboarding" className="small">
              Connection details
            </Link>
          </div>
        )}

        <section className="stack" style={{ gap: 12 }}>
          <div className="between">
            <div>
              <h2 className="section-title">Shopify variants</h2>
              <p className="small muted" style={{ margin: 0 }}>
                Synced catalog with on-hand per location.
              </p>
            </div>
            <span className="mono small muted">{variantCount}</span>
          </div>

          <div className="card">
            {variantCount === 0 ? (
              <div className="card-body empty-state">
                <p style={{ margin: "0 0 8px", color: "var(--ink)" }}>
                  {shopConnected
                    ? "No product variants synced yet."
                    : "Shopify isn’t connected yet."}
                </p>
                <p className="small muted" style={{ margin: "0 0 16px" }}>
                  {shopConnected
                    ? "Use Resync Shopify above, or reconnect from onboarding."
                    : "Connect a Shopify store to pull variants and on-hand inventory. Until then, build your supplier catalog below — free-text products work without Shopify."}
                </p>
                {!shopConnected ? (
                  <Link href="/onboarding" className="btn btn-primary">
                    Connect Shopify →
                  </Link>
                ) : (
                  <ResyncShopifyButton />
                )}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>SKU</th>
                    <th style={{ textAlign: "right" }}>Retail</th>
                    <th>On-hand</th>
                    <th>Shopify variant</th>
                  </tr>
                </thead>
                <tbody>
                  {(variants as VariantRow[]).map((v) => (
                    <tr key={v.id}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <ProductThumb
                            imageUrl={v.image_url}
                            alt={v.title}
                          />
                          <strong>{v.title}</strong>
                        </div>
                      </td>
                      <td className="mono small muted">{v.sku || "—"}</td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {v.retail_price == null
                          ? "—"
                          : money(v.retail_price)}
                      </td>
                      <td>
                        <OnHandCell
                          shopConnected={shopConnected}
                          linkedToVariant
                          levels={levelsByVariant.get(v.id) ?? null}
                        />
                      </td>
                      <td className="mono small muted">
                        {v.shopify_variant_id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <div className="between">
            <div>
              <h2 className="section-title">Supplier catalog</h2>
              <p className="small muted" style={{ margin: 0 }}>
                Grouped by Shopify variant when linked. Margin is retail − unit
                cost (live, not stored).
              </p>
            </div>
            <span className="mono small muted">{catalogCount}</span>
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            {catalogCount === 0 ? (
              <div className="card-body empty-state">
                <p style={{ margin: "0 0 12px" }}>
                  No supplier products yet. Add one manually — same free-text
                  flexibility as PO line items.
                </p>
                <Link href="/products/new" className="btn btn-primary">
                  Add supplier product
                </Link>
              </div>
            ) : (
              catalogGroups.map((group) => (
                <div key={group.key} className="catalog-group">
                  <div className="catalog-group-header">
                    <ProductThumb
                      imageUrl={group.imageUrl}
                      alt={group.title}
                    />
                    <div>
                      <span className="title">{group.title}</span>
                      <span className="retail">
                        {group.retailPrice == null
                          ? "Retail —"
                          : `Retail ${money(group.retailPrice)}`}
                      </span>
                    </div>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th>SKU</th>
                        <th>On-hand</th>
                        <th style={{ textAlign: "right" }}>Unit cost</th>
                        <th style={{ textAlign: "right" }}>Margin</th>
                        <th style={{ textAlign: "right" }}>Case qty</th>
                        <th style={{ textAlign: "right" }}>MOQ</th>
                        <th>Shopify</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...group.rows]
                        .sort((a, b) => {
                          const pa =
                            pricingByProduct.get(a.id)?.current_unit_cost;
                          const pb =
                            pricingByProduct.get(b.id)?.current_unit_cost;
                          if (pa == null && pb == null) return 0;
                          if (pa == null) return 1;
                          if (pb == null) return -1;
                          return pa - pb;
                        })
                        .map((row) => {
                          const supplier = row.suppliers;
                          const variantId = row.product_variant_id;
                          const pricing = pricingByProduct.get(row.id);
                          const unitCost = pricing?.current_unit_cost ?? null;

                          return (
                            <tr key={row.id}>
                              <td>
                                <div className="stack" style={{ gap: 2 }}>
                                  <Link
                                    href={`/products/${row.id}`}
                                    className="title-link"
                                  >
                                    <strong>
                                      {supplier?.name ?? row.title}
                                    </strong>
                                  </Link>
                                  {supplier &&
                                  row.title !== group.title ? (
                                    <span className="small muted">
                                      {row.title}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="mono small muted">
                                {row.sku || "—"}
                              </td>
                              <td>
                                <OnHandCell
                                  shopConnected={shopConnected}
                                  linkedToVariant={Boolean(variantId)}
                                  levels={
                                    variantId
                                      ? levelsByVariant.get(variantId) ?? null
                                      : null
                                  }
                                />
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <div className="mono">
                                  {pricing
                                    ? currentPriceLabel(pricing)
                                    : "—"}
                                </div>
                                {pricing ? (
                                  <ScheduledPriceNote
                                    next_unit_cost={pricing.next_unit_cost}
                                    next_effective_date={
                                      pricing.next_effective_date
                                    }
                                  />
                                ) : null}
                              </td>
                              <td
                                className="mono"
                                style={{ textAlign: "right" }}
                              >
                                {marginLabel(group.retailPrice, unitCost)}
                              </td>
                              <td
                                className="mono"
                                style={{ textAlign: "right" }}
                              >
                                {row.case_qty ?? "—"}
                              </td>
                              <td
                                className="mono"
                                style={{ textAlign: "right" }}
                              >
                                {row.moq ?? "—"}
                              </td>
                              <td>
                                {variantId ? (
                                  <span className="chip chip-confirmed">
                                    <span className="chip-dot" />
                                    Linked
                                  </span>
                                ) : (
                                  <span className="chip chip-idle">
                                    <span className="chip-dot" />
                                    Free-text
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}
