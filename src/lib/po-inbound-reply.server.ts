import { createAdminClient } from "@/lib/supabase/admin";
import { randomToken } from "@/lib/format";
import { sendPendingNotifications } from "@/lib/notifications/send";
import type { PendingNotification } from "@/lib/notifications/types";
import {
  parseIsActionable,
  parsePoSupplierReply,
  type PoReplyLine,
  type PoReplyParse,
} from "@/lib/po-reply-parse";
import {
  buildPoReplyConfirmEmail,
  buildPoReplyUnparsedEmail,
} from "@/lib/po-inbound-reply-email";
import { bareEmail } from "@/lib/resend-webhook";

const TOKEN_TTL_DAYS = 14;
const BODY_CAP = 4000;

export type EmailParsePayload = {
  changes: PoReplyParse["changes"];
  confirmAsIs: boolean;
  shipDate: string | null;
  email: {
    from: string;
    subject: string;
    body: string;
    emailId: string | null;
  };
};

function supplierLinkUrl(token: string | null): string | null {
  if (!token) return null;
  const base = (
    process.env.SUPPLIER_LINK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://requisly.com"
  ).replace(/\/$/, "");
  return `${base}/s/${token}`;
}

function oneClickUrl(token: string): string {
  const base = (
    process.env.SUPPLIER_LINK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://requisly.com"
  ).replace(/\/$/, "");
  return `${base}/a/${token}`;
}

function merchantPoUrl(poId: string): string {
  const base = (
    process.env.EMBEDDED_APP_URL?.replace(/\/$/, "") ||
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    "https://app.requisly.com"
  );
  return `${base}/app/purchase-orders/${poId}`;
}

function emailSummary(from: string, subject: string, body: string): string {
  const clipped = body.trim().slice(0, BODY_CAP);
  const subj = subject.trim() ? `\nSubject: ${subject.trim()}` : "";
  return `From: ${from}${subj}\n\n${clipped}`;
}

async function listOwnerEmails(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
): Promise<string[]> {
  const { data: owners } = await admin
    .from("profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");
  const emails: string[] = [];
  for (const row of owners ?? []) {
    const { data } = await admin.auth.admin.getUserById(row.id as string);
    if (data.user?.email) emails.push(data.user.email);
  }
  return emails;
}

async function sendResendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { sent: false, error: "RESEND_API_KEY is not set" };
  const from = process.env.RESEND_FROM_EMAIL || "Requisly <orders@requisly.com>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!response.ok) {
    return { sent: false, error: await response.text() };
  }
  return { sent: true };
}

async function existingInboundEvent(
  admin: ReturnType<typeof createAdminClient>,
  poId: string,
  emailId: string | null,
): Promise<{ id: string; outcome: string } | null> {
  if (!emailId) return null;
  const { data } = await admin
    .from("po_timeline_events")
    .select("id, metadata")
    .eq("po_id", poId)
    .eq("event_type", "email_reply")
    .contains("metadata", { email_id: emailId })
    .limit(1);
  const row = data?.[0];
  if (!row) return null;
  const meta = (row.metadata ?? {}) as { parse_outcome?: string };
  return {
    id: row.id as string,
    outcome: meta.parse_outcome ?? "pending",
  };
}

