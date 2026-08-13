/**
 * Claude Haiku narration for in-lane insights.
 * Structured facts in → short merchant-facing copy out.
 * On any failure, callers must keep using deterministic template fallbacks.
 */
export type NarratedCopy = {
  summary: string;
  body: string | null;
  source: "claude" | "template";
  error?: string;
};

/** Claude Haiku 4.5 — small structured summarization, not a reasoning model. */
export const CLAUDE_INSIGHT_MODEL = "claude-haiku-4-5";

const CLAUDE_TIMEOUT_MS = 12_000;

const SYSTEM_PROMPT = `You write short merchant-facing insights for Requisly, a Shopify purchasing app.

Rules (non-negotiable):
- Use ONLY the numbers, names, dates, SKUs, and statuses present in the Facts JSON.
- Never invent a supplier name, PO number, percentage, dollar amount, date, or SKU.
- Never claim sales velocity, demand forecasts, or data not in Facts.
- Tone: direct, operational, calm — like a procurement ops note, not marketing.
- Do not mention that you are an AI, Claude, or a language model.
- For draft_po_suggestion: stress that the draft was NOT sent and needs merchant review.
- Respond with JSON only, no markdown fences: {"summary":"...","body":null_or_string}
- "summary" is 1–2 sentences max (digest summary may be slightly longer).
- "body" is optional detail (digest: multi-line plain text; others: null unless Facts include a body_hint).`;

function extractJsonObject(text: string): { summary?: string; body?: string | null } | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as {
      summary?: string;
      body?: string | null;
    };
  } catch {
    return null;
  }
}

/**
 * Ask Claude to narrate an insight from structured facts.
 * Always returns usable copy — falls back to `fallback` on missing key, timeout, or bad JSON.
 */
export async function narrateInsight(opts: {
  insightType: string;
  facts: Record<string, unknown>;
  fallback: { summary: string; body?: string | null };
}): Promise<NarratedCopy> {
  const fallback: NarratedCopy = {
    summary: opts.fallback.summary,
    body: opts.fallback.body ?? null,
    source: "template",
  };

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return { ...fallback, error: "ANTHROPIC_API_KEY is not set" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

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
        max_tokens: opts.insightType === "daily_digest" ? 900 : 350,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              `Insight type: ${opts.insightType}`,
              "",
              "Facts (JSON — ground truth; do not add outside this object):",
              JSON.stringify(opts.facts, null, 2),
              "",
              'Respond with JSON only: {"summary":"...","body":null_or_string}',
            ].join("\n"),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        ...fallback,
        error: `Claude HTTP ${response.status}: ${errText.slice(0, 240)}`,
      };
    }

    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text =
      payload.content?.find((block) => block.type === "text")?.text ?? "";
    const parsed = extractJsonObject(text);
    const summary = parsed?.summary?.trim();
    if (!summary) {
      return { ...fallback, error: "Claude returned empty or invalid JSON" };
    }

    const body =
      parsed?.body === undefined
        ? fallback.body
        : parsed.body == null || parsed.body === ""
          ? null
          : String(parsed.body);

    return {
      summary,
      body: opts.insightType === "daily_digest" ? body ?? fallback.body : body,
      source: "claude",
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Claude timed out after ${CLAUDE_TIMEOUT_MS}ms`
          : err.message
        : "Claude request failed";
    return { ...fallback, error: message };
  } finally {
    clearTimeout(timer);
  }
}
