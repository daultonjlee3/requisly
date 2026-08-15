/**
 * Outbound PO email to suppliers (Resend).
 * HTML/text live in src/lib/po-supplier-email.ts (not Polaris).
 * Reply-To uses inbound.requisly.com (MX must be configured in DNS).
 */
import {
  buildPoSupplierEmailHtml,
  buildPoSupplierEmailSubject,
  buildPoSupplierEmailText,
  poEmailFromAddress,
  type PoEmailLine,
} from "../../../src/lib/po-supplier-email";

export type { PoEmailLine };

export function inboundReplyToAddress(supplierLinkToken: string): string {
  const domain =
    process.env.RESEND_INBOUND_DOMAIN?.trim() || "inbound.requisly.com";
  return `po+${supplierLinkToken}@${domain}`;
}

export {
  buildPoSupplierEmailHtml,
  buildPoSupplierEmailSubject,
  buildPoSupplierEmailText,
  poEmailFromAddress,
};

export async function sendPoSupplierEmail(opts: {
  to: string;
  workspaceName: string;
  poNumber: string;
  supplierName: string;
  shipDateLabel: string | null;
  lines: PoEmailLine[];
  confirmAsIsUrl: string | null;
  markShippedUrl: string | null;
  supplierLinkUrl: string | null;
  pdfUrl: string | null;
  replyTo: string;
}): Promise<{ sent: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { sent: false, error: "RESEND_API_KEY is not set" };
  }
  if (!opts.to.trim()) {
    return { sent: false, error: "Supplier has no email address" };
  }

  const content = {
    workspaceName: opts.workspaceName,
    poNumber: opts.poNumber,
    supplierName: opts.supplierName,
    shipDateLabel: opts.shipDateLabel,
    lines: opts.lines,
    confirmAsIsUrl: opts.confirmAsIsUrl,
    markShippedUrl: opts.markShippedUrl,
    supplierLinkUrl: opts.supplierLinkUrl,
    pdfUrl: opts.pdfUrl,
  };

  const from = poEmailFromAddress(
    opts.workspaceName,
    process.env.RESEND_FROM_EMAIL || "Requisly <orders@requisly.com>",
  );
  const subject = buildPoSupplierEmailSubject(content);
  const html = buildPoSupplierEmailHtml(content);
  const text = buildPoSupplierEmailText(content);

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
