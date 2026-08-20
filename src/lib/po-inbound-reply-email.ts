import { escapeAttr, escapeHtml } from "@/lib/po-supplier-email";
import type { PoReplyChange, PoReplyLine, PoReplyParse } from "@/lib/po-reply-parse";

const INK = "#14182B";
const INK_FAINT = "#565C7A";
const PAPER = "#F1F2F6";
const PAPER_RAISED = "#FFFFFF";
const LINE = "#DCDFE8";
const ACCENT = "#3644E8";
const FONT_BODY =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function wrap(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PAPER}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PAPER}">
    <tr>
      <td align="center" style="padding:24px 12px">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0" border="0" style="width:520px;max-width:100%;background:${PAPER_RAISED};border:1px solid ${LINE}">
          <tr>
            <td style="padding:28px 24px;font-family:${FONT_BODY};color:${INK}">
              ${inner}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0 8px">
    <tr>
      <td align="center" bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:4px">
        <a href="${escapeAttr(href)}" style="display:block;padding:14px 20px;font-family:${FONT_BODY};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;text-align:center">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function lineLabel(lines: PoReplyLine[], id: string): string {
  return lines.find((l) => l.id === id)?.description ?? "Line";
}

function formatChange(change: PoReplyChange, lines: PoReplyLine[]): string {
  const name = lineLabel(lines, change.po_line_item_id);
  const bits: string[] = [name];
  if (change.proposed_qty != null) bits.push(`qty ${change.proposed_qty}`);
  if (change.proposed_unit_cost != null) {
    bits.push(`unit cost $${change.proposed_unit_cost.toFixed(2)}`);
  }
  if (change.note) bits.push(`(${change.note})`);
  return bits.join(" — ");
}

export function buildPoReplyConfirmEmail(opts: {
  poNumber: string;
  workspaceName: string;
  parsed: PoReplyParse;
  lines: PoReplyLine[];
  confirmUrl: string;
  correctUrl: string | null;
}): { subject: string; html: string; text: string } {
  const po = opts.poNumber.trim() || "PO";
  const subject = `Please confirm what we read for ${po}`;
  const interpretation = opts.parsed.confirmAsIs
    ? "Confirm the order as written, with no line changes."
    : opts.parsed.changes.map((c) => formatChange(c, opts.lines)).join("\n");
  const ship = opts.parsed.shipDate
    ? `Requested ship date: ${opts.parsed.shipDate}`
    : "";

  const html = wrap(`
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${INK_FAINT}">${escapeHtml(opts.workspaceName)}</p>
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">We read your reply to ${escapeHtml(po)}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:${INK_FAINT}">Nothing has been applied yet. Confirm this interpretation, or correct it on the order page.</p>
    <p style="margin:0 0 8px;font-size:13px;font-weight:600">Our reading</p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;white-space:pre-wrap">${escapeHtml(opts.parsed.summary)}</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;white-space:pre-wrap">${escapeHtml(interpretation)}${ship ? `\n${escapeHtml(ship)}` : ""}</p>
    ${button(opts.confirmUrl, "Confirm this interpretation")}
    ${
      opts.correctUrl
        ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.5"><a href="${escapeAttr(opts.correctUrl)}" style="color:${ACCENT}">Correct this on the order page →</a></p>`
        : ""
    }
  `);

  const text = [
    `We read your reply to ${po}. Nothing has been applied yet.`,
    "",
    opts.parsed.summary,
    interpretation,
    ship,
    "",
    `Confirm: ${opts.confirmUrl}`,
    opts.correctUrl ? `Correct: ${opts.correctUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export function buildPoReplyAutoAppliedEmail(opts: {
  poNumber: string;
  workspaceName: string;
  parsed: PoReplyParse;
  lines: PoReplyLine[];
  undoHours: number;
  correctUrl: string | null;
}): { subject: string; html: string; text: string } {
  const po = opts.poNumber.trim() || "PO";
  const subject = `We updated ${po} based on your reply`;
  const interpretation = opts.parsed.confirmAsIs
    ? "Confirmed the order as written, with no line changes."
    : opts.parsed.changes.map((c) => formatChange(c, opts.lines)).join("\n");
  const ship = opts.parsed.shipDate
    ? `Requested ship date: ${opts.parsed.shipDate}`
    : "";
  const windowLabel =
    opts.undoHours === 1 ? "1 hour" : `${opts.undoHours} hours`;

  const html = wrap(`
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${INK_FAINT}">${escapeHtml(opts.workspaceName)}</p>
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">We updated ${escapeHtml(po)} based on your reply</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:${INK_FAINT}">${escapeHtml(opts.parsed.summary)}</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;white-space:pre-wrap">${escapeHtml(interpretation)}${ship ? `\n${escapeHtml(ship)}` : ""}</p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5">Reply <strong>UNDO</strong> within ${escapeHtml(windowLabel)} if that's wrong.</p>
    ${
      opts.correctUrl
        ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.5"><a href="${escapeAttr(opts.correctUrl)}" style="color:${ACCENT}">Open the order page →</a></p>`
        : ""
    }
  `);

  const text = [
    `We updated ${po} based on your reply:`,
    opts.parsed.summary,
    interpretation,
    ship,
    "",
    `Reply UNDO within ${windowLabel} if that's wrong.`,
    opts.correctUrl ? `Order page: ${opts.correctUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export function buildPoReplyUndoUnavailableEmail(opts: {
  poNumber: string;
  workspaceName: string;
  supplierLinkUrl: string | null;
  reason: string;
}): { subject: string; html: string; text: string } {
  const po = opts.poNumber.trim() || "PO";
  const subject = `Nothing to undo on ${po}`;
  const link = opts.supplierLinkUrl;
  const html = wrap(`
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${INK_FAINT}">${escapeHtml(opts.workspaceName)}</p>
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">Nothing to undo</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:${INK_FAINT}">${escapeHtml(opts.reason)} Use the order link if you still need to change ${escapeHtml(po)}.</p>
    ${link ? button(link, "Open your order") : ""}
  `);
  const text = [
    opts.reason,
    link ? `Open your order: ${link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, html, text };
}

export function buildPoReplyUnparsedEmail(opts: {
  poNumber: string;
  workspaceName: string;
  supplierLinkUrl: string | null;
}): { subject: string; html: string; text: string } {
  const po = opts.poNumber.trim() || "PO";
  const subject = `We couldn't understand your reply to ${po}`;
  const link = opts.supplierLinkUrl;
  const html = wrap(`
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${INK_FAINT}">${escapeHtml(opts.workspaceName)}</p>
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">We couldn't understand that reply</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:${INK_FAINT}">Your message was received, but we could not map it onto ${escapeHtml(po)}. Use the order link to confirm or propose changes.</p>
    ${link ? button(link, "Open your order") : ""}
  `);
  const text = [
    `We received your reply to ${po} but could not understand it.`,
    link ? `Open your order: ${link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, html, text };
}
