/**
 * Multi-location transfers + stocktakes.
 * Inventory mutations: mark_transfer_in_transit / receive_transfer / complete_stocktake RPCs.
 */
import { createServiceClient } from "./supabase.server";
import {
  resolveListWindow,
  sanitizeSearch,
  type ListPageOpts,
  type ListPageResult,
} from "./list-table";

export type TransferStatus = "draft" | "in_transit" | "received" | "cancelled";
export type StocktakeStatus = "in_progress" | "completed" | "cancelled";

export type TransferLineInput = {
  productVariantId: string;
  qty: number;
};

export type TransferDetail = {
  id: string;
  workspaceId: string;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  status: TransferStatus;
  notes: string | null;
  createdAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
  lines: Array<{
    id: string;
    productVariantId: string;
    title: string;
    sku: string | null;
    qty: number;
  }>;
};

export type StocktakeDetail = {
  id: string;
  workspaceId: string;
  locationId: string;
  locationName: string;
  status: StocktakeStatus;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  lines: Array<{
    id: string;
    productVariantId: string;
    title: string;
    sku: string | null;
    expectedQty: number;
    countedQty: number | null;
    variance: number | null;
  }>;
};

async function listWorkspaceLocations(workspaceId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, is_primary")
    .eq("workspace_id", workspaceId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    isPrimary: Boolean(l.is_primary),
  }));
}

export { listWorkspaceLocations };

export type TransferListItem = {
  id: string;
  status: TransferStatus;
  createdAt: string;
  fromLocationName: string;
  toLocationName: string;
  lineCount: number;
};

export async function listTransfers(
  workspaceId: string,
  opts?: ListPageOpts,
): Promise<ListPageResult<TransferListItem>> {
  const supabase = createServiceClient();
  const window = resolveListWindow(opts);
  const q = sanitizeSearch(opts?.q);
  const locs = await listWorkspaceLocations(workspaceId);
  const nameById = new Map(locs.map((l) => [l.id, l.name]));

  let query = supabase
    .from("inventory_transfers")
    .select(
      "id, status, created_at, from_location_id, to_location_id, inventory_transfer_lines(id)",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (q) {
    const locIds = locs
      .filter((l) => l.name.toLowerCase().includes(q.toLowerCase()))
      .map((l) => l.id);
    if (locIds.length) {
      query = query.or(
        `from_location_id.in.(${locIds.join(",")}),to_location_id.in.(${locIds.join(",")})`,
      );
    } else {
      return { rows: [], total: 0 };
    }
  }

  const { data, error, count } = await query.range(window.from, window.to);
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((t) => ({
    id: t.id as string,
    status: t.status as TransferStatus,
    createdAt: t.created_at as string,
    fromLocationName: nameById.get(t.from_location_id as string) ?? "—",
    toLocationName: nameById.get(t.to_location_id as string) ?? "—",
    lineCount: ((t.inventory_transfer_lines ?? []) as unknown[]).length,
  }));
  return { rows, total: count ?? rows.length };
}

export async function getTransfer(
  workspaceId: string,
  transferId: string,
): Promise<TransferDetail | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inventory_transfers")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", transferId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: lines, error: lineErr } = await supabase
    .from("inventory_transfer_lines")
    .select("id, product_variant_id, qty")
    .eq("transfer_id", transferId);
  if (lineErr) throw new Error(lineErr.message);

  const variantIds = (lines ?? []).map((l) => l.product_variant_id as string);
  const [{ data: variants }, locs] = await Promise.all([
    variantIds.length
      ? supabase
          .from("product_variants")
          .select("id, title, sku")
          .eq("workspace_id", workspaceId)
          .in("id", variantIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string; sku: string | null }> }),
    listWorkspaceLocations(workspaceId),
  ]);
  const vMap = new Map(
    (variants ?? []).map((v) => [
      v.id as string,
      { title: v.title as string, sku: (v.sku as string | null) ?? null },
    ]),
  );
  const nameById = new Map(locs.map((l) => [l.id, l.name]));

  return {
    id: data.id as string,
    workspaceId: data.workspace_id as string,
    fromLocationId: data.from_location_id as string,
    fromLocationName: nameById.get(data.from_location_id as string) ?? "—",
    toLocationId: data.to_location_id as string,
    toLocationName: nameById.get(data.to_location_id as string) ?? "—",
    status: data.status as TransferStatus,
    notes: (data.notes as string | null) ?? null,
    createdAt: data.created_at as string,
    shippedAt: (data.shipped_at as string | null) ?? null,
    receivedAt: (data.received_at as string | null) ?? null,
    lines: (lines ?? []).map((l) => {
      const meta = vMap.get(l.product_variant_id as string);
      return {
        id: l.id as string,
        productVariantId: l.product_variant_id as string,
        title: meta?.title ?? "—",
        sku: meta?.sku ?? null,
        qty: Number(l.qty),
      };
    }),
  };
}

