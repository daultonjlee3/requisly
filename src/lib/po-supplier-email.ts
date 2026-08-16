/**
 * PO supplier email — Manifest & Stamp.
 * Table layout + inline CSS for Gmail, Outlook (Word), and Apple Mail.
 * Not Polaris. Do not import this from embedded UI routes.
 */

export type PoEmailLine = {
  description: string;
  qty: number;
  unitCost?: number | null;
  lineTotal?: number | null;
};

export type PoEmailTotals = {
  subtotal: number;
  tax: number;
  shipping: number;
  adjustments: number;
  total: number;
};

export type PoEmailContent = {
  workspaceName: string;
  poNumber: string;
  supplierName: string;
  shipDateLabel: string | null;
  lines: PoEmailLine[];
  totals?: PoEmailTotals | null;
  confirmAsIsUrl: string | null;
  markShippedUrl: string | null;
  supplierLinkUrl: string | null;
  pdfUrl: string | null;
  csvUrl: string | null;
};

const INK = "#14182B";
const INK_FAINT = "#565C7A";
const PAPER = "#F1F2F6";
const PAPER_RAISED = "#FFFFFF";
const LINE = "#DCDFE8";
const ACCENT = "#3644E8";
const ACCENT_INK = "#2530B8";
const ACCENT_WASH = "#EAECFD";

const FONT_BODY =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DISPLAY =
  "'Space Grotesk', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_MONO =
  "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

export function poEmailSenderName(workspaceName: string): string {
  const name = workspaceName.trim() || "Merchant";
  return `${name} via Requisly`;
}

export function poEmailFromAddress(
  workspaceName: string,
  mailbox = "Requisly <orders@requisly.com>",
): string {
  const match = mailbox.match(/^(.*)<([^>]+)>\s*$/);
  const address = match?.[2]?.trim() || mailbox.trim() || "orders@requisly.com";
  return `${sanitizeFromName(poEmailSenderName(workspaceName))} <${address}>`;
}

export function buildPoSupplierEmailSubject(opts: {
  poNumber: string;
  shipDateLabel: string | null;
}): string {
  const po = opts.poNumber.trim() || "PO";
  if (opts.shipDateLabel) {
    return `Action needed: confirm ${po} by ${opts.shipDateLabel}`;
  }
  return `Action needed: confirm ${po}`;
}

