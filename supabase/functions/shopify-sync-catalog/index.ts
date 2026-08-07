import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { syncShopifyCatalog } from "./shopify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as {
      workspace_id?: string;
    };

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await admin
      .from("profiles")
      .select("id, active_workspace_id, workspace_id")
      .eq("id", user.id)
      .maybeSingle();

    const workspaceId =
      body.workspace_id ??
      profile?.active_workspace_id ??
      profile?.workspace_id;

    if (!workspaceId) {
      return json({ error: "No active workspace" }, 400);
    }

    const { data: membership } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return json({ error: "Not a member of this workspace" }, 403);
    }

    const { data: workspace } = await admin
      .from("workspaces")
      .select("id, shopify_domain")
      .eq("id", workspaceId)
      .maybeSingle();

    const { data: creds } = await admin
      .from("workspace_shopify_credentials")
      .select("access_token")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!workspace?.shopify_domain || !creds?.access_token) {
      return json(
        { error: "Shopify is not connected for this workspace" },
        400,
      );
    }

    const counts = await syncShopifyCatalog({
      supabase: admin,
      workspaceId,
      shop: workspace.shopify_domain,
      accessToken: creds.access_token,
    });

    return json({ ok: true, workspace_id: workspaceId, ...counts });
  } catch (err) {
    console.error(err);
    return json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      500,
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
