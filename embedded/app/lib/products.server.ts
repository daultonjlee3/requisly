import { createServiceClient } from "./supabase.server";
import { money, shortDate } from "./format";
import {
  computeLandedUnitCost,
  currentLandedUnitCostAsOf,
  currentUnitCostAsOf,
  todayDateInputValue,
  type PriceScheduleRow,
} from "./pricing";

// mediumDate - need to add to format.ts if missing
function formatMedium(value: string | null | undefined) {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric" },
    );
  }
  return shortDate(value);
}

export type CatalogProductRow = {
  id: string;
  title: string;
  sku: string;
  supplierId: string;
  supplierName: string;
  /** Display: landed when components exist, else FOB. */
  unitCost: string;
  caseQty: string;
  moq: string;
};

export type VariantRow = {
  id: string;
  title: string;
  sku: string;
  retailPrice: string;
  onHand: number;
  imageUrl: string | null;
};

export type ProductDetail = {
  id: string;
  title: string;
  sku: string | null;
  supplierId: string;
  supplierName: string;
  caseQty: number | null;
  moq: number | null;
  /** FOB / supplier invoice current cost. */
  currentCost: string;
  /** Landed current cost (FOB + freight + duty + customs). */
  currentLandedCost: string;
  schedule: Array<{
    id: string;
    unitCost: string;
    freightPerUnit: string;
    dutyPerUnit: string;
    customsPerUnit: string;
    landedUnitCost: string;
    effectiveDate: string;
    status: "Current" | "Scheduled" | "Past";
  }>;
};

export async function listProductsWorkspace(workspaceId: string): Promise<{
  catalog: CatalogProductRow[];
  variants: VariantRow[];
  suppliers: Array<{ id: string; name: string }>;
  syncedAt: string | null;
}> {
  const supabase = createServiceClient();
  const asOf = todayDateInputValue();

  const [
    { data: catalog, error: cErr },
    { data: variants, error: vErr },
    { data: locations, error: locErr },
    { data: levels, error: lvlErr },
    { data: workspace, error: wsErr },
    { data: suppliers, error: supErr },
  ] = await Promise.all([
    supabase
      .from("supplier_products")
      .select(
        "id, title, sku, case_qty, moq, supplier_id, suppliers(name), supplier_product_prices(id, unit_cost, freight_per_unit, duty_per_unit, customs_per_unit, landed_unit_cost, effective_date, created_at)",
      )
      .eq("workspace_id", workspaceId)
      .order("title"),
    supabase
      .from("product_variants")
      .select("id, title, sku, retail_price, image_url")
      .eq("workspace_id", workspaceId)
      .order("title"),
    supabase
      .from("locations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("is_primary", true)
      .maybeSingle(),
    supabase
      .from("inventory_levels")
      .select("product_variant_id, location_id, on_hand")
      .eq("workspace_id", workspaceId),
    supabase
      .from("workspaces")
      .select("shopify_synced_at")
      .eq("id", workspaceId)
      .maybeSingle(),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("name"),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (vErr) throw new Error(vErr.message);
  if (locErr) throw new Error(locErr.message);
  if (lvlErr) throw new Error(lvlErr.message);
  if (wsErr) throw new Error(wsErr.message);
  if (supErr) throw new Error(supErr.message);

  const primaryId = locations?.id;
  const onHandByVariant = new Map<string, number>();
  for (const level of levels ?? []) {
    if (primaryId && level.location_id !== primaryId) continue;
    onHandByVariant.set(
      level.product_variant_id,
      (onHandByVariant.get(level.product_variant_id) ?? 0) + (level.on_hand ?? 0),
    );
  }

  return {
    syncedAt: workspace?.shopify_synced_at ?? null,
    suppliers: (suppliers ?? []).map((s) => ({ id: s.id, name: s.name })),
    catalog: (catalog ?? []).map((row) => {
      const supplier = row.suppliers as unknown as { name: string } | null;
      const prices = (row.supplier_product_prices ?? []) as PriceScheduleRow[];
      const fob = currentUnitCostAsOf(prices, asOf);
      const landed = currentLandedUnitCostAsOf(prices, asOf);
      const display = landed ?? fob;
      return {
        id: row.id,
        title: row.title,
        sku: row.sku || "—",
        supplierId: row.supplier_id,
        supplierName: supplier?.name ?? "—",
        unitCost: display != null ? money(display) : "—",
        caseQty: row.case_qty != null ? String(row.case_qty) : "—",
        moq: row.moq != null ? String(row.moq) : "—",
      };
    }),
    variants: (variants ?? []).map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku || "—",
      retailPrice: v.retail_price != null ? money(v.retail_price) : "—",
      onHand: onHandByVariant.get(v.id) ?? 0,
      imageUrl: v.image_url,
    })),
  };
}

