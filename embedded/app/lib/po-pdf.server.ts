import PDFDocument from "pdfkit";
import { money, shortDate } from "./format";

export type PoPdfInput = {
  workspaceName: string;
  poNumber: string;
  statusLabel: string;
  createdAt: string;
  supplierName: string;
  supplierEmail: string;
  shipTo: string;
  paymentTerms: string | null;
  referenceNumber: string | null;
  requestedShipDate: string;
  confirmedShipDate: string;
  notes: string | null;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  adjustmentAmount: string;
  total: string;
  lineItems: Array<{
    description: string;
    sku: string;
    qty: string;
    unitCost: string;
    lineTotal: string;
  }>;
};

function drawLabelValue(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
) {
  doc.fontSize(8).fillColor("#6b7280").text(label, x, y, { width: 240 });
  doc.fontSize(10).fillColor("#111827").text(value || "—", x, y + 12, {
    width: 240,
  });
}

/** Generate a professional PO PDF buffer (server-side only). */
export async function buildPurchaseOrderPdf(
  input: PoPdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 48,
      info: {
        Title: input.poNumber,
        Author: input.workspaceName,
        Subject: "Purchase Order",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.fontSize(20).fillColor("#111827").text(input.workspaceName, {
      width: pageWidth * 0.6,
    });
    doc
      .fontSize(16)
      .fillColor("#111827")
      .text("PURCHASE ORDER", doc.page.margins.left + pageWidth * 0.55, 48, {
        width: pageWidth * 0.45,
        align: "right",
      });

    doc.moveDown(0.5);
    const topY = doc.y + 8;
    drawLabelValue(doc, "PO NUMBER", input.poNumber, doc.page.margins.left, topY);
    drawLabelValue(
      doc,
      "STATUS",
      input.statusLabel,
      doc.page.margins.left + 180,
      topY,
    );
    drawLabelValue(
      doc,
      "DATE",
      input.createdAt,
      doc.page.margins.left + 320,
      topY,
    );

    doc.y = topY + 48;
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + pageWidth, doc.y)
      .strokeColor("#e5e7eb")
      .stroke();
    doc.moveDown(1);

    const blockY = doc.y;
    drawLabelValue(doc, "SUPPLIER", input.supplierName, doc.page.margins.left, blockY);
    doc
      .fontSize(9)
      .fillColor("#374151")
      .text(input.supplierEmail, doc.page.margins.left, blockY + 36, {
        width: 240,
      });
    drawLabelValue(
      doc,
      "SHIP TO",
      input.shipTo,
      doc.page.margins.left + 280,
      blockY,
    );

    doc.y = blockY + 70;
    const metaY = doc.y;
    drawLabelValue(
      doc,
      "PAYMENT TERMS",
      input.paymentTerms ?? "—",
      doc.page.margins.left,
      metaY,
    );
    drawLabelValue(
      doc,
      "REFERENCE",
      input.referenceNumber ?? "—",
      doc.page.margins.left + 180,
      metaY,
    );
    drawLabelValue(
      doc,
      "REQUESTED SHIP",
      input.requestedShipDate,
      doc.page.margins.left + 360,
      metaY,
    );

    doc.y = metaY + 48;
    if (input.confirmedShipDate && input.confirmedShipDate !== "—") {
      drawLabelValue(
        doc,
        "CONFIRMED SHIP",
        input.confirmedShipDate,
        doc.page.margins.left,
        doc.y,
      );
      doc.y += 40;
    }

    // Table header
    const tableTop = doc.y + 8;
    const cols = {
      desc: doc.page.margins.left,
      sku: doc.page.margins.left + 220,
      qty: doc.page.margins.left + 320,
      unit: doc.page.margins.left + 370,
      total: doc.page.margins.left + 450,
    };
    doc.rect(doc.page.margins.left, tableTop, pageWidth, 22).fill("#f3f4f6");
    doc.fillColor("#111827").fontSize(8);
    doc.text("PRODUCT", cols.desc + 4, tableTop + 7, { width: 200 });
    doc.text("SKU", cols.sku, tableTop + 7, { width: 90 });
    doc.text("QTY", cols.qty, tableTop + 7, { width: 40, align: "right" });
    doc.text("UNIT COST", cols.unit, tableTop + 7, {
      width: 70,
      align: "right",
    });
    doc.text("TOTAL", cols.total, tableTop + 7, { width: 70, align: "right" });

    let rowY = tableTop + 28;
    doc.fontSize(9).fillColor("#111827");
    for (const line of input.lineItems) {
      if (rowY > doc.page.height - 140) {
        doc.addPage();
        rowY = doc.page.margins.top;
      }
      const descHeight = doc.heightOfString(line.description, { width: 200 });
      doc.text(line.description, cols.desc + 4, rowY, { width: 200 });
      doc.text(line.sku === "—" ? "" : line.sku, cols.sku, rowY, { width: 90 });
      doc.text(line.qty, cols.qty, rowY, { width: 40, align: "right" });
      doc.text(line.unitCost, cols.unit, rowY, { width: 70, align: "right" });
      doc.text(line.lineTotal, cols.total, rowY, { width: 70, align: "right" });
      rowY += Math.max(descHeight, 14) + 10;
    }

    doc.y = rowY + 8;
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + pageWidth, doc.y)
      .strokeColor("#e5e7eb")
      .stroke();
    doc.moveDown(1);

    const totalsX = doc.page.margins.left + pageWidth - 200;
    const addTotalRow = (label: string, value: string, bold = false) => {
      doc.fontSize(bold ? 11 : 9).fillColor("#111827");
      doc.text(label, totalsX, doc.y, { width: 100, align: "left" });
      doc.text(value, totalsX + 100, doc.y - (bold ? 13 : 11), {
        width: 100,
        align: "right",
      });
      doc.moveDown(0.4);
    };

    addTotalRow("Subtotal", input.subtotal);
    addTotalRow("Tax", input.taxAmount);
    addTotalRow("Shipping", input.shippingAmount);
    addTotalRow("Adjustments", input.adjustmentAmount);
    doc.moveDown(0.2);
    addTotalRow("Total", input.total, true);

    if (input.notes) {
      doc.moveDown(1.5);
      doc.fontSize(8).fillColor("#6b7280").text("NOTES");
      doc
        .fontSize(10)
        .fillColor("#111827")
        .text(input.notes, { width: pageWidth });
    }

    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor("#9ca3af")
      .text(
        `Generated ${shortDate(new Date().toISOString())} · ${input.poNumber}`,
        { align: "center", width: pageWidth },
      );

    doc.end();
  });
}

export function pdfFileName(poNumber: string) {
  const safe = poNumber.replace(/[^a-zA-Z0-9-_]/g, "_");
  return `${safe}.pdf`;
}

/** Convenience for money formatting in PDF builders. */
export function pdfMoney(amount: number | string | null | undefined) {
  return money(amount);
}
