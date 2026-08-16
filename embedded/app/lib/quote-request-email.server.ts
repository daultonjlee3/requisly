/**
 * Outbound RFQ email — same Resend + Reply-To pattern as PO supplier email.
 */
import { inboundMailboxDomain } from "./po-supplier-email.server";

export function rfqInboundReplyToAddress(token: string): string {
  return `rfq+${token}@${inboundMailboxDomain()}`;
}

export async function sendQuoteRequestEmail(opts: {
  to: string;
  workspaceName: string;
  supplierName: string;
  title: string;
  neededBy: string | null;
  quoteLinkUrl: string;
  replyToToken: string;
  lines: Array<{ description: string; sku: string | null; qty: number }>;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    console.warn("[rfq-email] RESEND_API_KEY missing — skipping send");
    return;
  }
  const from =
    process.env.RESEND_FROM_EMAIL?.trim() || "Requisly <orders@requisly.com>";

  const lineRows = opts.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(l.description)}${l.sku ? ` <span style="color:#9ca3af">(${escapeHtml(l.sku)})</span>` : ""}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${l.qty}</td></tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:32px 16px"><tr><td align="center">
  <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:8px;padding:28px 24px;border:1px solid #e5e7eb">
  <tr><td>
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#9ca3af">${escapeHtml(opts.workspaceName)}</p>
  <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#111827">Quote request</h1>
  <p style="margin:0 0 12px;color:#4b5563;font-size:14px">Hi ${escapeHtml(opts.supplierName)}, please quote the lines below.</p>
  <p style="margin:0 0 16px;font-size:14px;color:#111827"><strong>${escapeHtml(opts.title)}</strong></p>
  ${opts.neededBy ? `<p style="margin:0 0 16px;font-size:13px;color:#6b7280">Needed by: ${escapeHtml(opts.neededBy)}</p>` : ""}
  <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;color:#111827">${lineRows}</table>
  <p style="margin:20px 0 0"><a href="${escapeAttr(opts.quoteLinkUrl)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">Open quote form</a></p>
  <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Or reply to this email with unit price and lead time per line — we’ll confirm what we understood before saving.</p>
  </td></tr></table>
  <p style="margin:16px 0 0;font-size:11px;color:#9ca3af">Sent via Requisly</p>
  </td></tr></table></body></html>`;

  const text = [
    `${opts.workspaceName}`,
    `Quote request: ${opts.title}`,
    `Hi ${opts.supplierName},`,
    "",
    ...opts.lines.map(
      (l) => `- ${l.description}${l.sku ? ` (${l.sku})` : ""} × ${l.qty}`,
    ),
    "",
    `Quote form: ${opts.quoteLinkUrl}`,
    "Or reply with price and lead time per line.",
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: `Quote request: ${opts.title}`,
      html,
      text,
      reply_to: rfqInboundReplyToAddress(opts.replyToToken),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RFQ email failed: ${res.status} ${body}`);
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s: string) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