export async function getSupplierProductDetail(
  workspaceId: string,
  productId: string,
): Promise<ProductDetail | null> {
  const supabase = createServiceClient();
  const asOf = todayDateInputValue();

  const { data: product, error } = await supabase
    .from("supplier_products")
    .select("*, suppliers(id, name)")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!product) return null;

  const { data: prices, error: pErr } = await supabase
    .from("supplier_product_prices")
    .select(
      "id, unit_cost, freight_per_unit, duty_per_unit, customs_per_unit, landed_unit_cost, effective_date, created_at",
    )
    .eq("supplier_product_id", productId)
    .order("effective_date", { ascending: false });
  if (pErr) throw new Error(pErr.message);

  const scheduleRows = (prices ?? []) as PriceScheduleRow[];
  const currentFob = currentUnitCostAsOf(scheduleRows, asOf);
  const currentLanded = currentLandedUnitCostAsOf(scheduleRows, asOf);
  const supplier = product.suppliers as unknown as {
    id: string;
    name: string;
  } | null;

  // Find which row is current for labeling
  const sorted = [...scheduleRows].sort((a, b) => {
    if (a.effective_date !== b.effective_date) {
      return a.effective_date < b.effective_date ? 1 : -1;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });
  const currentId =
    sorted.find((r) => r.effective_date <= asOf)?.id ?? null;

  return {
    id: product.id,
    title: product.title,
    sku: product.sku,
    supplierId: product.supplier_id,
    supplierName: supplier?.name ?? "—",
    caseQty: product.case_qty,
    moq: product.moq,
    currentCost: currentFob != null ? money(currentFob) : "—",
    currentLandedCost: currentLanded != null ? money(currentLanded) : "—",
    schedule: scheduleRows.map((row) => {
      let status: "Current" | "Scheduled" | "Past" = "Past";
      if (row.effective_date > asOf) status = "Scheduled";
      else if (row.id === currentId) status = "Current";
      const freight = Number(row.freight_per_unit ?? 0);
      const duty = Number(row.duty_per_unit ?? 0);
      const customs = Number(row.customs_per_unit ?? 0);
      return {
        id: row.id,
        unitCost: money(row.unit_cost),
        freightPerUnit: money(freight),
        dutyPerUnit: money(duty),
        customsPerUnit: money(customs),
        landedUnitCost: money(computeLandedUnitCost(row)),
        effectiveDate: formatMedium(row.effective_date),
        status,
      };
    }),
  };
}

async function resolveProductVariantId(
  workspaceId: string,
  opts: {
    productVariantId?: string | null;
    shopifyVariantId?: string | null;
  },
): Promise<string | null> {
  if (opts.productVariantId) return opts.productVariantId;
  if (!opts.shopifyVariantId) return null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("shopify_variant_id", opts.shopifyVariantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function listShopifyVariantsForPicker(
  workspaceId: string,
): Promise<
  Array<{
    id: string;
    shopifyVariantId: string;
    title: string;
    sku: string | null;
  }>
> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, shopify_variant_id, title, sku")
    .eq("workspace_id", workspaceId)
    .order("title")
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    shopifyVariantId: row.shopify_variant_id,
    title: row.title,
    sku: row.sku,
  }));
}

