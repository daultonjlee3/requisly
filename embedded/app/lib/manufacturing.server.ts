/**
 * Manufacturing — BOM (product_recipes) + Manufacturing Orders (MTS + MTO).
 * Inventory mutations on complete go through Postgres RPC
 * `complete_manufacturing_order` (single transaction). Never partial-apply.
 * Make-to-order MOs are suggested only — never auto-created.
 */
import { createServiceClient } from "./supabase.server";

export type RecipeLineInput = {
  ingredientProductVariantId: string;
  qtyRequired: number;
  isSubassembly?: boolean;
};

export type RecipeDetail = {
  id: string;
  workspaceId: string;
  productVariantId: string;
  finishedTitle: string;
  finishedSku: string | null;
  name: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    ingredientProductVariantId: string;
    title: string;
    sku: string | null;
    qtyRequired: number;
    isSubassembly: boolean;
    sortOrder: number;
  }>;
};

export type ManufacturingOrderRow = {
  id: string;
  workspaceId: string;
  productVariantId: string;
  finishedTitle: string;
  finishedSku: string | null;
  locationId: string;
  locationName: string;
  qtyToMake: number;
  mode: "make_to_stock" | "make_to_order";
  /** Internal shopify_orders.id (text). Null for make-to-stock. */
  linkedSalesOrderId: string | null;
  linkedOrderName: string | null;
  status: "draft" | "in_progress" | "completed" | "cancelled";
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type MakeToOrderSuggestion = {
  salesOrderId: string;
  orderName: string;
  processedAt: string | null;
  isSyntheticTest: boolean;
  productVariantId: string;
  finishedTitle: string;
  finishedSku: string | null;
  lineQuantity: number;
  onHandTotal: number;
  alreadyCoveredByMo: number;
  qtyToMake: number;
  suggestedLocationId: string;
  suggestedLocationName: string;
};

export type BomRequirement = {
  ingredientProductVariantId: string;
  title: string;
  sku: string | null;
  qtyRequired: number;
  onHand: number;
  shortfall: number;
};

export type CompleteMoResult = {
  mo_id: string;
  status: string;
  location_id: string;
  deductions: Array<{
    product_variant_id: string;
    qty_required: number;
    qty_deducted: number;
    on_hand_before: number;
    on_hand_after: number;
  }>;
  finished: {
    product_variant_id: string;
    qty_added: number;
    on_hand_before: number;
    on_hand_after: number;
  };
  completed_at: string;
};

export async function listRecipes(workspaceId: string): Promise<
  Array<{
    id: string;
    productVariantId: string;
    finishedTitle: string;
    finishedSku: string | null;
    lineCount: number;
    createdAt: string;
  }>
> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("product_recipes")
    .select(
      "id, product_variant_id, created_at, product_variants(title, sku), product_recipe_lines(id)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    const pv = r.product_variants as unknown as {
      title: string;
      sku: string | null;
    } | null;
    const lines = (r.product_recipe_lines ?? []) as Array<{ id: string }>;
    return {
      id: r.id as string,
      productVariantId: r.product_variant_id as string,
      finishedTitle: pv?.title ?? "—",
      finishedSku: pv?.sku ?? null,
      lineCount: lines.length,
      createdAt: r.created_at as string,
    };
  });
}

export async function getRecipe(
  workspaceId: string,
  recipeId: string,
): Promise<RecipeDetail | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("product_recipes")
    .select(
      "id, workspace_id, product_variant_id, name, created_at, product_variants(title, sku)",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", recipeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: lineRows, error: lineErr } = await supabase
    .from("product_recipe_lines")
    .select(
      "id, ingredient_product_variant_id, qty_required, is_subassembly, sort_order",
    )
    .eq("recipe_id", recipeId)
    .order("sort_order", { ascending: true });
  if (lineErr) throw new Error(lineErr.message);

  const ingredientIds = (lineRows ?? []).map(
    (l) => l.ingredient_product_variant_id as string,
  );
  const { data: variants } = ingredientIds.length
    ? await supabase
        .from("product_variants")
        .select("id, title, sku")
        .eq("workspace_id", workspaceId)
        .in("id", ingredientIds)
    : { data: [] as Array<{ id: string; title: string; sku: string | null }> };

  const byId = new Map(
    (variants ?? []).map((v) => [
      v.id as string,
      { title: v.title as string, sku: (v.sku as string | null) ?? null },
    ]),
  );

  const finished = data.product_variants as unknown as {
    title: string;
    sku: string | null;
  } | null;

  return {
    id: data.id as string,
    workspaceId: data.workspace_id as string,
    productVariantId: data.product_variant_id as string,
    finishedTitle: finished?.title ?? "—",
    finishedSku: finished?.sku ?? null,
    name: (data.name as string | null) ?? null,
    createdAt: data.created_at as string,
    lines: (lineRows ?? []).map((l) => {
      const meta = byId.get(l.ingredient_product_variant_id as string);
      return {
        id: l.id as string,
        ingredientProductVariantId: l.ingredient_product_variant_id as string,
        title: meta?.title ?? "—",
        sku: meta?.sku ?? null,
        qtyRequired: Number(l.qty_required),
        isSubassembly: Boolean(l.is_subassembly),
        sortOrder: Number(l.sort_order),
      };
    }),
  };
}

