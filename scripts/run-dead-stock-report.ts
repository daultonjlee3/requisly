/**
 *   npx tsx --env-file=embedded/.env scripts/run-dead-stock-report.ts
 */
const WS = "eb7e12e6-4572-466a-8424-71cc515502cd";

async function main() {
  const { runReportTemplate, REPORT_TEMPLATES } = await import(
    "../embedded/app/lib/report-builder.server.ts"
  );
  const { mapPromptToReportTemplate } = await import(
    "../embedded/app/lib/report-prompt.server.ts"
  );

  console.log(
    "template:",
    REPORT_TEMPLATES.find((t) => t.id === "dead_stock"),
  );
  console.log(
    "prompt_match:",
    await mapPromptToReportTemplate("What's not selling?"),
  );

  const result = await runReportTemplate({
    workspaceId: WS,
    templateId: "dead_stock",
    params: { limit: 10 },
  });
  console.log(
    JSON.stringify(
      {
        title: result.title,
        summary: result.summary,
        body: result.body,
        emptyReason: result.emptyReason,
        row_count: result.rows.length,
        columns: result.columns,
        sample_rows: result.rows.slice(0, 6),
        narrationSource: result.narrationSource,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
