/**
 * COGS calculator smoke test (Salt & Fern).
 *
 *   npx tsx --env-file=embedded/.env scripts/test-cogs.ts
 */
const SALT_FERN_ID = "eb7e12e6-4572-466a-8424-71cc515502cd";

async function main() {
  const {
    computeCogsReport,
    setCogsMethod,
    getCogsSettings,
    cogsFeatureLabel,
    cogsCardTitle,
  } = await import("../embedded/app/lib/cogs.server.ts");
  const { runReportTemplate } = await import(
    "../embedded/app/lib/report-builder.server.ts"
  );
  const { mapPromptToReportTemplate } = await import(
    "../embedded/app/lib/report-prompt.server.ts"
  );

  await setCogsMethod(SALT_FERN_ID, "weighted_average");
  const settings = await getCogsSettings(SALT_FERN_ID);
  console.log("Settings:", settings, cogsCardTitle(settings.method));

  const wa = await computeCogsReport(SALT_FERN_ID, { lookbackDays: 90 });
  console.log("\n=== Weighted Average ===");
  console.log(wa.featureLabel);
  console.log("Period:", wa.periodFrom, "→", wa.periodTo);
  console.log("Total COGS:", wa.totalCogs, "units:", wa.totalUnits);
  console.log(
    "Top lines:",
    wa.lines.slice(0, 5).map((l) => ({
      title: l.title,
      kind: l.kind,
      units: l.units,
      cogs: l.cogs,
      source: l.costSource,
    })),
  );

  await setCogsMethod(SALT_FERN_ID, "fifo");
  const fifo = await computeCogsReport(SALT_FERN_ID, { lookbackDays: 90 });
  console.log("\n=== FIFO ===");
  console.log(cogsFeatureLabel(fifo.method));
  console.log("Total COGS:", fifo.totalCogs, "units:", fifo.totalUnits);
  console.log(
    "Top lines:",
    fifo.lines.slice(0, 5).map((l) => ({
      title: l.title,
      kind: l.kind,
      units: l.units,
      cogs: l.cogs,
      source: l.costSource,
    })),
  );

  const match = await mapPromptToReportTemplate(
    "What's my real COGS by product?",
  );
  console.log("\nPrompt match:", match);

  const report = await runReportTemplate({
    workspaceId: SALT_FERN_ID,
    templateId: "cogs_by_product",
    params: { lookback_days: 90 },
  });
  console.log("\nReport title:", report.title);
  console.log("Summary:", report.summary);
  console.log("Rows:", report.rows.length);

  // Restore default
  await setCogsMethod(SALT_FERN_ID, "weighted_average");
  console.log("\nRestored Weighted Average default");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