export function buildPoSupplierEmailHtml(opts: PoEmailContent): string {
  const merchant = opts.workspaceName.trim() || "Merchant";
  const shipBlock = opts.shipDateLabel
    ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px">
                <tr>
                  <td bgcolor="${ACCENT_WASH}" style="background:${ACCENT_WASH};border:1px solid #C9D0F8;padding:16px 18px">
                    <p style="margin:0 0 6px;font-family:${FONT_BODY};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT_INK}">Requested ship date</p>
                    <p style="margin:0;font-family:${FONT_MONO};font-size:26px;font-weight:600;line-height:1.2;color:${INK}">${escapeHtml(opts.shipDateLabel)}</p>
                  </td>
                </tr>
              </table>`
    : "";

  const linesBlock = renderLines(opts.lines);
  const totalsBlock = renderTotals(resolveTotals(opts));

  const confirmBtn = opts.confirmAsIsUrl
    ? bulletproofButton(opts.confirmAsIsUrl, "Confirm as-is", ACCENT, "#ffffff")
    : "";
  const shipBtn = opts.markShippedUrl
    ? bulletproofButton(opts.markShippedUrl, "Mark shipped", PAPER_RAISED, INK, LINE)
    : "";

  const downloadLines = [
    opts.pdfUrl
      ? `<a href="${escapeAttr(opts.pdfUrl)}" style="color:${ACCENT};font-weight:600;text-decoration:none">Download PO PDF</a> <span style="color:${INK_FAINT}">— SKUs and formal copy</span>`
      : "",
    opts.csvUrl
      ? `<a href="${escapeAttr(opts.csvUrl)}" style="color:${ACCENT};font-weight:600;text-decoration:none">Download as spreadsheet</a> <span style="color:${INK_FAINT}">— view or import this order</span>`
      : "",
  ].filter(Boolean);
  const pdfLine = downloadLines.length
    ? `<p style="margin:16px 0 0;font-family:${FONT_BODY};font-size:13px;line-height:1.5;color:${INK_FAINT}">${downloadLines.join("<br />")}</p>
              <p style="margin:8px 0 0;font-family:${FONT_BODY};font-size:12px;line-height:1.5;color:${INK_FAINT}">The spreadsheet is a copy for your records. To change this order, use the link below or reply to this email — we do not read uploaded or emailed files as updates.</p>`
    : "";

  const fullLink = opts.supplierLinkUrl
    ? `<p style="margin:12px 0 0;font-family:${FONT_BODY};font-size:12px;line-height:1.5;color:${INK_FAINT}">Need line changes, tracking, or history? <a href="${escapeAttr(opts.supplierLinkUrl)}" style="color:${INK_FAINT};text-decoration:underline">View full order →</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(buildPoSupplierEmailSubject(opts))}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <style type="text/css">
    table { border-collapse: collapse; }
    td, th { font-family: Arial, Helvetica, sans-serif; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">
    Confirm ${escapeHtml(opts.poNumber)}${opts.shipDateLabel ? ` by ${escapeHtml(opts.shipDateLabel)}` : ""}.
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PAPER};margin:0;padding:0">
    <tr>
      <td align="center" style="padding:28px 12px">
        <!--[if mso]>
        <table role="presentation" align="center" width="520" cellspacing="0" cellpadding="0" border="0"><tr><td>
        <![endif]-->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;width:100%">
          <tr>
            <td bgcolor="${INK}" style="background:${INK};padding:22px 24px 20px">
              <p style="margin:0 0 4px;font-family:${FONT_BODY};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#9AA0C4">Purchase order from</p>
              <p style="margin:0;font-family:${FONT_DISPLAY};font-size:22px;font-weight:600;line-height:1.25;color:#ffffff">${escapeHtml(merchant)}</p>
              <p style="margin:6px 0 0;font-family:${FONT_BODY};font-size:12px;color:#C7CAE0">via Requisly</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="${PAPER_RAISED}" style="background:${PAPER_RAISED};border-left:1px solid ${LINE};border-right:1px solid ${LINE};padding:22px 24px 8px">
              <p style="margin:0 0 2px;font-family:${FONT_MONO};font-size:12px;font-weight:500;color:${INK_FAINT}">${escapeHtml(opts.poNumber)}</p>
              <p style="margin:0 0 6px;font-family:${FONT_BODY};font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${ACCENT}">Action needed</p>
              <h1 style="margin:0 0 8px;font-family:${FONT_DISPLAY};font-size:22px;font-weight:600;line-height:1.3;color:${INK}">Confirm this order</h1>
              <p style="margin:0 0 20px;font-family:${FONT_BODY};font-size:14px;line-height:1.5;color:${INK_FAINT}">Hi ${escapeHtml(opts.supplierName)}, please review the lines and confirm the ship date.</p>
              ${shipBlock}
              ${linesBlock}
              ${totalsBlock}
            </td>
          </tr>
          <tr>
            <td bgcolor="${PAPER_RAISED}" style="background:${PAPER_RAISED};border-left:1px solid ${LINE};border-right:1px solid ${LINE};padding:4px 24px 22px">
              ${confirmBtn}
              ${shipBtn}
              <p style="margin:16px 0 0;font-family:${FONT_BODY};font-size:12px;line-height:1.5;color:${INK_FAINT}">One-click actions open a short confirmation page first — nothing is saved until you confirm. You can also reply to this email.</p>
              ${pdfLine}
              ${fullLink}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px 0;font-family:${FONT_BODY};font-size:11px;line-height:1.5;color:${INK_FAINT};text-align:center">
              Sent by ${escapeHtml(poEmailSenderName(merchant))}
            </td>
          </tr>
        </table>
        <!--[if mso]>
        </td></tr></table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildPoSupplierEmailText(opts: PoEmailContent): string {
  const lines = [
    poEmailSenderName(opts.workspaceName),
    opts.poNumber,
    "",
    `Hi ${opts.supplierName}, please confirm this order.`,
  ];
  if (opts.shipDateLabel) {
    lines.push("");
    lines.push(`Requested ship date: ${opts.shipDateLabel}`);
  }
  if (opts.lines.length) {
    lines.push("");
    lines.push("Order lines");
    for (const line of opts.lines) {
      const unit =
        line.unitCost != null && Number.isFinite(Number(line.unitCost))
          ? ` @ ${formatMoney(Number(line.unitCost))}`
          : "";
      lines.push(
        `- ${line.description} × ${formatQty(line.qty)}${unit} = ${formatMoney(lineAmount(line))}`,
      );
    }
  }
  const totals = resolveTotals(opts);
  lines.push("");
  lines.push(`Subtotal: ${formatMoney(totals.subtotal)}`);
  lines.push(`Tax: ${formatMoney(totals.tax)}`);
  lines.push(`Shipping: ${formatMoney(totals.shipping)}`);
  lines.push(`Adjustments: ${formatMoney(totals.adjustments)}`);
  lines.push(`Total: ${formatMoney(totals.total)}`);
  lines.push("");
  if (opts.confirmAsIsUrl) lines.push(`Confirm as-is: ${opts.confirmAsIsUrl}`);
  if (opts.markShippedUrl) lines.push(`Mark shipped: ${opts.markShippedUrl}`);
  if (opts.pdfUrl) lines.push(`Download PO PDF: ${opts.pdfUrl}`);
  if (opts.csvUrl) {
    lines.push(`Download as spreadsheet (view or import this order): ${opts.csvUrl}`);
    lines.push(
      "The spreadsheet is a copy for your records. To change this order, use the order link or reply to this email — uploaded or emailed files are not read as updates.",
    );
  }
  if (opts.supplierLinkUrl) {
    lines.push("");
    lines.push(`View full order: ${opts.supplierLinkUrl}`);
  }
  lines.push("");
  lines.push(
    "One-click links open a confirmation page first. You can also reply to this email.",
  );
  return lines.join("\n");
}

