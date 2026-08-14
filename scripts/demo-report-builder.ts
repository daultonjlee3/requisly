/**
 * Run starter Report Builder templates against the demo workspace.
 *
 *   npx tsx --env-file=embedded/.env scripts/demo-report-builder.ts
 */
const DEMO_ID = "d9ddbe22-1e49-4be3-9bd0-b6750008af63";

async function main() {
  const { runReportTemplate, REPORT_TEMPLATES } = await import(
    "../embedded/app/lib/report-builder.server.ts"
  );

  const starters = REPORT_TEMPLATES.filter((t) => t.starter).slice(0, 3);
  // Prefer the three killer cross-joins first
  const preferred = [
    "margin_by_supplier",
    "spend_vs_revenue_by_supplier",
    "profit_vs_reliability",
  ];
  const ids = preferred.filter((id) =>
    REPORT_TEMPLATES.some((t) => t.id === id),
  );

  const results = [];
  for (const id of ids) {
    const meta = REPORT_TEMPLATES.find((t) => t.id === id)!;
    console.log(`\n=== ${meta.question} ===`);
    const result = await runReportTemplate({
      workspaceId: DEMO_ID,
      templateId: id,
    });
    console.log(`Title: ${result.title}`);
    console.log(`Timing: ${result.timingMs}ms · ${result.narrationSource}`);
    console.log(`Summary: ${result.summary}`);
    if (result.body) console.log(`Body: ${result.body}`);
    if (result.emptyReason) console.log(`Empty: ${result.emptyReason}`);
    console.log(`Columns: ${result.columns.join(" | ")}`);
    for (const row of result.rows.slice(0, 8)) {
      console.log("  " + row.map((c) => (c == null ? "—" : String(c))).join(" | "));
    }
    if (result.chart) {
      console.log(
        `Chart: ${result.chart.type} — ${result.chart.title} (${result.chart.series.map((s) => s.name).join(", ")})`,
      );
    }
    console.log(
      `Follow-ups: ${result.followUps.map((f) => f.label).join(" · ")}`,
    );
    results.push({ meta, result });
  }

  // Write JSON for canvas embedding
  const fs = await import("node:fs");
  const out = {
    workspaceId: DEMO_ID,
    generatedAt: new Date().toISOString(),
    reports: results.map(({ meta, result }) => ({
      question: meta.question,
      title: result.title,
      summary: result.summary,
      body: result.body,
      timingMs: result.timingMs,
      narrationSource: result.narrationSource,
      columns: result.columns,
      rows: result.rows,
      chart: result.chart,
      followUps: result.followUps.map((f) => f.label),
    })),
  };
  fs.writeFileSync(
    "tmp/report-builder-demo.json",
    JSON.stringify(out, null, 2),
  );
  console.log("\nWrote tmp/report-builder-demo.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
