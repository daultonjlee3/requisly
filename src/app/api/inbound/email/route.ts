import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  matchParsedQuotesToLines,
  parseSupplierQuoteReply,
} from "@/lib/email-reply-parse";

/**
 * Resend inbound webhook for RFQ (and future PO) email replies.
 * Expects To: rfq+{token}@inbound… or po+{token}@…
 *
 * Env: RESEND_WEBHOOK_SECRET (optional verify), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const to =
    extractAddress(payload?.data?.to) ||
    extractAddress(payload?.to) ||
    extractAddress(payload?.envelope?.to);
  const text =
    String(payload?.data?.text ?? payload?.text ?? payload?.body ?? "").trim();

  const rfqMatch = /rfq\+([a-zA-Z0-9_-]+)@/i.exec(to ?? "");
  if (!rfqMatch) {
    // PO replies not implemented yet — acknowledge so Resend doesn't retry forever.
    return NextResponse.json({ ok: true, ignored: true, reason: "not_rfq" });
  }

  const token = rfqMatch[1];
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
    .eq("token", token)
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

function extractAddress(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
    const o = value[0] as { email?: string; address?: string };
    return o.email ?? o.address ?? null;
  }
  return null;
}
