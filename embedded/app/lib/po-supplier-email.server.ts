/**
 * Outbound PO email to suppliers (Resend).
 * Reply-To uses inbound.requisly.com (MX must be configured in DNS — see Resend Domains → Receiving).
 */

export function inboundReplyToAddress(supplierLinkToken: string): string {
  const domain =
    process.env.RESEND_INBOUND_DOMAIN?.trim() || "inbound.requisly.com";
  // Plus-address so inbound webhook can map replies without a separate table lookup race.
  return `po+${supplierLinkToken}@${domain}`;
}

export function buildPoSupplierEmailHtml(opts: {
  workspaceName: string;
  poNumber: string;
  supplierName: string;
  shipDateLabel: string | null;
  confirmAsIsUrl: string | null;
  markShippedUrl: string | null;
  supplierLinkUrl: string | null;
  pdfUrl: string | null;
}): string {
  const shipLine = opts.shipDateLabel
    ? `<p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.5">Requested ship date: <strong style="color:#111827">${escapeHtml(opts.shipDateLabel)}</strong></p>`
    : "";

  const confirmBtn = opts.confirmAsIsUrl
    ? button(opts.confirmAsIsUrl, "Confirm as-is", "#111827")
    : "";
  const shipBtn = opts.markShippedUrl
    ? button(opts.markShippedUrl, "Mark shipped", "#374151")
    : "";

  const pdfLine = opts.pdfUrl
    ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280"><a href="${escapeAttr(opts.pdfUrl)}" style="color:#4b5563">Download PO PDF</a></p>`
    : "";

  const fullLink = opts.supplierLinkUrl
    ? `<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#9ca3af">Need to change lines, add tracking, or see history? <a href="${escapeAttr(opts.supplierLinkUrl)}" style="color:#6b7280;text-decoration:underline">View full order &amp; history →</a></p>`
    : "";

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;padding:28px 24px;border:1px solid #e5e7eb">
          <tr>
            <td>
              <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#9ca3af">${escapeHtml(opts.workspaceName)}</p>
              <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#111827;line-height:1.3">Purchase order ${escapeHtml(opts.poNumber)}</h1>
              <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.5">Hi ${escapeHtml(opts.supplierName)}, please review this order.</p>
              ${shipLine}
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 0">
                <tr>
                  <td style="padding:0 8px 8px 0">${confirmBtn}</td>
                  <td style="padding:0 0 8px 0">${shipBtn}</td>
                </tr>
              </table>
              <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;line-height:1.4">One-click actions open a short confirmation page first (they do not run until you confirm). Or reply to this email — we’ll email back what we understood before anything is saved.</p>
              ${pdfLine}
              ${fullLink}
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#9ca3af">Sent via Requisly</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildPoSupplierEmailText(opts: {
  workspaceName: string;
  poNumber: string;
  supplierName: string;
  shipDateLabel: string | null;
  confirmAsIsUrl: string | null;
  markShippedUrl: string | null;
  supplierLinkUrl: string | null;
  pdfUrl: string | null;
}): string {
  const lines = [
    `${opts.workspaceName}`,
    `Purchase order ${opts.poNumber}`,
    "",
    `Hi ${opts.supplierName}, please review this order.`,
  ];
  if (opts.shipDateLabel) {
    lines.push(`Requested ship date: ${opts.shipDateLabel}`);
  }
  lines.push("");
  if (opts.confirmAsIsUrl) {
    lines.push(`Confirm as-is: ${opts.confirmAsIsUrl}`);
  }
  if (opts.markShippedUrl) {
    lines.push(`Mark shipped: ${opts.markShippedUrl}`);
  }
  if (opts.pdfUrl) {
    lines.push(`Download PO PDF: ${opts.pdfUrl}`);
  }
  if (opts.supplierLinkUrl) {
    lines.push("");
    lines.push(`View full order & history: ${opts.supplierLinkUrl}`);
  }
  lines.push("");
  lines.push(
    "One-click links open a confirmation page first. You can also reply to this email — we’ll confirm what we understood before saving.",
  );
  return lines.join("\n");
}

export async function sendPoSupplierEmail(opts: {
  to: string;
  workspaceName: string;
  poNumber: string;
  supplierName: string;
  shipDateLabel: string | null;
  confirmAsIsUrl: string | null;
  markShippedUrl: string | null;
  supplierLinkUrl: string | null;
  pdfUrl: string | null;
  replyTo: string;
}): Promise<{ sent: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL || "Requisly <orders@requisly.com>";
  if (!resendKey) {
    return { sent: false, error: "RESEND_API_KEY is not set" };
  }
  if (!opts.to.trim()) {
    return { sent: false, error: "Supplier has no email address" };
  }

  const subject = `${opts.workspaceName}: ${opts.poNumber}`;
  const html = buildPoSupplierEmailHtml(opts);
  const text = buildPoSupplierEmailText(opts);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to.trim()],
        reply_to: opts.replyTo,
        subject,
        html,
        text,
      }),
    });
    if (!response.ok) {
      return { sent: false, error: await response.text() };
    }
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      error: e instanceof Error ? e.message : "send failed",
    };
  }
}

function button(href: string, label: string, bg: string): string {
  return `<a href="${escapeAttr(href)}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:6px">${escapeHtml(label)}</a>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