export async function createSupplierProduct(
  workspaceId: string,
  formData: FormData,
): Promise<{ id: string; supplierId: string }> {
  const title = String(formData.get("title") ?? "").trim();
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!title) throw new Error("Title is required");
  if (!supplierId) throw new Error("Supplier is required");

  const sku = emptyToNull(formData.get("sku"));
  const unitCostRaw = String(formData.get("unit_cost") ?? "").trim();
  const caseQtyRaw = String(formData.get("case_qty") ?? "").trim();
  const moqRaw = String(formData.get("moq") ?? "").trim();
  const effectiveRaw = String(formData.get("effective_date") ?? "").trim();
  const productVariantIdRaw = String(
    formData.get("product_variant_id") ?? "",
  ).trim();
  const shopifyVariantIdRaw = String(
    formData.get("shopify_variant_id") ?? "",
  ).trim();

  const unit_cost =
    unitCostRaw === "" ? null : Number(unitCostRaw.replace(/[^0-9.-]/g, ""));
  const case_qty = caseQtyRaw === "" ? null : Number.parseInt(caseQtyRaw, 10);
  const moq = moqRaw === "" ? null : Number.parseInt(moqRaw, 10);

  if (unit_cost != null && (!Number.isFinite(unit_cost) || unit_cost < 0)) {
    throw new Error("Unit cost must be a non-negative number");
  }
  if (unit_cost != null && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveRaw)) {
    throw new Error("Effective date is required when setting a unit cost");
  }

  const supabase = createServiceClient();
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", supplierId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!supplier) throw new Error("Supplier not found in this workspace");

  const product_variant_id = await resolveProductVariantId(workspaceId, {
    productVariantId: productVariantIdRaw || null,
    shopifyVariantId: shopifyVariantIdRaw || null,
  });

  if (product_variant_id) {
    const { data: existing } = await supabase
      .from("supplier_products")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("supplier_id", supplierId)
      .eq("product_variant_id", product_variant_id)
      .maybeSingle();
    if (existing) {
      throw new Error("That Shopify product is already on this vendor’s list");
    }
  }

  const { data: product, error } = await supabase
    .from("supplier_products")
    .insert({
      workspace_id: workspaceId,
      supplier_id: supplierId,
      product_variant_id,
      title,
      sku,
      unit_cost,
      case_qty,
      moq,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (unit_cost != null) {
    const { error: priceError } = await supabase
      .from("supplier_product_prices")
      .insert({
        supplier_product_id: product.id,
        unit_cost,
        effective_date: effectiveRaw,
        created_by: null,
      });
    if (priceError) throw new Error(priceError.message);
  }

  return { id: product.id, supplierId };
}

export type ShopifyCatalogLinkInput = {
  title: string;
  sku: string | null;
  shopifyVariantId: string;
  productVariantId?: string | null;
  unitCost: number | null;
  effectiveDate: string | null;
};

/** Link one or more Shopify variants onto a supplier price list. */
export async function linkShopifyVariantsToSupplier(opts: {
  workspaceId: string;
  supplierId: string;
  items: ShopifyCatalogLinkInput[];
}): Promise<{ linked: number; productIds: string[] }> {
  if (!opts.items.length) throw new Error("Select at least one Shopify product");

  const productIds: string[] = [];
  for (const item of opts.items) {
    const form = new FormData();
    form.set("supplier_id", opts.supplierId);
    form.set("title", item.title);
    form.set("sku", item.sku ?? "");
    form.set("shopify_variant_id", item.shopifyVariantId);
    if (item.productVariantId) {
      form.set("product_variant_id", item.productVariantId);
    }
    if (item.unitCost != null) {
      form.set("unit_cost", String(item.unitCost));
      form.set(
        "effective_date",
        item.effectiveDate || todayDateInputValue(),
      );
    }
    const created = await createSupplierProduct(opts.workspaceId, form);
    productIds.push(created.id);
  }
  return { linked: productIds.length, productIds };
}

export async function scheduleSupplierProductPrice(
  workspaceId: string,
  formData: FormData,
): Promise<{ productId: string }> {
  const productId = String(formData.get("supplier_product_id") ?? "").trim();
  const unitCostRaw = String(formData.get("unit_cost") ?? "").trim();
  const effectiveRaw = String(formData.get("effective_date") ?? "").trim();
  if (!productId) throw new Error("Product is required");

  const unit_cost = Number(unitCostRaw.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(unit_cost) || unit_cost < 0) {
    throw new Error("Unit cost must be a non-negative number");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveRaw)) {
    throw new Error("Effective date is required");
  }

  function parseComponent(name: string): number {
    const raw = String(formData.get(name) ?? "").trim();
    if (!raw) return 0;
    const n = Number(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${name} must be a non-negative number`);
    }
    return n;
  }

  const freight_per_unit = parseComponent("freight_per_unit");
  const duty_per_unit = parseComponent("duty_per_unit");
  const customs_per_unit = parseComponent("customs_per_unit");

  const supabase = createServiceClient();
  const { data: product } = await supabase
    .from("supplier_products")
    .select("id")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!product) throw new Error("Product not found in this workspace");

  const { error } = await supabase.from("supplier_product_prices").insert({
    supplier_product_id: product.id,
    unit_cost,
    freight_per_unit,
    duty_per_unit,
    customs_per_unit,
    effective_date: effectiveRaw,
    created_by: null,
  });
  if (error) throw new Error(error.message);
  return { productId: product.id };
}

export async function deleteSupplierProductPrice(
  workspaceId: string,
  priceId: string,
): Promise<{ productId: string }> {
  const supabase = createServiceClient();
  const { data: price } = await supabase
    .from("supplier_product_prices")
    .select("id, supplier_product_id")
    .eq("id", priceId)
    .maybeSingle();
  if (!price) throw new Error("Price entry not found");

  const { data: product } = await supabase
    .from("supplier_products")
    .select("id")
    .eq("id", price.supplier_product_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!product) throw new Error("Price entry not found in this workspace");

  const { error } = await supabase
    .from("supplier_product_prices")
    .delete()
    .eq("id", priceId);
  if (error) throw new Error(error.message);
  return { productId: product.id };
}

function emptyToNull(value: FormDataEntryValue | null) {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}