export async function createTransfer(opts: {
  workspaceId: string;
  fromLocationId: string;
  toLocationId: string;
  notes?: string | null;
  lines: TransferLineInput[];
}): Promise<{ id: string }> {
  if (opts.fromLocationId === opts.toLocationId) {
    throw new Error("From and to locations must differ");
  }
  const lines = opts.lines.filter((l) => l.productVariantId && l.qty > 0);
  if (!lines.length) throw new Error("Add at least one line");

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inventory_transfers")
    .insert({
      workspace_id: opts.workspaceId,
      from_location_id: opts.fromLocationId,
      to_location_id: opts.toLocationId,
      status: "draft",
      notes: opts.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: lineErr } = await supabase
    .from("inventory_transfer_lines")
    .insert(
      lines.map((l) => ({
        transfer_id: data.id,
        product_variant_id: l.productVariantId,
        qty: Math.floor(l.qty),
      })),
    );
  if (lineErr) throw new Error(lineErr.message);
  return { id: data.id as string };
}

export async function markTransferInTransit(
  workspaceId: string,
  transferId: string,
) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("mark_transfer_in_transit", {
    p_workspace_id: workspaceId,
    p_transfer_id: transferId,
  });
  if (error) throw new Error(error.message);
  return data as { transfer_id: string; status: string; movements: unknown[] };
}

export async function receiveTransfer(workspaceId: string, transferId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("receive_transfer", {
    p_workspace_id: workspaceId,
    p_transfer_id: transferId,
  });
  if (error) throw new Error(error.message);
  return data as { transfer_id: string; status: string; movements: unknown[] };
}

export type StocktakeListItem = {
  id: string;
  locationName: string;
  status: StocktakeStatus;
  startedAt: string;
  completedAt: string | null;
  lineCount: number;
};

export async function listStocktakes(
  workspaceId: string,
  opts?: ListPageOpts,
): Promise<ListPageResult<StocktakeListItem>> {
  const supabase = createServiceClient();
  const window = resolveListWindow(opts);
  const q = sanitizeSearch(opts?.q);
  const locs = await listWorkspaceLocations(workspaceId);
  const nameById = new Map(locs.map((l) => [l.id, l.name]));

  let query = supabase
    .from("stocktakes")
    .select(
      "id, location_id, status, started_at, completed_at, stocktake_lines(id)",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false });
  if (q) {
    const locIds = locs
      .filter((l) => l.name.toLowerCase().includes(q.toLowerCase()))
      .map((l) => l.id);
    if (locIds.length) {
      query = query.in("location_id", locIds);
    } else {
      return { rows: [], total: 0 };
    }
  }

  const { data, error, count } = await query.range(window.from, window.to);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((s) => ({
    id: s.id as string,
    locationName: nameById.get(s.location_id as string) ?? "—",
    status: s.status as StocktakeStatus,
    startedAt: s.started_at as string,
    completedAt: (s.completed_at as string | null) ?? null,
    lineCount: ((s.stocktake_lines ?? []) as unknown[]).length,
  }));
  return { rows, total: count ?? rows.length };
}

