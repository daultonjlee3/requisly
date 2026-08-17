import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  matchParsedQuotesToLines,
  parseSupplierQuoteReply,
} from "@/lib/email-reply-parse";
import { handlePoInboundReply } from "@/lib/po-inbound-reply.server";
import {
  bareEmail,
  collectAddresses,
  extractEmailId,
  fetchReceivedEmail,
  firstInboundPlusAddress,
  verifyResendWebhook,
} from "@/lib/resend-webhook";

/**
 * Resend inbound webhook. Subscribe to email.received →
 * https://requisly.com/api/inbound/email
 *
 * Webhook payloads are metadata-only. Body is fetched from
 * GET /emails/receiving/:email_id.
 *
 * Env: RESEND_API_KEY, RESEND_WEBHOOK_SECRET, ANTHROPIC_API_KEY,
 * SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "webhook secret not configured" },
      { status: 503 },
    );
  }
  if (!verifyResendWebhook(raw, request.headers, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const payload = (() => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (!payload) {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const type = String(payload.type ?? "");
  if (type && type !== "email.received") {
    return NextResponse.json({ ok: true, ignored: true, reason: "not_inbound" });
  }

  const emailId = extractEmailId(payload);
  const received = emailId ? await fetchReceivedEmail(emailId) : null;

  const data = (payload.data ?? payload) as Record<string, unknown>;
  const inbound = firstInboundPlusAddress(
    collectAddresses(
      received?.to,
      data.to,
      data.received_for,
      payload.to,
      payload.received_for,
    ),
  );
  const from =
    received?.from ||
    (typeof data.from === "string" ? data.from : "") ||
    (typeof payload.from === "string" ? payload.from : "");
  const subject =
    received?.subject ||
    (typeof data.subject === "string" ? data.subject : "") ||
    (typeof payload.subject === "string" ? payload.subject : "");
  const text = (
    received?.text ||
    String(data.text ?? payload.text ?? payload.body ?? "")
  ).trim();
  if (!inbound) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "unrecognized_recipient",
    });
  }

  if (inbound.kind === "po") {
    const result = await handlePoInboundReply({
      token: inbound.token,
      from: bareEmail(from) || from,
      subject,
      text,
      emailId: received?.id ?? emailId,
    });
    if (!result.ok && result.error === "unknown_token") {
      return NextResponse.json({ ok: false, error: "unknown_token" }, { status: 404 });
    }
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "po_inbound_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json(result);
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: inv } = await supabase
    .from("quote_request_suppliers")
    .select("id, quote_request_id")
    .eq("token", inbound.token)
    .maybeSingle();
  if (!inv) {
    return NextResponse.json({ ok: false, error: "unknown_token" }, { status: 404 });
  }

  const { data: lines } = await supabase
    .from("quote_request_lines")
    .select("id, sku, description")
    .eq("quote_request_id", inv.quote_request_id)
    .order("sort_order");

  const parsed = parseSupplierQuoteReply(text);
  const matched = matchParsedQuotesToLines(
    parsed,
    (lines ?? []).map((l) => ({
      id: l.id as string,
      sku: (l.sku as string | null) ?? null,
      description: l.description as string,
    })),
  );

  for (const m of matched) {
    await supabase.from("quote_request_responses").upsert(
      {
        quote_request_supplier_id: inv.id,
        quote_request_line_id: m.quoteRequestLineId,
        unit_cost: m.unitCost,
        lead_time_days: m.leadTimeDays,
        source: "email",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "quote_request_supplier_id,quote_request_line_id" },
    );
  }

  if (matched.length) {
    await supabase
      .from("quote_request_suppliers")
      .update({
        status: "responded",
        responded_at: new Date().toISOString(),
      })
      .eq("id", inv.id);
  }

  return NextResponse.json({
    ok: true,
    applied: matched.length,
    confidence: parsed.confidence,
  });
}