export async function upsertRecipe(opts: {
  workspaceId: string;
  productVariantId: string;
  name?: string | null;
  lines: RecipeLineInput[];
  recipeId?: string | null;
}): Promise<{ id: string }> {
  const supabase = createServiceClient();
  const lines = opts.lines.filter(
    (l) =>
      l.ingredientProductVariantId &&
      Number(l.qtyRequired) > 0 &&
      l.ingredientProductVariantId !== opts.productVariantId,
  );
  if (!lines.length) throw new Error("Add at least one ingredient line");

  // Auto-flag subassembly when ingredient itself has a recipe.
  const ingredientIds = lines.map((l) => l.ingredientProductVariantId);
  const { data: subRecipes } = await supabase
    .from("product_recipes")
    .select("product_variant_id")
    .eq("workspace_id", opts.workspaceId)
    .in("product_variant_id", ingredientIds);
  const subSet = new Set(
    (subRecipes ?? []).map((r) => r.product_variant_id as string),
  );

  let recipeId = opts.recipeId ?? null;

  if (recipeId) {
    const { data: existing, error } = await supabase
      .from("product_recipes")
      .select("id")
      .eq("id", recipeId)
      .eq("workspace_id", opts.workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!existing) throw new Error("Recipe not found");

    const { error: updErr } = await supabase
      .from("product_recipes")
      .update({
        product_variant_id: opts.productVariantId,
        name: opts.name?.trim() || null,
      })
      .eq("id", recipeId)
      .eq("workspace_id", opts.workspaceId);
    if (updErr) throw new Error(updErr.message);

    const { error: delErr } = await supabase
      .from("product_recipe_lines")
      .delete()
      .eq("recipe_id", recipeId);
    if (delErr) throw new Error(delErr.message);
  } else {
    const { data: created, error } = await supabase
      .from("product_recipes")
      .upsert(
        {
          workspace_id: opts.workspaceId,
          product_variant_id: opts.productVariantId,
          name: opts.name?.trim() || null,
        },
        { onConflict: "workspace_id,product_variant_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    recipeId = created.id as string;

    const { error: clearErr } = await supabase
      .from("product_recipe_lines")
      .delete()
      .eq("recipe_id", recipeId);
    if (clearErr) throw new Error(clearErr.message);
  }

  const { error: insErr } = await supabase.from("product_recipe_lines").insert(
    lines.map((l, i) => ({
      recipe_id: recipeId,
      ingredient_product_variant_id: l.ingredientProductVariantId,
      qty_required: Number(l.qtyRequired),
      is_subassembly: Boolean(l.isSubassembly) || subSet.has(l.ingredientProductVariantId),
      sort_order: i,
    })),
  );
  if (insErr) throw new Error(insErr.message);

  return { id: recipeId! };
}

function mapMoRow(
  r: Record<string, unknown>,
  orderNameById?: Map<string, string>,
): ManufacturingOrderRow {
  const pv = r.product_variants as unknown as {
    title: string;
    sku: string | null;
  } | null;
  const loc = r.locations as unknown as { name: string } | null;
  const linked = (r.linked_sales_order_id as string | null) ?? null;
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    productVariantId: r.product_variant_id as string,
    finishedTitle: pv?.title ?? "—",
    finishedSku: pv?.sku ?? null,
    locationId: r.location_id as string,
    locationName: loc?.name ?? "—",
    qtyToMake: Number(r.qty_to_make),
    mode: r.mode as ManufacturingOrderRow["mode"],
    linkedSalesOrderId: linked,
    linkedOrderName: linked
      ? (orderNameById?.get(linked) ?? null)
      : null,
    status: r.status as ManufacturingOrderRow["status"],
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
  };
}

async function resolveOrderNames(
  workspaceId: string,
  orderIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(orderIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("shopify_orders")
    .select("id, order_name")
    .eq("workspace_id", workspaceId)
    .in("id", unique);
  return new Map(
    (data ?? []).map((o) => [o.id as string, (o.order_name as string) ?? "—"]),
  );
}

export async function listManufacturingOrders(
  workspaceId: string,
): Promise<ManufacturingOrderRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("manufacturing_orders")
    .select(
      "id, workspace_id, product_variant_id, location_id, qty_to_make, mode, linked_sales_order_id, status, notes, created_at, completed_at, product_variants(title, sku), locations(name)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const names = await resolveOrderNames(
    workspaceId,
    (data ?? []).map((r) => (r.linked_sales_order_id as string | null) ?? ""),
  );
  return (data ?? []).map((r) => mapMoRow(r as Record<string, unknown>, names));
}

export async function getManufacturingOrder(
  workspaceId: string,
  moId: string,
): Promise<ManufacturingOrderRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("manufacturing_orders")
    .select(
      "id, workspace_id, product_variant_id, location_id, qty_to_make, mode, linked_sales_order_id, status, notes, created_at, completed_at, product_variants(title, sku), locations(name)",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", moId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const linked = (data.linked_sales_order_id as string | null) ?? null;
  const names = linked
    ? await resolveOrderNames(workspaceId, [linked])
    : new Map<string, string>();
  return mapMoRow(data as Record<string, unknown>, names);
}

export async function createManufacturingOrder(opts: {
  workspaceId: string;
  productVariantId: string;
  locationId: string;
  qtyToMake: number;
  notes?: string | null;
  mode?: "make_to_stock" | "make_to_order";
  linkedSalesOrderId?: string | null;
}): Promise<{ id: string }> {
  const supabase = createServiceClient();
  const qty = Math.floor(Number(opts.qtyToMake));
  if (!(qty > 0)) throw new Error("Quantity to make must be positive");

  const mode = opts.mode ?? "make_to_stock";
  const linkedSalesOrderId =
    mode === "make_to_order"
      ? (opts.linkedSalesOrderId?.trim() || null)
      : null;
  if (mode === "make_to_order" && !linkedSalesOrderId) {
    throw new Error("Make-to-order requires a linked sales order");
  }

  const { data: recipe } = await supabase
    .from("product_recipes")
    .select("id")
    .eq("workspace_id", opts.workspaceId)
    .eq("product_variant_id", opts.productVariantId)
    .maybeSingle();
  if (!recipe) {
    throw new Error("Create a BOM/recipe for this finished product first");
  }

  if (linkedSalesOrderId) {
    const { data: order } = await supabase
      .from("shopify_orders")
      .select("id")
      .eq("workspace_id", opts.workspaceId)
      .eq("id", linkedSalesOrderId)
      .maybeSingle();
    if (!order) throw new Error("Linked sales order not found in this workspace");

    const { data: existing } = await supabase
      .from("manufacturing_orders")
      .select("id")
      .eq("workspace_id", opts.workspaceId)
      .eq("linked_sales_order_id", linkedSalesOrderId)
      .eq("product_variant_id", opts.productVariantId)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle();
    if (existing) {
      throw new Error(
        "An open make-to-order MO already exists for this sales order line product",
      );
    }
  }

  const { data, error } = await supabase
    .from("manufacturing_orders")
    .insert({
      workspace_id: opts.workspaceId,
      product_variant_id: opts.productVariantId,
      location_id: opts.locationId,
      qty_to_make: qty,
      mode,
      linked_sales_order_id: linkedSalesOrderId,
      status: "draft",
      notes: opts.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string };
}

/**
 * Suggest make-to-order MOs when a sales order needs a BOM finished good
 * that current on-hand (FIFO-allocated across orders) cannot cover.
 * Never inserts MOs — merchant must accept a suggestion.
 */
export async function listMakeToOrderSuggestions(
  workspaceId: string,
  opts?: { lookbackDays?: number },
): Promise<MakeToOrderSuggestion[]> {
  const supabase = createServiceClient();
  const lookbackDays = opts?.lookbackDays ?? 90;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);

  const [{ data: recipes }, { data: locations }, { data: orders }] =
    await Promise.all([
      supabase
        .from("product_recipes")
        .select("product_variant_id")
        .eq("workspace_id", workspaceId),
      supabase
        .from("locations")
        .select("id, name, is_primary")
        .eq("workspace_id", workspaceId),
      supabase
        .from("shopify_orders")
        .select(
          "id, order_name, processed_at, is_synthetic_test, created_at",
        )
        .eq("workspace_id", workspaceId)
        .gte("created_at", since.toISOString())
        .order("processed_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
    ]);

  const recipeVariantIds = new Set(
    (recipes ?? []).map((r) => r.product_variant_id as string),
  );
  if (!recipeVariantIds.size || !(orders ?? []).length) return [];

  const primaryLoc =
    (locations ?? []).find((l) => l.is_primary) ?? (locations ?? [])[0];
  if (!primaryLoc) return [];

  const orderIds = (orders ?? []).map((o) => o.id as string);
  const [{ data: lines }, { data: levels }, { data: openMos }] =
    await Promise.all([
      supabase
        .from("shopify_order_line_items")
        .select("order_id, product_variant_id, quantity, title")
        .eq("workspace_id", workspaceId)
        .in("order_id", orderIds)
        .not("product_variant_id", "is", null),
      supabase
        .from("inventory_levels")
        .select("product_variant_id, on_hand")
        .eq("workspace_id", workspaceId)
        .in("product_variant_id", [...recipeVariantIds]),
      supabase
        .from("manufacturing_orders")
        .select(
          "linked_sales_order_id, product_variant_id, qty_to_make, status",
        )
        .eq("workspace_id", workspaceId)
        .eq("mode", "make_to_order")
        .neq("status", "cancelled")
        .not("linked_sales_order_id", "is", null),
    ]);

  const onHandByVariant = new Map<string, number>();
  for (const l of levels ?? []) {
    const id = l.product_variant_id as string;
    onHandByVariant.set(
      id,
      (onHandByVariant.get(id) ?? 0) + Number(l.on_hand ?? 0),
    );
  }

  const coveredKey = (orderId: string, variantId: string) =>
    `${orderId}::${variantId}`;
  const coveredByMo = new Map<string, number>();
  for (const mo of openMos ?? []) {
    const orderId = mo.linked_sales_order_id as string;
    const variantId = mo.product_variant_id as string;
    const key = coveredKey(orderId, variantId);
    coveredByMo.set(
      key,
      (coveredByMo.get(key) ?? 0) + Number(mo.qty_to_make ?? 0),
    );
  }

  const variantIdsNeeded = [
    ...new Set(
      (lines ?? [])
        .map((l) => l.product_variant_id as string | null)
        .filter((id): id is string => Boolean(id) && recipeVariantIds.has(id)),
    ),
  ];
  const { data: variants } = variantIdsNeeded.length
    ? await supabase
        .from("product_variants")
        .select("id, title, sku")
        .eq("workspace_id", workspaceId)
        .in("id", variantIdsNeeded)
    : { data: [] as Array<{ id: string; title: string; sku: string | null }> };
  const variantMeta = new Map(
    (variants ?? []).map((v) => [
      v.id as string,
      { title: v.title as string, sku: (v.sku as string | null) ?? null },
    ]),
  );

  const orderById = new Map(
    (orders ?? []).map((o) => [
      o.id as string,
      {
        orderName: (o.order_name as string) ?? "—",
        processedAt: (o.processed_at as string | null) ?? null,
        isSyntheticTest: Boolean(o.is_synthetic_test),
      },
    ]),
  );

  // Remaining finished-goods pool per variant (FIFO across orders).
  const remainingStock = new Map(onHandByVariant);
  const suggestions: MakeToOrderSuggestion[] = [];

  const linesByOrder = new Map<string, typeof lines>();
  for (const line of lines ?? []) {
    const oid = line.order_id as string;
    const list = linesByOrder.get(oid) ?? [];
    list.push(line);
    linesByOrder.set(oid, list);
  }

  for (const order of orders ?? []) {
    const oid = order.id as string;
    for (const line of linesByOrder.get(oid) ?? []) {
      const variantId = line.product_variant_id as string | null;
      if (!variantId || !recipeVariantIds.has(variantId)) continue;

      const lineQty = Math.max(0, Number(line.quantity ?? 0));
      if (!(lineQty > 0)) continue;

      const covered = coveredByMo.get(coveredKey(oid, variantId)) ?? 0;
      const need = Math.max(0, lineQty - covered);
      if (!(need > 0)) continue;

      const pool = remainingStock.get(variantId) ?? 0;
      const fromStock = Math.min(pool, need);
      remainingStock.set(variantId, pool - fromStock);
      const shortfall = need - fromStock;
      if (!(shortfall > 0)) continue;

      const meta = variantMeta.get(variantId);
      const ord = orderById.get(oid)!;
      suggestions.push({
        salesOrderId: oid,
        orderName: ord.orderName,
        processedAt: ord.processedAt,
        isSyntheticTest: ord.isSyntheticTest,
        productVariantId: variantId,
        finishedTitle: meta?.title ?? (line.title as string) ?? "—",
        finishedSku: meta?.sku ?? null,
        lineQuantity: lineQty,
        onHandTotal: onHandByVariant.get(variantId) ?? 0,
        alreadyCoveredByMo: covered,
        qtyToMake: shortfall,
        suggestedLocationId: primaryLoc.id as string,
        suggestedLocationName: (primaryLoc.name as string) ?? "—",
      });
    }
  }

  return suggestions;
}

/** Merchant-accepted suggestion → draft make-to-order MO. Never called automatically. */
export async function acceptMakeToOrderSuggestion(opts: {
  workspaceId: string;
  salesOrderId: string;
  productVariantId: string;
  qtyToMake: number;
  locationId: string;
}): Promise<{ id: string }> {
  const orderLabel = (
    await resolveOrderNames(opts.workspaceId, [opts.salesOrderId])
  ).get(opts.salesOrderId);

  return createManufacturingOrder({
    workspaceId: opts.workspaceId,
    productVariantId: opts.productVariantId,
    locationId: opts.locationId,
    qtyToMake: opts.qtyToMake,
    mode: "make_to_order",
    linkedSalesOrderId: opts.salesOrderId,
    notes: orderLabel
      ? `Make-to-order for sales order ${orderLabel}`
      : "Make-to-order (merchant-accepted suggestion)",
  });
}

export async function startManufacturingOrder(
  workspaceId: string,
  moId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("manufacturing_orders")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", moId)
    .eq("workspace_id", workspaceId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("MO not found or not in draft status");
}

/**
 * Preview leaf ingredient requirements (read-only) for an MO qty.
 */
export async function previewBomRequirements(opts: {
  workspaceId: string;
  productVariantId: string;
  locationId: string;
  qtyToMake: number;
}): Promise<BomRequirement[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("expand_bom_requirements", {
    p_workspace_id: opts.workspaceId,
    p_finished_variant_id: opts.productVariantId,
    p_qty_to_make: opts.qtyToMake,
  });
  if (error) throw new Error(error.message);

  const reqs = (data ?? []) as Array<{
    ingredient_product_variant_id: string;
    qty_required: number | string;
  }>;
  if (!reqs.length) return [];

  const ids = reqs.map((r) => r.ingredient_product_variant_id);
  const [{ data: variants }, { data: levels }] = await Promise.all([
    supabase
      .from("product_variants")
      .select("id, title, sku")
      .eq("workspace_id", opts.workspaceId)
      .in("id", ids),
    supabase
      .from("inventory_levels")
      .select("product_variant_id, on_hand")
      .eq("workspace_id", opts.workspaceId)
      .eq("location_id", opts.locationId)
      .in("product_variant_id", ids),
  ]);

  const titleById = new Map(
    (variants ?? []).map((v) => [
      v.id as string,
      { title: v.title as string, sku: (v.sku as string | null) ?? null },
    ]),
  );
  const onHandById = new Map(
    (levels ?? []).map((l) => [
      l.product_variant_id as string,
      Number(l.on_hand ?? 0),
    ]),
  );

  return reqs.map((r) => {
    const qty = Number(r.qty_required);
    const needed = Math.ceil(qty);
    const onHand = onHandById.get(r.ingredient_product_variant_id) ?? 0;
    const meta = titleById.get(r.ingredient_product_variant_id);
    return {
      ingredientProductVariantId: r.ingredient_product_variant_id,
      title: meta?.title ?? "—",
      sku: meta?.sku ?? null,
      qtyRequired: qty,
      onHand,
      shortfall: Math.max(0, needed - onHand),
    };
  });
}

/**
 * Complete MO via Postgres RPC — atomic deduct ingredients + add finished.
 * On any failure (including insufficient stock), nothing is persisted.
 */
export async function completeManufacturingOrder(
  workspaceId: string,
  moId: string,
): Promise<CompleteMoResult> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("complete_manufacturing_order", {
    p_workspace_id: workspaceId,
    p_mo_id: moId,
  });
  if (error) throw new Error(error.message);
  return data as CompleteMoResult;
}
