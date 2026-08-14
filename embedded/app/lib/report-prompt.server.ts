/**
 * Map merchant free-text questions onto allowlisted report templates.
 * Never generates SQL — only returns templateId + sanitized params.
 */
import { CLAUDE_INSIGHT_MODEL } from "./ai-narration.server";
import { REPORT_TEMPLATES } from "./report-builder.server";
import { startTimer } from "./timing.server";

export type ReportPromptMatch = {
  templateId: string;
  params: Record<string, string | number | boolean>;
  confidence: "high" | "medium" | "low";
  source: "heuristic" | "claude" | "none";
  /** Human-readable explanation of what will run. */
  explanation: string;
};

const TEMPLATE_IDS = new Set(REPORT_TEMPLATES.map((t) => t.id));

const ALLOWED_PARAM_KEYS = new Set([
  "limit",
  "min_margin_pct",
  "max_margin_pct",
]);

function sanitizeParams(
  raw: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_PARAM_KEYS.has(key)) continue;
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (key === "limit") out[key] = Math.min(50, Math.max(1, Math.round(value)));
      else if (key.endsWith("_pct"))
        out[key] = Math.min(100, Math.max(0, Math.round(value * 10) / 10));
      else out[key] = value;
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        if (key === "limit") out[key] = Math.min(50, Math.max(1, Math.round(n)));
        else if (key.endsWith("_pct"))
          out[key] = Math.min(100, Math.max(0, Math.round(n * 10) / 10));
        else out[key] = n;
      }
    }
  }
  return out;
}

function extractThresholds(prompt: string): Record<string, number> {
  const params: Record<string, number> = {};
  const below = prompt.match(
    /\b(?:below|under|less than|<)\s*(\d{1,3}(?:\.\d+)?)\s*%?/i,
  );
  const above = prompt.match(
    /\b(?:above|over|more than|greater than|>)\s*(\d{1,3}(?:\.\d+)?)\s*%?/i,
  );
  const topN = prompt.match(/\b(?:top|bottom)\s*(\d{1,2})\b/i);
  if (below) params.max_margin_pct = Number(below[1]);
  if (above) params.min_margin_pct = Number(above[1]);
  if (topN) params.limit = Number(topN[1]);
  return params;
}

function scoreHeuristic(prompt: string): ReportPromptMatch | null {
  const p = prompt.toLowerCase();
  const thresholds = extractThresholds(p);

  type Cand = { id: string; score: number; why: string };
  const cands: Cand[] = [];

  const bump = (id: string, score: number, why: string) => {
    cands.push({ id, score, why });
  };

  if (
    /\b(spend|costing|purchase).*\b(revenue|sales)\b|\brevenue\b.*\b(spend|cost)\b|\bspend vs\b|\bvs\.?\s*revenue\b/.test(
      p,
    )
  ) {
    bump("spend_vs_revenue_by_supplier", 10, "spend vs revenue");
  }
  if (
    /\b(profit|margin).*\b(reliable|on[- ]?time|ship)\b|\breliable.*\b(profit|margin)\b|\b(thin|low).*\bmargin.*\b(ship|late|reliable)\b|\b(ship|late|reliable).*\b(thin|low).*\bmargin\b/.test(
      p,
    )
  ) {
    bump("profit_vs_reliability", 12, "profit vs reliability");
  }
  if (
    /\bmargin\b/.test(p) &&
    /\bsupplier/.test(p) &&
    !/\bsku|product|variant\b/.test(p)
  ) {
    bump("margin_by_supplier", 9, "margin by supplier");
  }
  if (
    /\b(costing me margin|thin(?:nest)? margins?|margin problem)\b/.test(p) &&
    !/\b(ship|late|reliable|sku|product)\b/.test(p)
  ) {
    bump("margin_by_supplier", 10, "margin pressure");
  }
  if (
    /\b(late|miss(?:es|ing)? ship|on[- ]?time|delivery reliability)\b/.test(p) &&
    /\bsupplier/.test(p)
  ) {
    bump("late_suppliers", 9, "late suppliers");
  }
  if (/\b(where.*(spend|money)|spend by supplier|po spend)\b/.test(p)) {
    bump("spend_by_supplier", 8, "spend by supplier");
  }
  if (/\b(sku|product).*\bmargin|\bmargin.*\b(sku|product)\b/.test(p)) {
    bump("top_sku_margin", 9, "SKU margins");
  }
  if (/\bthinnest\b.*\bmargin|\blow(?:est)? margin\b/.test(p)) {
    bump("top_sku_margin", 8, "thinnest margins");
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0]!;
  const meta = REPORT_TEMPLATES.find((t) => t.id === best.id)!;
  const params = sanitizeParams(thresholds);
  return {
    templateId: best.id,
    params,
    confidence: best.score >= 9 ? "high" : "medium",
    source: "heuristic",
    explanation: `Matched “${meta.question}” (${best.why}).`,
  };
}

