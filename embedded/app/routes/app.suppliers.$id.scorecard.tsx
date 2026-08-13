import type { LoaderFunctionArgs } from "@remix-run/node";
import { getMerchantContext } from "../lib/merchant.server";
import {
  SCORECARD_MIN_COMPLETED_POS,
  loadSupplierScorecardExport,
} from "../lib/supplier-scorecard.server";
import {
  buildSupplierScorecardPdf,
  scorecardPdfFileName,
} from "../lib/supplier-scorecard-pdf.server";

/**
 * Resource route — streams a one-page supplier scorecard PDF.
 * Requires ≥ SCORECARD_MIN_COMPLETED_POS closed POs.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const supplierId = params.id ?? "";

  const data = await loadSupplierScorecardExport(
    merchant.workspace.id,
    supplierId,
  );
  if (!data) {
    throw new Response("Supplier not found", { status: 404 });
  }
  if (!data.ready) {
    throw new Response(
      `Not enough order history yet (${data.completedPos}/${SCORECARD_MIN_COMPLETED_POS} closed POs).`,
      { status: 400 },
    );
  }

  const pdf = await buildSupplierScorecardPdf(data);
  const fileName = scorecardPdfFileName(data.supplierName);

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
};
