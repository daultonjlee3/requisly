/**
 * Map merchant free-text questions onto allowlisted report templates.
 * Never generates SQL — only returns templateId + sanitized params.
 */
import { CLAUDE_INSIGHT_MODEL } from "./ai-narration.server";
import { REPORT_TEMPLATES } from "./report-builder.server";
import {
  REPORT_TEMPLATE_DEFS,
  availableFieldsHint,
  mapReportPromptHeuristic,
  sanitizeReportParams,
  unmatchedExplanation,
  type ReportParams,
  type ReportPromptContext,
} from "./report-params";
import { startTimer } from "./timing.server";

export type ReportPromptMatch = {
  templateId: string;
  params: ReportParams;
  confidence: "high" | "medium" | "low";
  source: "heuristic" | "claude" | "none";
  /** Human-readable explanation of what will run — or why it will not. */
  explanation: string;
  declined?: boolean;
};

const TEMPLATE_IDS = new Set(REPORT_TEMPLATES.map((t) => t.id));

export type { ReportPromptContext };

async function classifyWithClaude(
  prompt: string,
  previous?: ReportPromptContext | null,
): Promise<ReportPromptMatch | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const catalog = REPORT_TEMPLATE_DEFS.map((t) => ({
    id: t.id,
    question: t.question,
    blurb: t.blurb,
    kind: t.kind,
    supportsDate: t.supportsDate,
    allowedParams: t.allowedParams,
    allowedColumns: t.allowedColumns,
    allowedSorts: t.allowedSorts,
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
        max_tokens: 400,
        system: `You map a merchant question to ONE Report Builder template + params.
Rules:
- Respond with JSON only: {"templateId":"...","params":{},"confidence":"high|medium|low","reason":"..."}
- templateId MUST be one of the catalog ids. Never invent ids.
- params may ONLY include keys listed on that template's allowedParams.
- columns must be a comma-separated subset of allowedColumns. sorts must be from allowedSorts.
- period may be this_quarter|last_quarter|last_30d|last_90d|this_year|last_year.
- Never invent SQL, tables, columns, or calculations. Mapping only. Never do arithmetic.
- If the question is a FOLLOW-UP on the previous report, keep the same templateId and only change params, unless they clearly ask a different catalog question.
- If they ask for a field/metric the current template cannot produce (e.g. profit margin on a PO listing), return {"templateId":null,"params":{},"confidence":"low","reason":"...what is actually available..."}.
- Do not switch templates to look more capable. Decline honestly.
- If nothing fits, return {"templateId":null,"params":{},"confidence":"low","reason":"..."}`,
        messages: [
          {
            role: "user",
            content: `Catalog:\n${JSON.stringify(catalog)}\n\nPrevious mapping:\n${
              previous
                ? JSON.stringify({
                    templateId: previous.templateId,
                    params: previous.params,
                    prompt: previous.prompt ?? null,
                  })
                : "none"
            }\n\nQuestion:\n${prompt}`,
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
      reason?: string;
    };
    if (!parsed.templateId || !TEMPLATE_IDS.has(parsed.templateId)) {
      return {
        templateId: "",
        params: previous?.params ?? {},
        confidence: "low",
        source: "claude",
        declined: true,
        explanation:
          parsed.reason?.trim() || unmatchedExplanation(previous ?? null),
      };
    }
    const meta = REPORT_TEMPLATES.find((t) => t.id === parsed.templateId)!;
    const conf =
      parsed.confidence === "high" || parsed.confidence === "medium"
        ? parsed.confidence
        : "low";
    const inherited =
      previous && parsed.templateId === previous.templateId
        ? previous.params
        : {};
    return {
      templateId: parsed.templateId,
      params: sanitizeReportParams(parsed.templateId, {
        ...inherited,
        ...(parsed.params ?? {}),
      }),
      confidence: conf,
      source: "claude",
      explanation:
        parsed.reason?.trim() || `Mapped to “${meta.question}”.`,
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
 * Out-of-scope follow-ups decline without calling Claude (so it cannot guess).
 */
export async function mapPromptToReportTemplate(
  promptRaw: string,
  previous?: ReportPromptContext | null,
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

  const heuristic = mapReportPromptHeuristic(prompt, previous);
  if (heuristic?.declined) {
    timer.end({ matched: false, declined: true });
    return {
      templateId: "",
      params: previous?.params ?? {},
      confidence: "low",
      source: "none",
      declined: true,
      explanation: heuristic.explanation,
    };
  }
  if (heuristic && heuristic.confidence === "high") {
    timer.end({ matched: true, source: "heuristic" });
    return {
      templateId: heuristic.templateId,
      params: heuristic.params,
      confidence: heuristic.confidence,
      source: "heuristic",
      explanation: heuristic.explanation,
    };
  }

  const claude = await classifyWithClaude(prompt, previous);
  if (claude?.declined) {
    timer.end({ matched: false, declined: true, source: "claude" });
    return claude;
  }
  if (claude && claude.templateId && claude.confidence !== "low") {
    timer.end({ matched: true, source: "claude" });
    return claude;
  }

  if (heuristic && heuristic.templateId) {
    timer.end({ matched: true, source: "heuristic_fallback" });
    return {
      templateId: heuristic.templateId,
      params: heuristic.params,
      confidence: heuristic.confidence,
      source: "heuristic",
      explanation: heuristic.explanation,
    };
  }

  if (claude?.templateId) {
    timer.end({ matched: true, source: "claude_low" });
    return claude;
  }

  timer.end({ matched: false });
  return {
    templateId: "",
    params: previous?.params ?? {},
    confidence: "low",
    source: "none",
    declined: Boolean(previous?.templateId),
    explanation:
      claude?.explanation ||
      (previous
        ? `${unmatchedExplanation(previous)} ${availableFieldsHint(previous.templateId)}`
        : unmatchedExplanation(null)),
  };
}