function lineAmount(line: PoEmailLine): number {
  if (line.lineTotal != null && Number.isFinite(Number(line.lineTotal))) {
    return Number(line.lineTotal);
  }
  const qty = Number(line.qty);
  const unit = Number(line.unitCost);
  if (!Number.isFinite(qty) || !Number.isFinite(unit)) return 0;
  return Number((qty * unit).toFixed(2));
}

function resolveTotals(opts: PoEmailContent): PoEmailTotals {
  if (opts.totals) return opts.totals;
  const subtotal = Number(
    opts.lines.reduce((sum, line) => sum + lineAmount(line), 0).toFixed(2),
  );
  return {
    subtotal,
    tax: 0,
    shipping: 0,
    adjustments: 0,
    total: subtotal,
  };
}

function th(
  label: string,
  width: number,
  align: "left" | "right",
  extraPad: string,
): string {
  return `<td width="${width}" align="${align}" style="width:${width}px;padding:${extraPad};border-bottom:1px solid ${LINE};font-family:${FONT_BODY};font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${INK_FAINT};white-space:nowrap">${escapeHtml(label)}</td>`;
}

function tdNum(value: string, width: number, extraPad: string, last: boolean): string {
  const border = last ? "0" : `1px solid ${LINE}`;
  return `<td width="${width}" align="right" style="width:${width}px;padding:${extraPad};border-bottom:${border};font-family:${FONT_MONO};font-size:12px;line-height:1.35;color:${INK};white-space:nowrap">${escapeHtml(value)}</td>`;
}

