import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  normalizeShopDomain,
  SHOPIFY_SCOPES,
  syncShopifyCatalog,
  verifyOAuthState,
  verifyShopifyOAuthHmac,
} from "./shopify.ts";

Deno.serve(async (req: Request) => {
  const appUrl = Deno.env.get("APP_URL") ?? Deno.env.get("NEXT_PUBLIC_APP_URL");
  const apiKey = Deno.env.get("SHOPIFY_API_KEY");
  const apiSecret = Deno.env.get("SHOPIFY_API_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!appUrl || !apiKey || !apiSecret || !supabaseUrl || !serviceKey) {
    return new Response("Shopify OAuth is not configured", { status: 500 });
  }

  try {
    const url = new URL(req.url);

    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const okHmac = await verifyShopifyOAuthHmac(url.searchParams, apiSecret);
    if (!okHmac) {
      return Response.redirect(
        `${appUrl}/onboarding?error=${encodeURIComponent("Invalid Shopify signature")}`,
        302,
      );
    }

    const shopRaw = url.searchParams.get("shop") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const shop = normalizeShopDomain(shopRaw);

    if (!shop || !code || !state) {
      return Response.redirect(
        `${appUrl}/onboarding?error=${encodeURIComponent("Missing OAuth parameters")}`,
        302,
      );
    }

    const payload = await verifyOAuthState(state, apiSecret);
    if (!payload) {
      return Response.redirect(
        `${appUrl}/onboarding?error=${encodeURIComponent("OAuth state expired or invalid")}`,
        302,
      );
    }

    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("Token exchange failed", tokenRes.status, body);
      return Response.redirect(
        `${appUrl}/onboarding?error=${encodeURIComponent("Shopify token exchange failed")}`,
        302,
      );
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token: string;
      scope?: string;
    };

    if (!tokenJson.access_token) {
      return Response.redirect(
        `${appUrl}/onboarding?error=${encodeURIComponent("No access token returned")}`,
        302,
      );
    }

    // Soft check — Shopify may return a subset; log if write_inventory missing.
    const granted = (tokenJson.scope ?? "").split(",");
    for (const needed of SHOPIFY_SCOPES.split(",")) {
      if (!granted.includes(needed)) {
        console.warn(`Shopify scope missing: ${needed}`);
      }
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: member } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", payload.workspaceId)
      .limit(1)
      .maybeSingle();

    if (!member) {
      return Response.redirect(
        `${appUrl}/onboarding?error=${encodeURIComponent("Workspace not found")}`,
        302,
      );
    }

    // Domain is unique — clear any stale claim from another workspace first? No —
    // unique violation should surface as a clear error.
    const { error: domainErr } = await supabase
      .from("workspaces")
      .update({ shopify_domain: shop })
      .eq("id", payload.workspaceId);

    if (domainErr) {
      console.error(domainErr);
      return Response.redirect(
        `${appUrl}/onboarding?error=${encodeURIComponent(domainErr.message)}`,
        302,
      );
    }

    const { error: credErr } = await supabase
      .from("workspace_shopify_credentials")
      .upsert({
        workspace_id: payload.workspaceId,
        access_token: tokenJson.access_token,
        updated_at: new Date().toISOString(),
      });

    if (credErr) {
      console.error(credErr);
      return Response.redirect(
        `${appUrl}/onboarding?error=${encodeURIComponent(credErr.message)}`,
        302,
      );
    }

    try {
      await syncShopifyCatalog({
        supabase,
        workspaceId: payload.workspaceId,
        shop,
        accessToken: tokenJson.access_token,
      });
    } catch (syncErr) {
      console.error("Initial sync failed", syncErr);
      return Response.redirect(
        `${appUrl}/products?shopify=connected&sync=error&message=${encodeURIComponent(
          syncErr instanceof Error ? syncErr.message : "Sync failed",
        )}`,
        302,
      );
    }

    return Response.redirect(
      `${appUrl}/products?shopify=connected&sync=ok`,
      302,
    );
  } catch (err) {
    console.error(err);
    return Response.redirect(
      `${appUrl}/onboarding?error=${encodeURIComponent(
        err instanceof Error ? err.message : "OAuth failed",
      )}`,
      302,
    );
  }
});
