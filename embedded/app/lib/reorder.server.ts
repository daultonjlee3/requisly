import { createServiceClient } from "./supabase.server";

export type ReorderRecommendation = {
  reorder_setting_id: string;
  workspace_id: string;
  product_variant_id: string;
  title: string;
  sku: string | null;
  on_hand: number;
  units_per_day: number;
  velocity_is_synthetic_test: boolean;
  lead_time_days: number | null;
  lead_time_source: "confirmed" | "fallback_estimate";
  confirmed_lead_po_count: number;
  fallback_supplier_stated_days: number | null;
  safety_stock_units: number;
  reorder_point: number;
  needs_reorder: boolean;
};

export async function listReorderRecommendations(
  workspaceId: string,
): Promise<{
  rows: ReorderRecommendation[];
  anySyntheticVelocity: boolean;
  needsReorderCount: number;
}> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("reorder_recommendations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("needs_reorder", { ascending: false })
    .order("title", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((r) => ({
    reorder_setting_id: String(r.reorder_setting_id),
    workspace_id: String(r.workspace_id),
    product_variant_id: String(r.product_variant_id),
    title: String(r.title ?? ""),
    sku: (r.sku as string | null) ?? null,
    on_hand: Number(r.on_hand ?? 0),
    units_per_day: Number(r.units_per_day ?? 0),
    velocity_is_synthetic_test: Boolean(r.velocity_is_synthetic_test),
    lead_time_days:
      r.lead_time_days == null ? null : Number(r.lead_time_days),
    lead_time_source:
      r.lead_time_source === "confirmed"
        ? ("confirmed" as const)
        : ("fallback_estimate" as const),
    confirmed_lead_po_count: Number(r.confirmed_lead_po_count ?? 0),
    fallback_supplier_stated_days:
      r.fallback_supplier_stated_days == null
        ? null
        : Number(r.fallback_supplier_stated_days),
    safety_stock_units: Number(r.safety_stock_units ?? 0),
    reorder_point: Number(r.reorder_point ?? 0),
    needs_reorder: Boolean(r.needs_reorder),
  }));

  return {
    rows,
    anySyntheticVelocity: rows.some((r) => r.velocity_is_synthetic_test),
    needsReorderCount: rows.filter((r) => r.needs_reorder).length,
  };
}