function renderLines(lines: PoEmailLine[]): string {
  if (!lines.length) return "";
  // 472px inner card. Four columns only — SKU stays on the PDF.
  // Separate from the totals table so Outlook Word does not inherit colspans.
  const rows = lines
    .map((line, i) => {
      const last = i === lines.length - 1;
      const border = last ? "0" : `1px solid ${LINE}`;
      const unit =
        line.unitCost != null && Number.isFinite(Number(line.unitCost))
          ? formatMoney(Number(line.unitCost))
          : "—";
      return `<tr>
                  <td width="212" valign="top" style="width:212px;padding:9px 8px 9px 0;border-bottom:${border};font-family:${FONT_BODY};font-size:13px;font-weight:500;line-height:1.35;color:${INK}">${escapeHtml(line.description)}</td>
                  ${tdNum(formatQty(line.qty), 50, "9px 4px", last)}
                  ${tdNum(unit, 100, "9px 4px", last)}
                  ${tdNum(formatMoney(lineAmount(line)), 110, "9px 0 9px 4px", last)}
                </tr>`;
    })
    .join("");

  return `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px">
                <tr>
                  <td style="padding:0 0 8px">
                    <p style="margin:0;font-family:${FONT_BODY};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${INK_FAINT}">Order lines</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 16px">
                <tr>
                  ${th("Product", 212, "left", "0 8px 8px 0")}
                  ${th("Qty", 50, "right", "0 4px 8px")}
                  ${th("Unit cost", 100, "right", "0 4px 8px")}
                  ${th("Total", 110, "right", "0 0 8px 4px")}
                </tr>
                ${rows}
              </table>`;
}

function summaryRow(
  label: string,
  value: string,
  lastMeta: boolean,
): string {
  const border = lastMeta ? "0" : `1px solid ${LINE}`;
  return `<tr>
                    <td align="left" style="padding:6px 12px 6px 0;border-bottom:${border};font-family:${FONT_BODY};font-size:13px;color:${INK_FAINT}">${escapeHtml(label)}</td>
                    <td align="right" style="padding:6px 0;border-bottom:${border};font-family:${FONT_MONO};font-size:13px;color:${INK};white-space:nowrap">${escapeHtml(value)}</td>
                  </tr>`;
}

function renderTotals(totals: PoEmailTotals): string {
  return `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px">
                <tr>
                  <td align="right">
                    <table role="presentation" width="260" cellspacing="0" cellpadding="0" border="0" align="right" style="width:260px;border-collapse:collapse">
                      ${summaryRow("Subtotal", formatMoney(totals.subtotal), false)}
                      ${summaryRow("Tax", formatMoney(totals.tax), false)}
                      ${summaryRow("Shipping", formatMoney(totals.shipping), false)}
                      ${summaryRow("Adjustments", formatMoney(totals.adjustments), true)}
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px">
                <tr>
                  <td bgcolor="${ACCENT_WASH}" style="background:${ACCENT_WASH};border:1px solid #C9D0F8;padding:14px 16px">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td align="left" valign="middle" style="font-family:${FONT_BODY};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT_INK}">Total</td>
                        <td align="right" valign="middle" style="font-family:${FONT_MONO};font-size:26px;font-weight:600;line-height:1.2;color:${INK};white-space:nowrap">${escapeHtml(formatMoney(totals.total))}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>`;
}

function bulletproofButton(
  href: string,
  label: string,
  bg: string,
  color: string,
  border?: string,
): string {
  const stroke = border || bg;
  const borderCss = `border:1px solid ${stroke};`;
  const safeHref = escapeAttr(href);
  const safeLabel = escapeHtml(label);
  // Outlook Word ignores padding on <a>. VML keeps a 44px hit target;
  // other clients use the padded anchor on a bgcolor cell.
  return `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 10px">
                <tr>
                  <td align="center">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:44px;v-text-anchor:middle;width:472px;" arcsize="9%" strokecolor="${stroke}" fillcolor="${bg}">
                      <w:anchorlock/>
                      <center style="color:${color};font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">${safeLabel}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td align="center" bgcolor="${bg}" style="background:${bg};${borderCss}border-radius:4px">
                          <a href="${safeHref}" style="display:block;padding:14px 20px;font-family:${FONT_BODY};font-size:14px;font-weight:600;line-height:1.2;color:${color};text-decoration:none;text-align:center">${safeLabel}</a>
                        </td>
                      </tr>
                    </table>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>`;
}

function formatQty(qty: number): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return String(qty);
  return Number.isInteger(n) ? String(n) : String(n);
}

function formatMoney(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  const sign = n < 0 ? "-" : "";
  const [whole, frac] = Math.abs(n).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${grouped}.${frac}`;
}

function sanitizeFromName(name: string): string {
  return name.replace(/[<>"]/g, "").replace(/\s+/g, " ").trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
