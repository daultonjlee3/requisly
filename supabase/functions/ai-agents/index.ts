import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Scheduled in-lane agents (Operations / Supplier / Procurement).
 * Auth: Authorization: Bearer $CRON_SECRET (or $AI_AGENTS_SECRET)
 *
 * Prefer invoking the Node engine via APP_URL/api/cron/ai-agents when the
 * Next app is deployed (shared code path). Falls back to a Deno-local
 * Operations digest if APP_URL is unset — Supplier/Procurement full engine
 * lives in embedded/app/lib/ai-agents.server.ts and the Next cron route.
 */

Deno.serve(async (req: Request) => {
  const secret =
    Deno.env.get("AI_AGENTS_SECRET") ?? Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const appUrl = (
    Deno.env.get("APP_URL") ??
    Deno.env.get("NEXT_PUBLIC_APP_URL") ??
    ""
  ).replace(/\/$/, "");

  if (appUrl) {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const workspaceId = url.searchParams.get("workspace_id") ?? "";
    const target = new URL(`${appUrl}/api/cron/ai-agents`);
    if (force) target.searchParams.set("force", "1");
    if (workspaceId) target.searchParams.set("workspace_id", workspaceId);

    const proxied = await fetch(target.toString(), {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await proxied.text();
    return new Response(body, {
      status: proxied.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Local/dev fallback: Operations digest only via service role.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({
        error:
          "Set APP_URL to proxy to /api/cron/ai-agents, or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for Deno fallback",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const today = new Date().toISOString().slice(0, 10);
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name, is_demo");

  const results: unknown[] = [];
  for (const ws of workspaces ?? []) {
    const { count } = await supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws.id)
      .eq("status", "closed");
    const closed = count ?? 0;
    if (!ws.is_demo && closed < 5) {
      results.push({
        workspaceId: ws.id,
        eligible: false,
        reason: `Need 5 closed POs (have ${closed})`,
      });
      continue;
    }

    const [waiting, overdue, arriving, ready] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id)
        .in("status", ["sent", "viewed"]),
      supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id)
        .in("status", ["sent", "viewed", "confirmed", "production"])
        .lt("requested_ship_date", today),
      supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id)
        .or(
          `confirmed_ship_date.eq.${today},requested_ship_date.eq.${today}`,
        )
        .in("status", ["confirmed", "production", "shipped", "in_transit"]),
      supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id)
        .in("status", ["shipped", "in_transit", "partially_received"]),
    ]);

    const w = waiting.count ?? 0;
    const o = overdue.count ?? 0;
    const a = arriving.count ?? 0;
    const r = ready.count ?? 0;
    const summary = `Good morning. ${w} POs waiting confirmation. ${o} overdue. ${a} arriving today. ${r} ready to receive.`;
    const body = [
      summary,
      "",
      "Today's Work",
      `• Waiting confirmation: ${w}`,
      `• Overdue: ${o}`,
      `• Arriving today: ${a}`,
      `• Ready to receive: ${r}`,
      "",
      "— Requisly Operations Agent (Edge fallback)",
    ].join("\n");

    await supabase.from("ai_insights").insert({
      workspace_id: ws.id,
      agent: "operations",
      insight_type: "daily_digest",
      summary,
      body,
      supporting_data: {
        subject: `Requisly digest — ${ws.name}`,
        counts: { waiting: w, overdue: o, arriving: a, ready: r },
        source: "edge_fallback",
      },
    });

    results.push({
      workspaceId: ws.id,
      workspaceName: ws.name,
      eligible: true,
      digest: { subject: `Requisly digest — ${ws.name}`, body },
    });
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
