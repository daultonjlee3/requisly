import { createHmac, timingSafeEqual } from "crypto";

const TOLERANCE_SECONDS = 300;

export function verifyResendWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(Date.now() / 1000 - ts);
  if (skew > TOLERANCE_SECONDS) return false;

  const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(keyB64, "base64");
  } catch {
    return false;
  }

  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", key).update(signed).digest("base64");
  const expectedBuf = Buffer.from(expected);

  for (const part of signature.split(/\s+/)) {
    const sig = part.startsWith("v1,") ? part.slice(3) : part;
    const got = Buffer.from(sig);
    if (got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf)) {
      return true;
    }
  }
  return false;
}

export function extractEmailId(payload: Record<string, unknown>): string | null {
  const data = payload.data as Record<string, unknown> | undefined;
  const id = data?.email_id ?? payload.email_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function extractAddress(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
    const o = value[0] as { email?: string; address?: string };
    return o.email ?? o.address ?? null;
  }
  return null;
}

export function bareEmail(value: string | null): string | null {
  if (!value) return null;
  const angled = /<([^>]+)>/.exec(value);
  const raw = (angled?.[1] ?? value).trim().toLowerCase();
  return raw || null;
}

export function parseInboundPlusAddress(
  to: string | null,
): { kind: "po" | "rfq"; token: string } | null {
  const email = bareEmail(to);
  if (!email) return null;
  const match = /^(po|rfq)\+([a-zA-Z0-9_-]+)@requisly\.com$/i.exec(email);
  if (!match) return null;
  return {
    kind: match[1].toLowerCase() as "po" | "rfq",
    token: match[2],
  };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export type ReceivedEmail = {
  id: string | null;
  from: string;
  to: string | null;
  subject: string;
  text: string;
};

export function collectAddresses(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (typeof value === "string" && value.trim()) out.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) out.push(item);
        else if (item && typeof item === "object") {
          const o = item as { email?: string; address?: string };
          if (o.email) out.push(o.email);
          if (o.address) out.push(o.address);
        }
      }
    }
  }
  return out;
}

export function firstInboundPlusAddress(
  addresses: string[],
): { kind: "po" | "rfq"; token: string } | null {
  for (const address of addresses) {
    const parsed = parseInboundPlusAddress(address);
    if (parsed) return parsed;
  }
  return null;
}

export async function fetchReceivedEmail(
  emailId: string,
): Promise<ReceivedEmail | null> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  const response = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!response.ok) return null;
  const json = (await response.json()) as Record<string, unknown>;
  const data = (
    json.data && typeof json.data === "object" ? json.data : json
  ) as {
    id?: string;
    from?: string;
    to?: unknown;
    subject?: string;
    text?: string | null;
    html?: string | null;
  };
  const text =
    (typeof data.text === "string" && data.text.trim()) ||
    (typeof data.html === "string" ? htmlToText(data.html) : "");
  return {
    id: data.id ?? emailId,
    from: typeof data.from === "string" ? data.from : "",
    to: extractAddress(data.to),
    subject: typeof data.subject === "string" ? data.subject : "",
    text,
  };
}