export async function getStocktake(
  workspaceId: string,
  stocktakeId: string,
): Promise<StocktakeDetail | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("stocktakes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", stocktakeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: lines, error: lineErr } = await supabase
    .from("stocktake_lines")
    .select("id, product_variant_id, expected_qty, counted_qty, variance")
    .eq("stocktake_id", stocktakeId);
  if (lineErr) throw new Error(lineErr.message);

  const variantIds = (lines ?? []).map((l) => l.product_variant_id as string);
  const [{ data: variants }, locs] = await Promise.all([
    variantIds.length
      ? supabase
          .from("product_variants")
          .select("id, title, sku")
          .eq("workspace_id", workspaceId)
          .in("id", variantIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string; sku: string | null }> }),
    listWorkspaceLocations(workspaceId),
  ]);
  const vMap = new Map(
    (variants ?? []).map((v) => [
      v.id as string,
      { title: v.title as string, sku: (v.sku as string | null) ?? null },
    ]),
  );
  const nameById = new Map(locs.map((l) => [l.id, l.name]));

  return {
    id: data.id as string,
    workspaceId: data.workspace_id as string,
    locationId: data.location_id as string,
    locationName: nameById.get(data.location_id as string) ?? "—",
    status: data.status as StocktakeStatus,
    notes: (data.notes as string | null) ?? null,
    startedAt: data.started_at as string,
    completedAt: (data.completed_at as string | null) ?? null,
    lines: (lines ?? []).map((l) => {
      const meta = vMap.get(l.product_variant_id as string);
      return {
        id: l.id as string,
        productVariantId: l.product_variant_id as string,
        title: meta?.title ?? "—",
        sku: meta?.sku ?? null,
        expectedQty: Number(l.expected_qty),
        countedQty: l.counted_qty == null ? null : Number(l.counted_qty),
        variance: l.variance == null ? null : Number(l.variance),
      };
    }),
  };
}

/** Start stocktake: seed lines from current on_hand at location. */
export async function createStocktake(opts: {
  workspaceId: string;
  locationId: string;
  notes?: string | null;
}): Promise<{ id: string }> {
  const supabase = createServiceClient();
  const { data: levels, error: levErr } = await supabase
    .from("inventory_levels")
    .select("product_variant_id, on_hand")
    .eq("workspace_id", opts.workspaceId)
    .eq("location_id", opts.locationId);
  if (levErr) throw new Error(levErr.message);
  if (!(levels ?? []).length) {
    throw new Error("No inventory at this location to count");
  }

  const { data, error } = await supabase
    .from("stocktakes")
    .insert({
      workspace_id: opts.workspaceId,
      location_id: opts.locationId,
      status: "in_progress",
      notes: opts.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: lineErr } = await supabase.from("stocktake_lines").insert(
    (levels ?? []).map((l) => ({
      stocktake_id: data.id,
      product_variant_id: l.product_variant_id,
      expected_qty: Number(l.on_hand ?? 0),
      counted_qty: null,
    })),
  );
  if (lineErr) throw new Error(lineErr.message);
  return { id: data.id as string };
}

export async function updateStocktakeCounts(
  workspaceId: string,
  stocktakeId: string,
  counts: Array<{ lineId: string; countedQty: number }>,
): Promise<void> {
  const supabase = createServiceClient();
  const { data: st } = await supabase
    .from("stocktakes")
    .select("id, status")
    .eq("id", stocktakeId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!st) throw new Error("Stocktake not found");
  if (st.status !== "in_progress") {
    throw new Error("Stocktake is not in progress");
  }

  for (const c of counts) {
    const { error } = await supabase
      .from("stocktake_lines")
      .update({ counted_qty: Math.max(0, Math.floor(c.countedQty)) })
      .eq("id", c.lineId)
      .eq("stocktake_id", stocktakeId);
    if (error) throw new Error(error.message);
  }
}

export async function completeStocktake(
  workspaceId: string,
  stocktakeId: string,
) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("complete_stocktake", {
    p_workspace_id: workspaceId,
    p_stocktake_id: stocktakeId,
  });
  if (error) throw new Error(error.message);
  return data as {
    stocktake_id: string;
    status: string;
    adjustments: unknown[];
  };
}
