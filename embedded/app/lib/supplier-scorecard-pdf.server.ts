import PDFDocument from "pdfkit";
import { shortDate } from "./format";
import {
  daysLabel,
  pctLabel,
  spendLabel,
  type SupplierScorecardExportData,
} from "./supplier-scorecard.server";

/**
 * One-page supplier scorecard PDF — business document style (same PDFKit
 * patterns as po-pdf.server.ts). Meant to be printable / emailed to a supplier.
 */
export async function buildSupplierScorecardPdf(
  data: SupplierScorecardExportData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 48,
      info: {
        Title: `${data.supplierName} — Supplier Scorecard`,
        Author: data.workspaceName,
        Subject: "Supplier Scorecard",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Header
    doc
      .fontSize(11)
      .fillColor("#6b7280")
      .text(data.workspaceName.toUpperCase(), left, 48, { width: pageWidth });
    doc
      .fontSize(22)
      .fillColor("#111827")
      .text("Supplier Scorecard", left, 68, { width: pageWidth });
    doc
      .fontSize(16)
      .fillColor("#111827")
      .text(data.supplierName, left, 96, { width: pageWidth });

    doc
      .fontSize(9)
      .fillColor("#6b7280")
      .text(
        `${data.completedPos} closed purchase orders · Generated ${shortDate(data.generatedAt)}`,
        left,
        120,
        { width: pageWidth },
      );

    doc
      .moveTo(left, 142)
      .lineTo(left + pageWidth, 142)
      .strokeColor("#e5e7eb")
      .stroke();

    // Metric cards
    const metrics = [
      { label: "ON-TIME RATE", value: pctLabel(data.onTimePct) },
      { label: "FILL RATE", value: pctLabel(data.fillRate) },
      {
        label: "AVG LEAD VARIANCE",
        value: daysLabel(data.avgLeadTimeVarianceDays),
      },
      { label: "CLOSED SPEND", value: spendLabel(data.closedSpend) },
    ];

    const cardW = (pageWidth - 24) / 4;
    const cardY = 158;
    metrics.forEach((m, i) => {
      const x = left + i * (cardW + 8);
      doc.rect(x, cardY, cardW, 64).fill("#f3f4f6");
      doc
        .fontSize(8)
        .fillColor("#6b7280")
        .text(m.label, x + 10, cardY + 12, { width: cardW - 20 });
      doc
        .fontSize(16)
        .fillColor("#111827")
        .text(m.value, x + 10, cardY + 30, { width: cardW - 20 });
    });

    // On-time trend
    let y = cardY + 88;
    doc.fontSize(12).fillColor("#111827").text("On-time rate trend", left, y);
    y += 22;

    if (data.trend.length === 0) {
      doc
        .fontSize(10)
        .fillColor("#6b7280")
        .text("Not enough monthly samples to chart a trend yet.", left, y, {
          width: pageWidth,
        });
      y += 28;
    } else {
      const chartH = 120;
      const chartW = pageWidth;
      const chartX = left;
      const chartY = y;
      const maxBars = data.trend.length;
      const gap = 8;
      const barW = Math.min(48, (chartW - gap * (maxBars - 1)) / maxBars);

      // Axis line
      doc
        .moveTo(chartX, chartY + chartH)
        .lineTo(chartX + chartW, chartY + chartH)
        .strokeColor("#d1d5db")
        .stroke();

      // 100% / 50% guides
      for (const pct of [1, 0.5]) {
        const gy = chartY + chartH * (1 - pct);
        doc
          .moveTo(chartX, gy)
          .lineTo(chartX + chartW, gy)
          .strokeColor("#f3f4f6")
          .stroke();
        doc
          .fontSize(7)
          .fillColor("#9ca3af")
          .text(`${Math.round(pct * 100)}%`, chartX - 2, gy - 8, {
            width: 28,
            align: "right",
          });
      }

      data.trend.forEach((point, i) => {
        const h = Math.max(2, chartH * point.onTimePct);
        const bx = chartX + i * (barW + gap) + 28;
        const by = chartY + chartH - h;
        doc.rect(bx, by, barW, h).fill("#3644E8");
        doc
          .fontSize(7)
          .fillColor("#6b7280")
          .text(point.label, bx - 4, chartY + chartH + 6, {
            width: barW + 8,
            align: "center",
          });
        doc
          .fontSize(8)
          .fillColor("#111827")
          .text(`${Math.round(point.onTimePct * 100)}%`, bx - 4, by - 12, {
            width: barW + 8,
            align: "center",
          });
      });

      y = chartY + chartH + 36;
    }

    // Avg confirm days note
    doc
      .fontSize(9)
      .fillColor("#374151")
      .text(
        `Average confirmation time: ${daysLabel(data.avgConfirmationDays)} after send (from Supplier Link timeline events).`,
        left,
        y,
        { width: pageWidth },
      );

    // Footer attribution — required credibility claim (fixed to page bottom)
    const footerY = doc.page.height - doc.page.margins.bottom - 18;
    doc.save();
    doc
      .moveTo(left, footerY - 14)
      .lineTo(left + pageWidth, footerY - 14)
      .strokeColor("#d1d5db")
      .stroke();
    doc
      .fontSize(8)
      .fillColor("#6b7280")
      .text(
        "Generated by Requisly from confirmed order history",
        left,
        footerY,
        { width: pageWidth, align: "center", lineBreak: false },
      );
    doc.restore();

    doc.end();
  });
}

export function scorecardPdfFileName(supplierName: string) {
  const safe = supplierName.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 48);
  return `${safe}_scorecard.pdf`;
}
