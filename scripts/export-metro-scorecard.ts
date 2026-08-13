/**
 * Generate Metro Labels Inc scorecard PDF from the demo workspace.
 *   npx tsx --env-file=embedded/.env scripts/export-metro-scorecard.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEMO_WS = "d9ddbe22-1e49-4be3-9bd0-b6750008af63";
const METRO_ID = "e0c24688-57ad-46dc-81ef-ed9d5e7835c9";

async function main() {
  const { loadSupplierScorecardExport } = await import(
    "../embedded/app/lib/supplier-scorecard.server.ts"
  );
  const { buildSupplierScorecardPdf, scorecardPdfFileName } = await import(
    "../embedded/app/lib/supplier-scorecard-pdf.server.ts"
  );

  const data = await loadSupplierScorecardExport(DEMO_WS, METRO_ID);
  if (!data) throw new Error("Metro Labels Inc not found");
  if (!data.ready) {
    throw new Error(
      `Not ready: ${data.completedPos} closed POs (need 5+)`,
    );
  }

  const pdf = await buildSupplierScorecardPdf(data);
  const outDir = resolve(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, scorecardPdfFileName(data.supplierName));
  writeFileSync(outPath, pdf);

  console.log(
    JSON.stringify(
      {
        outPath,
        supplier: data.supplierName,
        completedPos: data.completedPos,
        onTimePct: data.onTimePct,
        fillRate: data.fillRate,
        avgLeadVariance: data.avgLeadTimeVarianceDays,
        closedSpend: data.closedSpend,
        trendPoints: data.trend.length,
        bytes: pdf.length,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