async function classifyWithClaude(
  prompt: string,
): Promise<ReportPromptMatch | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const catalog = REPORT_TEMPLATES.map((t) => ({
    id: t.id,
    question: t.question,
    blurb: t.blurb,
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_INSIGHT_MODEL,
        max_tokens: 200,
        system: `You map a merchant question to ONE Report Builder template.
Rules:
- Respond with JSON only: {"templateId":"...","params":{},"confidence":"high|medium|low"}
- templateId MUST be one of the catalog ids. Never invent ids.
- params may only include: limit (1-50), min_margin_pct, max_margin_pct.
- Never invent SQL, tables, or calculations. Mapping only.
- If nothing fits, return {"templateId":null,"params":{},"confidence":"low"}`,
        messages: [
          {
            role: "user",
            content: `Catalog:\n${JSON.stringify(catalog)}\n\nQuestion:\n${prompt}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      templateId?: string | null;
      params?: Record<string, unknown>;
      confidence?: string;
    };
    if (!parsed.templateId || !TEMPLATE_IDS.has(parsed.templateId)) return null;
    const meta = REPORT_TEMPLATES.find((t) => t.id === parsed.templateId)!;
    const conf =
      parsed.confidence === "high" || parsed.confidence === "medium"
        ? parsed.confidence
        : "low";
    return {
      templateId: parsed.templateId,
      params: sanitizeParams({
        ...extractThresholds(prompt),
        ...(parsed.params ?? {}),
      }),
      confidence: conf,
      source: "claude",
      explanation: `Mapped to “${meta.question}”.`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a free-text prompt to an allowlisted template + params.
 * Prefer heuristics (fast); fall back to Haiku classification.
 */
export async function mapPromptToReportTemplate(
  promptRaw: string,
): Promise<ReportPromptMatch> {
  const timer = startTimer("report:mapPrompt");
  const prompt = promptRaw.trim().slice(0, 500);
  if (!prompt) {
    timer.end({ matched: false });
    return {
      templateId: "",
      params: {},
      confidence: "low",
      source: "none",
      explanation: "Enter a question to run a report.",
    };
  }

  const heuristic = scoreHeuristic(prompt);
  if (heuristic && heuristic.confidence === "high") {
    timer.end({ matched: true, source: "heuristic" });
    return heuristic;
  }

  const claude = await classifyWithClaude(prompt);
  if (claude && claude.confidence !== "low") {
    timer.end({ matched: true, source: "claude" });
    return claude;
  }

  if (heuristic) {
    timer.end({ matched: true, source: "heuristic_fallback" });
    return heuristic;
  }

  if (claude) {
    timer.end({ matched: true, source: "claude_low" });
    return claude;
  }

  timer.end({ matched: false });
  return {
    templateId: "",
    params: {},
    confidence: "low",
    source: "none",
    explanation:
      "Couldn't match that to a built-in report. Try a starter card, or ask about margin, spend, revenue, or on-time shipping.",
  };
}
