import { createServiceClient } from "./supabase.server";
import { normalizeShopDomain } from "./format";

export type WorkspaceRow = {
  id: string;
  name: string;
  shopify_domain: string | null;
  shopify_synced_at: string | null;
  is_demo: boolean;
};

/**
 * Auth bridge: resolve (or create) a Supabase workspace for the installed shop.
 * Merchant identity is the shop domain — no Supabase Auth login on the embedded surface.
 *
 * If the shop is new and exactly one non-demo workspace has no shopify_domain yet
 * (e.g. Salt & Fern bootstrapped via Next.js signup), claim that workspace.
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
  const displayName = opts.shopName?.trim() || domain.replace(".myshopify.com", "");

  const { data: existing, error: lookupErr } = await supabase
    .from("workspaces")
    .select("id, name, shopify_domain, shopify_synced_at, is_demo")
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
    const { data: unclaimed, error: unclaimedErr } = await supabase
      .from("workspaces")
      .select("id, name, shopify_domain, shopify_synced_at, is_demo")
      .is("shopify_domain", null)
      .eq("is_demo", false);
    if (unclaimedErr) throw new Error(unclaimedErr.message);

    // TODO(install-flow): Claiming "the sole unclaimed non-demo workspace" is a
    // one-time bootstrap hack for the Salt & Fern → embedded pivot. It breaks as
    // soon as a second real merchant store installs (ambiguous claim, or wrong
    // workspace linked). Replace with real multi-workspace install handling
    // (explicit link UI, Partner install metadata, or create-always + migrate)
    // before any second real store connects. Do not silently trust this path.
    if (unclaimed && unclaimed.length === 1) {
      const claim = unclaimed[0] as WorkspaceRow;
      const { data: updated, error: claimErr } = await supabase
        .from("workspaces")
        .update({ shopify_domain: domain })
        .eq("id", claim.id)
        .select("id, name, shopify_domain, shopify_synced_at, is_demo")
        .single();
      if (claimErr) throw new Error(claimErr.message);
      workspace = updated as WorkspaceRow;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("workspaces")
        .insert({ name: displayName, shopify_domain: domain })
        .select("id, name, shopify_domain, shopify_synced_at, is_demo")
        .single();
      if (createErr) throw new Error(createErr.message);
      workspace = created as WorkspaceRow;

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
    }
  }

  // Skip write when the offline token is unchanged (every navigation hits this path).
  const { data: existingCred } = await supabase
    .from("workspace_shopify_credentials")
    .select("access_token")
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (existingCred?.access_token !== opts.accessToken) {
    const { error: credErr } = await supabase
      .from("workspace_shopify_credentials")
      .upsert(
        {
          workspace_id: workspace.id,
          access_token: opts.accessToken,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" },
      );
    if (credErr) throw new Error(credErr.message);
  }

  return workspace;
}
