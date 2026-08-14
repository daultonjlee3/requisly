/** SKU normalize + exact/fuzzy match for price-sheet import. No auto-apply. */

export function normalizeSku(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_./]+/g, "");
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** Dice coefficient on character bigrams — 0..1. */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

export function combinedConfidence(a: string, b: string): number {
  const na = normalizeSku(a);
  const nb = normalizeSku(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dice = diceSimilarity(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const lev = 1 - levenshtein(na, nb) / maxLen;
  return Math.round(Math.max(0, Math.min(1, dice * 0.65 + lev * 0.35)) * 1000) / 1000;
}

export type SkuCandidate = {
  productVariantId: string;
  title: string;
  sku: string;
  confidence: number;
};

export function rankSkuCandidates(
  querySku: string,
  catalog: Array<{ id: string; title: string; sku: string | null }>,
  limit = 3,
): SkuCandidate[] {
  const q = normalizeSku(querySku);
  if (!q) return [];
  const scored: SkuCandidate[] = [];
  for (const row of catalog) {
    if (!row.sku) continue;
    const confidence = combinedConfidence(q, row.sku);
    if (confidence < 0.45) continue;
    scored.push({
      productVariantId: row.id,
      title: row.title,
      sku: row.sku,
      confidence,
    });
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, limit);
}
