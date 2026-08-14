import { createServiceClient } from "./supabase.server";
import { normalizeShopDomain } from "./format";

export type WorkspaceRow = {
  id: string;
  name: string;
  shopify_domain: string | null;
  shopify_synced_at: string | null;
  orders_synced_at: string | null;
  is_demo: boolean;
};

const WORKSPACE_SELECT =
  "id, name, shopify_domain, shopify_synced_at, orders_synced_at, is_demo" as const;

/**
 * Auth bridge: resolve (or create) a Supabase workspace for the installed shop.
 * Merchant identity is the shop domain — no Supabase Auth login on the embedded surface.
 *
 * Claiming rules:
 * 1. If a workspace already has this shopify_domain → reuse it (covers reinstall
 *    after soft uninstall, and every subsequent Admin open).
 * 2. Otherwise create a NEW workspace scoped to that domain.
 * 3. Never attach a shop to an "unclaimed" workspace that already exists for
 *    another merchant / signup flow. Pre-Shopify signup workspaces must be
 *    linked explicitly (out of band), not stolen on install.
 */
export async function ensureWorkspaceForShop(opts: {
  shop: string;
  shopName?: string | null;
  accessToken: string;
}): Promise<WorkspaceRow> {
  const domain = normalizeShopDomain(opts.shop);
  if (!domain) {
    throw new Error(`Invalid shop domain: ${opts.shop}`);
  }

  const supabase = createServiceClient();
  const displayName =
    opts.shopName?.trim() || domain.replace(".myshopify.com", "");

  const { data: existing, error: lookupErr } = await supabase
    .from("workspaces")
    .select(WORKSPACE_SELECT)
    .eq("shopify_domain", domain)
    .maybeSingle();
  if (lookupErr) throw new Error(lookupErr.message);

  let workspace: WorkspaceRow;

  if (existing) {
    workspace = existing as WorkspaceRow;
    if (opts.shopName && workspace.name !== opts.shopName) {
      // Keep merchant-chosen names; only fill if still a placeholder domain slug.
      const isPlaceholder =
        workspace.name === domain ||
        workspace.name === domain.replace(".myshopify.com", "");
      if (isPlaceholder) {
        await supabase
          .from("workspaces")
          .update({ name: displayName })
          .eq("id", workspace.id);
        workspace = { ...workspace, name: displayName };
      }
    }
  } else {
    workspace = await createWorkspaceForShop({
      supabase,
      domain,
      displayName,
    });
  }

  await upsertShopCredentials({
    supabase,
    workspaceId: workspace.id,
    domain,
    accessToken: opts.accessToken,
  });

  return workspace;
}

async function createWorkspaceForShop(opts: {
  supabase: ReturnType<typeof createServiceClient>;
  domain: string;
  displayName: string;
}): Promise<WorkspaceRow> {
  const { supabase, domain, displayName } = opts;

  const { data: created, error: createErr } = await supabase
    .from("workspaces")
    .insert({ name: displayName, shopify_domain: domain })
    .select(WORKSPACE_SELECT)
    .single();

  if (createErr) {
    // Concurrent install for the same shop — unique(shopify_domain) won the race.
    if (createErr.code === "23505") {
      const { data: raced, error: raceErr } = await supabase
        .from("workspaces")
        .select(WORKSPACE_SELECT)
        .eq("shopify_domain", domain)
        .maybeSingle();
      if (raceErr) throw new Error(raceErr.message);
      if (raced) return raced as WorkspaceRow;
    }
    throw new Error(createErr.message);
  }

  const workspace = created as WorkspaceRow;

  const { error: locErr } = await supabase.from("locations").insert({
    workspace_id: workspace.id,
    name: "Primary",
    is_primary: true,
  });
  if (locErr) throw new Error(locErr.message);

  const { error: rulesErr } = await supabase.from("notification_rules").insert([
    {
      workspace_id: workspace.id,
      rule_type: "po_not_confirmed",
      enabled: true,
      threshold_value: 2,
    },
    {
      workspace_id: workspace.id,
      rule_type: "shipment_delayed",
      enabled: true,
      threshold_value: null,
    },
    {
      workspace_id: workspace.id,
      rule_type: "arriving_soon",
      enabled: true,
      threshold_value: 1,
    },
    {
      workspace_id: workspace.id,
      rule_type: "inventory_low",
      enabled: true,
      threshold_value: null,
    },
  ]);
  if (rulesErr) throw new Error(rulesErr.message);

  return workspace;
}

async function upsertShopCredentials(opts: {
  supabase: ReturnType<typeof createServiceClient>;
  workspaceId: string;
  domain: string;
  accessToken: string;
}) {
  const { supabase, workspaceId, domain, accessToken } = opts;

  // Skip write when the offline token is unchanged (every navigation hits this path).
  const { data: existingCred } = await supabase
    .from("workspace_shopify_credentials")
    .select("access_token, shopify_domain")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (
    existingCred?.access_token === accessToken &&
    existingCred?.shopify_domain === domain
  ) {
    return;
  }

  const { error: credErr } = await supabase
    .from("workspace_shopify_credentials")
    .upsert(
      {
        workspace_id: workspaceId,
        shopify_domain: domain,
        access_token: accessToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );
  if (credErr) throw new Error(credErr.message);
}
