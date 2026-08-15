/**
 * Shared supplier email-reply parser for RFQ (and reusable for PO replies).
 * Extracts unit prices and lead times from plain-text replies.
 *
 * Patterns understood (per line or free-form):
 *   SKU ABC  $12.50  14 days
 *   Widget — 12.50 / 2 weeks
 *   Line 1: $4.00, lead 7d
 */
export type ParsedQuoteLine = {
  /** Matched against description or sku (lowercased). */
  matchKey: string | null;
  lineIndex: number | null;
  unitCost: number | null;
  leadTimeDays: number | null;
  raw: string;
};

export type ParsedSupplierReply = {
  lines: ParsedQuoteLine[];
  confidence: "high" | "medium" | "low";
};

const MONEY_RE =
  /\$\s*(\d{1,7}(?:,\d{3})*(?:\.\d{1,4})?)|(\d{1,7}(?:,\d{3})*\.\d{1,4})\b/;
const LEAD_RE =
  /(\d+)\s*(?:business\s+)?(?:days?|d\b)|(\d+)\s*weeks?|lead\s*(?:time)?[:\s]*(\d+)/i;

function parseMoney(fragment: string): number | null {
  const m = MONEY_RE.exec(fragment);
  if (!m) return null;
  const raw = m[1] ?? m[2];
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseLeadDays(fragment: string): number | null {
  const m = LEAD_RE.exec(fragment);
  if (!m) return null;
  if (m[1]) return Number(m[1]);
  if (m[2]) return Number(m[2]) * 7;
  if (m[3]) return Number(m[3]);
  return null;
}

/**
 * Parse a plain-text supplier reply into candidate quote lines.
 * Caller matches candidates onto RFQ lines by SKU/description/index.
 */
export function parseSupplierQuoteReply(body: string): ParsedSupplierReply {
  const text = body
    .replace(/\r\n/g, "\n")
    .replace(/^>.*$/gm, "")
    .trim();
  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^on .+ wrote:$/i.test(l));

  const parsed: ParsedQuoteLine[] = [];
  let idx = 0;
  for (const raw of rawLines) {
    const unitCost = parseMoney(raw);
    const leadTimeDays = parseLeadDays(raw);
    if (unitCost == null && leadTimeDays == null) continue;

    const lineIndexMatch = /^(?:line\s*)?#?\s*(\d+)\b/i.exec(raw);
    const lineIndex = lineIndexMatch ? Number(lineIndexMatch[1]) - 1 : null;

    // Strip money/lead to leave a match key
    let matchKey = raw
      .replace(MONEY_RE, " ")
      .replace(LEAD_RE, " ")
      .replace(/[:\-–—,|/]+/g, " ")
      .replace(/\b(?:qty|quantity|price|cost|each|ea|usd)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (matchKey.length < 2) matchKey = "";

    parsed.push({
      matchKey: matchKey || null,
      lineIndex: Number.isFinite(lineIndex as number) ? lineIndex : null,
      unitCost,
      leadTimeDays,
      raw,
    });
    idx += 1;
  }

  const withCost = parsed.filter((p) => p.unitCost != null).length;
  const confidence =
    withCost >= 2 ? "high" : withCost === 1 ? "medium" : "low";

  return { lines: parsed, confidence };
}

/** Map parsed reply onto known RFQ lines (id, sku, description). */
export function matchParsedQuotesToLines(
  parsed: ParsedSupplierReply,
  lines: Array<{ id: string; sku: string | null; description: string }>,
): Array<{
  quoteRequestLineId: string;
  unitCost: number;
  leadTimeDays: number | null;
}> {
  const out: Array<{
    quoteRequestLineId: string;
    unitCost: number;
    leadTimeDays: number | null;
  }> = [];
  const used = new Set<string>();

  for (const p of parsed.lines) {
    if (p.unitCost == null) continue;
    let hit: (typeof lines)[0] | undefined;

    if (p.lineIndex != null && lines[p.lineIndex]) {
      hit = lines[p.lineIndex];
    } else if (p.matchKey) {
      hit = lines.find((l) => {
        const sku = (l.sku ?? "").toLowerCase();
        const desc = l.description.toLowerCase();
        return (
          (sku && (p.matchKey!.includes(sku) || sku.includes(p.matchKey!))) ||
          desc.includes(p.matchKey!) ||
          p.matchKey!.includes(desc.slice(0, 24))
        );
      });
    }

    // Fallback: positional if counts align
    if (!hit && parsed.lines.length === lines.length) {
      const i = parsed.lines.indexOf(p);
      hit = lines[i];
    }

    if (!hit || used.has(hit.id)) continue;
    used.add(hit.id);
    out.push({
      quoteRequestLineId: hit.id,
      unitCost: p.unitCost,
      leadTimeDays: p.leadTimeDays,
    });
  }

  return out;
}
