/**
 * Run Report Builder templates against Salt & Fern (real workspace).
 *
 *   npx tsx --env-file=embedded/.env scripts/report-salt-fern.ts
 */
const SALT_FERN_ID = "eb7e12e6-4572-466a-8424-71cc515502cd";

async function main() {
  const { runReportTemplate, REPORT_TEMPLATES } = await import(
    "../embedded/app/lib/report-builder.server.ts"
  );
  const { createClient } = await import("@supabase/supabase-js");
  const { existsSync, readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");

  for (const rel of ["embedded/.env", ".env.local", ".env"]) {
    const p = resolve(process.cwd(), rel);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: ws } = await supabase
    .from("workspaces")
    .select("id, name, shopify_domain, orders_synced_at, is_demo")
    .eq("id", SALT_FERN_ID)
    .single();
  console.log("workspace:", ws);

  const { count: orderCount } = await supabase
    .from("shopify_orders")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", SALT_FERN_ID);
  const { count: poCount } = await supabase
    .from("purchase_orders")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", SALT_FERN_ID);
  console.log("shopify_orders_rows:", orderCount);
  console.log("purchase_orders_rows:", poCount);

  const ids = ["margin_by_supplier", "spend_vs_revenue_by_supplier"];
  const outReports = [];

  for (const id of ids) {
    const meta = REPORT_TEMPLATES.find((t) => t.id === id)!;
    console.log(`\n=== ${meta.question} ===`);
    console.log(`needsOrders: ${meta.needsOrders}`);
    const result = await runReportTemplate({
      workspaceId: SALT_FERN_ID,
      templateId: id,
    });
    console.log(`Title: ${result.title}`);
    console.log(`Timing: ${result.timingMs}ms · ${result.narrationSource}`);
    console.log(`Summary: ${result.summary}`);
    if (result.body) console.log(`Body: ${result.body}`);
    if (result.emptyReason) console.log(`Empty: ${result.emptyReason}`);
    console.log(`Columns: ${result.columns.join(" | ")}`);
    for (const row of result.rows.slice(0, 12)) {
      console.log("  " + row.map((c) => (c == null ? "—" : String(c))).join(" | "));
    }
    if (result.chart) {
      console.log(
        `Chart: ${result.chart.type} — ${result.chart.title} (${result.chart.series.map((s) => s.name).join(", ")})`,
      );
    }
    outReports.push({
      id,
      question: meta.question,
      needsOrders: meta.needsOrders,
      title: result.title,
      summary: result.summary,
      body: result.body,
      emptyReason: result.emptyReason,
      timingMs: result.timingMs,
      narrationSource: result.narrationSource,
      columns: result.columns,
      rows: result.rows,
      chart: result.chart,
    });
  }

  const fs = await import("node:fs");
  fs.mkdirSync("tmp", { recursive: true });
  fs.writeFileSync(
    "tmp/report-builder-salt-fern.json",
    JSON.stringify(
      {
        workspace: ws,
        shopify_orders_rows: orderCount,
        purchase_orders_rows: poCount,
        generatedAt: new Date().toISOString(),
        reports: outReports,
      },
      null,
      2,
    ),
  );
  console.log("\nWrote tmp/report-builder-salt-fern.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