export async function handlePoInboundReply(opts: {
  token: string;
  from: string;
  subject: string;
  text: string;
  emailId: string | null;
}): Promise<{
  ok: boolean;
  error?: string;
  outcome?: string;
  parseConfidence?: string;
}> {
  const admin = createAdminClient();
  const { data: link, error: linkError } = await admin
    .from("supplier_link_tokens")
    .select("token, po_id")
    .eq("token", opts.token)
    .maybeSingle();
  if (linkError) {
    return { ok: false, error: `token_lookup: ${linkError.message}` };
  }
  if (!link) {
    return { ok: false, error: "unknown_token" };
  }

  const { data: po } = await admin
    .from("purchase_orders")
    .select("id, po_number, status, workspace_id, requested_ship_date")
    .eq("id", link.po_id)
    .maybeSingle();
  if (!po) return { ok: false, error: "unknown_po" };

  const { data: workspace } = await admin
    .from("workspaces")
    .select("name")
    .eq("id", po.workspace_id)
    .maybeSingle();

  const { data: lineRows } = await admin
    .from("po_line_items")
    .select("id, description, sku, qty, unit_cost")
    .eq("po_id", po.id);

  const lines: PoReplyLine[] = (lineRows ?? []).map((row) => ({
    id: row.id as string,
    description: String(row.description ?? ""),
    sku: (row.sku as string | null) ?? null,
    qty: Number(row.qty) || 0,
    unitCost: Number(row.unit_cost) || 0,
  }));

  const existing = await existingInboundEvent(
    admin,
    po.id as string,
    opts.emailId,
  );
  if (existing && existing.outcome !== "pending") {
    return { ok: true, outcome: "duplicate" };
  }

  const from = bareEmail(opts.from) || opts.from.trim() || "supplier";
  const body = opts.text.trim();
  const summary = emailSummary(from, opts.subject, body);

  let loggedId = existing?.id ?? null;
  if (!loggedId) {
    const { data: logged, error: logError } = await admin
      .from("po_timeline_events")
      .insert({
        po_id: po.id,
        event_type: "email_reply",
        actor: "supplier",
        metadata: {
          kind: "inbound_email",
          summary,
          from,
          subject: opts.subject,
          body: body.slice(0, BODY_CAP),
          email_id: opts.emailId,
          parse_outcome: "pending",
        },
      })
      .select("id")
      .single();
    if (logError) {
      return { ok: false, error: logError.message };
    }
    loggedId = logged?.id ?? null;
  }

  const parsed = await parsePoSupplierReply(body, lines);
  const workspaceName = workspace?.name?.trim() || "Merchant";
  const poNumber = String(po.po_number ?? "PO");
  const linkUrl = supplierLinkUrl(link.token as string);
  const canWrite =
    po.status === "sent" || po.status === "viewed";

  if (canWrite && parseIsActionable(parsed)) {
    const confirmToken = randomToken(24);
    const payload: EmailParsePayload = {
      changes: parsed.changes,
      confirmAsIs: parsed.confirmAsIs,
      shipDate: parsed.shipDate ?? (po.requested_ship_date as string | null),
      email: {
        from,
        subject: opts.subject,
        body: body.slice(0, BODY_CAP),
        emailId: opts.emailId,
      },
    };
    const expiresAt = new Date(
      Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error: tokenError } = await admin
      .from("supplier_one_click_tokens")
      .insert({
        workspace_id: po.workspace_id,
        po_id: po.id,
        token: confirmToken,
        action: "confirm_email_parse",
        ship_date: payload.shipDate,
        expires_at: expiresAt,
        payload,
      });
    if (tokenError) {
      return { ok: false, error: tokenError.message };
    }

    const email = buildPoReplyConfirmEmail({
      poNumber,
      workspaceName,
      parsed,
      lines,
      confirmUrl: oneClickUrl(confirmToken),
      correctUrl: linkUrl,
    });
    const sent = await sendResendEmail({
      to: from.includes("@") ? from : "",
      ...email,
    });
    if (!sent.sent && from.includes("@")) {
      return { ok: false, error: sent.error ?? "confirm_email_failed" };
    }

    if (loggedId) {
      await admin
        .from("po_timeline_events")
        .update({
          metadata: {
            kind: "inbound_email",
            summary,
            from,
            subject: opts.subject,
            body: body.slice(0, BODY_CAP),
            email_id: opts.emailId,
            parse_outcome: "awaiting_confirm",
            parse_summary: parsed.summary,
            parse_confidence: parsed.confidence,
          },
        })
        .eq("id", loggedId);
    }

    return {
      ok: true,
      outcome: "awaiting_confirm",
      parseConfidence: parsed.confidence,
    };
  }

  const fallback = buildPoReplyUnparsedEmail({
    poNumber,
    workspaceName,
    supplierLinkUrl: linkUrl,
  });
  if (from.includes("@")) {
    await sendResendEmail({ to: from, ...fallback });
  }

  if (loggedId) {
    await admin
      .from("po_timeline_events")
      .update({
        metadata: {
          kind: "inbound_email",
          summary,
          from,
          subject: opts.subject,
          body: body.slice(0, BODY_CAP),
          email_id: opts.emailId,
          parse_outcome: "unparsed",
          parse_summary: parsed.summary,
          parse_confidence: parsed.confidence,
        },
      })
      .eq("id", loggedId);
  }

  await notifyMerchantUnparsed({
    admin,
    workspaceId: po.workspace_id as string,
    poId: po.id as string,
    poNumber,
    from,
    body,
  });

  return {
    ok: true,
    outcome: "unparsed",
    parseConfidence: parsed.confidence,
  };
}

async function notifyMerchantUnparsed(opts: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  poId: string;
  poNumber: string;
  from: string;
  body: string;
}): Promise<void> {
  const recipients = await listOwnerEmails(opts.admin, opts.workspaceId);
  if (!recipients.length) return;
  const pending: PendingNotification[] = recipients.map((email) => ({
    workspace_id: opts.workspaceId,
    rule_type: "inbound_reply_unparsed",
    po_id: opts.poId,
    po_number: opts.poNumber,
    dedupe_key: `inbound_reply_unparsed:${opts.poId}:${Date.now()}`,
    recipient_email: email,
    subject: `We couldn't parse a supplier reply on ${opts.poNumber}`,
    body: [
      `${opts.from} replied to ${opts.poNumber}, but Requisly could not understand the message.`,
      "",
      "Their email:",
      opts.body.slice(0, BODY_CAP) || "(empty)",
      "",
      `Open the PO: ${merchantPoUrl(opts.poId)}`,
    ].join("\n"),
  }));
  await sendPendingNotifications(opts.admin, pending);
}

export async function applyConfirmedEmailParse(opts: {
  linkToken: string;
  poId: string;
  payload: EmailParsePayload;
}): Promise<void> {
  const admin = createAdminClient();
  if (opts.payload.changes.length) {
    const { error } = await admin.rpc("supplier_link_propose_changes", {
      p_token: opts.linkToken,
      p_changes: opts.payload.changes,
    });
    if (error) throw new Error(error.message);
  } else if (opts.payload.confirmAsIs) {
    const { error } = await admin.rpc("supplier_link_confirm", {
      p_token: opts.linkToken,
      p_ship_date: opts.payload.shipDate,
    });
    if (error) throw new Error(error.message);
  } else {
    throw new Error("Nothing to apply from this interpretation.");
  }

  const summary = emailSummary(
    opts.payload.email.from,
    opts.payload.email.subject,
    opts.payload.email.body,
  );
  await admin.from("po_timeline_events").insert({
    po_id: opts.poId,
    event_type: "email_reply",
    actor: "supplier",
    metadata: {
      kind: "email_parse_confirmed",
      summary: `Supplier confirmed their email interpretation.\n\n${summary}`,
      from: opts.payload.email.from,
      subject: opts.payload.email.subject,
      body: opts.payload.email.body,
      email_id: opts.payload.email.emailId,
      parse_outcome: "confirmed",
    },
  });
}
