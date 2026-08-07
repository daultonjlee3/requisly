import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  shouldSyncCatalog,
  syncShopifyCatalogGraphql,
  type SyncCounts,
} from "./shopify-sync.server";
import {
  ensureWorkspaceForShop,
  type WorkspaceRow,
} from "./workspace.server";
import { normalizeShopDomain } from "./format";
import { startTimer } from "./timing.server";

type AdminContext = Awaited<ReturnType<typeof authenticate.admin>>;

export type MerchantContext = {
  workspace: WorkspaceRow;
  shopDomain: string;
  shopName: string;
  /** Completed sync counts (only when sync was awaited, e.g. sync: true). */
  sync: SyncCounts | null;
  syncError: string | null;
  /** True when a background catalog refresh was kicked off (page did not wait). */
  catalogSyncPending: boolean;
  admin: AdminContext["admin"];
  session: AdminContext["session"];
  /** App Bridge–safe redirect — prefer over Remix `redirect` in loaders/actions. */
  redirect: AdminContext["redirect"];
};

/**
 * Authenticate with Shopify, bridge to a Supabase workspace, optionally refresh catalog.
 *
 * sync: "auto" — if stale, kick off catalog sync in the background and return immediately
 *                with last-synced data (non-blocking for p95).
 * sync: true   — await a full sync (manual / explicit callers only).
 * sync: false  — never sync.
 */
export async function getMerchantContext(
  request: LoaderFunctionArgs["request"],
  opts?: { sync?: boolean | "auto" },
): Promise<MerchantContext> {
  const timer = startTimer("getMerchantContext");
  let admin: AdminContext["admin"];
  let session: AdminContext["session"];
  let redirect: AdminContext["redirect"];

  try {
    ({ admin, session, redirect } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) throw err;
    throw new Response(
      err instanceof Error ? err.message : "Shopify session is invalid or expired",
      { status: 401 },
    );
  }

  if (!session.accessToken) {
    throw new Response("Shopify session is missing an access token", {
      status: 401,
    });
  }

  const shopDomain = normalizeShopDomain(session.shop) || session.shop;
  const shopName = shopDomain.replace(/\.myshopify\.com$/i, "");
  const syncMode = opts?.sync ?? "auto";

  let workspace: WorkspaceRow;
  try {
    workspace = await ensureWorkspaceForShop({
      shop: shopDomain,
      shopName,
      accessToken: session.accessToken,
    });
  } catch (err) {
    throw new Response(
      err instanceof Error
        ? `Workspace unavailable: ${err.message}`
        : "Workspace unavailable",
      { status: 503 },
    );
  }

  const needsSync =
    syncMode === true ||
    (syncMode === "auto" && shouldSyncCatalog(workspace.shopify_synced_at));

  let sync: SyncCounts | null = null;
  let syncError: string | null = null;
  let catalogSyncPending = false;

  if (needsSync && syncMode === true) {
    try {
      sync = await syncShopifyCatalogGraphql({
        admin,
        workspaceId: workspace.id,
      });
      workspace.shopify_synced_at = new Date().toISOString();
    } catch (err) {
      syncError = err instanceof Error ? err.message : "Catalog sync failed";
    }
  } else if (needsSync && syncMode === "auto") {
    // Fire-and-forget: page renders with stale catalog; sync continues in-process.
    catalogSyncPending = true;
    const workspaceId = workspace.id;
    void syncShopifyCatalogGraphql({ admin, workspaceId })
      .then((counts) => {
        console.info(
          `[catalog-sync] background ok workspace=${workspaceId} locations=${counts.locations} variants=${counts.variants}`,
        );
      })
      .catch((err) => {
        console.error(
          `[catalog-sync] background failed workspace=${workspaceId}`,
          err instanceof Error ? err.message : err,
        );
      });
  }

  timer.end({
    syncMode: String(syncMode),
    catalogSyncPending,
    awaitedSync: syncMode === true && needsSync,
  });

  return {
    workspace,
    shopDomain,
    shopName: workspace.name || shopName,
    sync,
    syncError,
    catalogSyncPending,
    admin,
    session,
    redirect,
  };
}
