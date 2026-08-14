/**
 * Low-stock detection for notification evaluate (root Next cron).
 * Kept in the Next app so the root Vercel project does not import embedded/.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export type LowStockVariant = {
  productVariantId: string;
  title: string;
  sku: string | null;
  onHand: number;
  threshold: number;
  locationId: string | null;
};

export function resolveWorkspaceThreshold(
  ruleThreshold: number | null | undefined,
) {
  return ruleThreshold != null && Number(ruleThreshold) > 0
    ? Number(ruleThreshold)
    : DEFAULT_LOW_STOCK_THRESHOLD;
}

export async function listLowStockVariants(
  supabase: SupabaseClient,
  workspaceId: string,
  opts?: { ruleThreshold?: number | null },
): Promise<{ workspaceThreshold: number; variants: LowStockVariant[] }> {
  let workspaceThreshold = opts?.ruleThreshold;
  if (workspaceThreshold == null || !(Number(workspaceThreshold) > 0)) {
    const { data: rule, error: ruleErr } = await supabase
      .from("notification_rules")
      .select("threshold_value")
      .eq("workspace_id", workspaceId)
      .eq("rule_type", "inventory_low")
      .maybeSingle();
    if (ruleErr) throw new Error(ruleErr.message);
    workspaceThreshold = resolveWorkspaceThreshold(rule?.threshold_value);
  } else {
    workspaceThreshold = resolveWorkspaceThreshold(workspaceThreshold);
  }

  const { data: levels, error } = await supabase
    .from("inventory_levels")
    .select("on_hand, product_variant_id, location_id")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  const onHandByVariant = new Map<
    string,
    { onHand: number; locationId: string | null }
  >();
  for (const row of levels ?? []) {
    const id = row.product_variant_id as string;
    const onHand = Number(row.on_hand ?? 0);
    const prev = onHandByVariant.get(id);
    if (!prev || onHand < prev.onHand) {
      onHandByVariant.set(id, {
        onHand,
        locationId: (row.location_id as string) ?? null,
      });
    }
  }

  if (!onHandByVariant.size) {
    return { workspaceThreshold, variants: [] };
  }

  const variantIds = [...onHandByVariant.keys()];

  const [{ data: catalog, error: catalogErr }, { data: linked, error: linkedErr }] =
    await Promise.all([
      supabase
        .from("product_variants")
        .select("id, title, sku")
        .eq("workspace_id", workspaceId)
        .in("id", variantIds),
      supabase
        .from("supplier_products")
        .select("product_variant_id, low_stock_threshold")
        .eq("workspace_id", workspaceId)
        .in("product_variant_id", variantIds),
    ]);
  if (catalogErr) throw new Error(catalogErr.message);
  if (linkedErr) throw new Error(linkedErr.message);

  const productThresholdByVariant = new Map<string, number>();
  for (const row of linked ?? []) {
    const vid = row.product_variant_id as string | null;
    if (!vid) continue;
    const t = Number(row.low_stock_threshold);
    if (!(t > 0)) continue;
    const prev = productThresholdByVariant.get(vid);
    if (prev == null || t < prev) productThresholdByVariant.set(vid, t);
  }

  const meta = new Map(
    (catalog ?? []).map((row) => [
      row.id as string,
      {
        title: (row.title as string) || "Untitled variant",
        sku: (row.sku as string | null) ?? null,
      },
    ]),
  );

  const variants: LowStockVariant[] = [];
  for (const [id, stock] of onHandByVariant) {
    const threshold =
      productThresholdByVariant.get(id) ?? workspaceThreshold;
    if (stock.onHand > threshold) continue;
    const info = meta.get(id);
    variants.push({
      productVariantId: id,
      title: info?.title ?? "Untitled variant",
      sku: info?.sku ?? null,
      onHand: stock.onHand,
      threshold,
      locationId: stock.locationId,
    });
  }

  variants.sort((a, b) => a.onHand - b.onHand || a.title.localeCompare(b.title));
  return { workspaceThreshold, variants };
}
