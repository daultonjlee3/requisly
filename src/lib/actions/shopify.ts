"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  normalizeShopDomain,
  shopifyAuthorizeUrl,
  signOAuthState,
} from "@/lib/shopify/oauth";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export async function startShopifyOAuth(formData: FormData) {
  const { profile, workspace } = await getSessionContext();
  if (!profile || !workspace) throw new Error("Not authenticated");

  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!process.env.SHOPIFY_API_KEY || !apiSecret) {
    throw new Error(
      "Shopify app credentials are not configured on the server",
    );
  }

  const shop = normalizeShopDomain(String(formData.get("shop") ?? ""));
  if (!shop) {
    redirect("/onboarding?error=" + encodeURIComponent("Enter a valid .myshopify.com domain"));
  }

  // Bind OAuth to the merchant's *active* workspace (Salt & Fern when selected).
  const state = signOAuthState(workspace.id, apiSecret);
  redirect(shopifyAuthorizeUrl(shop, state));
}

export async function resyncShopifyCatalog(): Promise<{
  ok: boolean;
  message: string;
  locations?: number;
  variants?: number;
  inventoryLevels?: number;
}> {
  const { profile, workspace, user } = await getSessionContext();
  if (!profile || !workspace || !user) {
    return { ok: false, message: "Not authenticated" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, message: "Supabase is not configured" };
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, message: "No session" };
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/shopify-sync-catalog`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspace_id: workspace.id }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    locations?: number;
    variants?: number;
    inventoryLevels?: number;
  };

  if (!res.ok) {
    return {
      ok: false,
      message: json.error ?? `Sync failed (${res.status})`,
    };
  }

  revalidatePath("/products");
  revalidatePath("/purchase-orders/new");
  revalidatePath("/onboarding");

  return {
    ok: true,
    message: `Synced ${json.variants ?? 0} variants, ${json.locations ?? 0} locations, ${json.inventoryLevels ?? 0} inventory rows`,
    locations: json.locations,
    variants: json.variants,
    inventoryLevels: json.inventoryLevels,
  };
}
