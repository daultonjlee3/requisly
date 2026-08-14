import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxies the daily AI agents cron to the embedded Shopify app host.
 * Auth: Authorization: Bearer $CRON_SECRET
 *
 * Prefer scheduling this on the embedded Vercel project directly
 * (`/api/cron/ai-agents`). This root proxy remains for transition.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = (
    process.env.EMBEDDED_APP_URL ||
    process.env.SHOPIFY_APP_URL ||
    ""
  ).replace(/\/$/, "");
  if (!base) {
    return NextResponse.json(
      {
        error:
          "EMBEDDED_APP_URL (or SHOPIFY_APP_URL) is not set — AI cron runs on the embedded app host",
      },
      { status: 503 },
    );
  }

  const incoming = new URL(request.url);
  const target = new URL("/api/cron/ai-agents", base);
  incoming.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI agents proxy failed" },
      { status: 502 },
    );
  }
}
