/**
 * Constrained Haiku onboarding guide — answers only, never acts.
 * Grounded to Requisly feature facts; declines out-of-scope with support pointer.
 */
import {
  CLAUDE_INSIGHT_MODEL,
  type NarratedCopy,
} from "./ai-narration.server";
import { SUPPORT_EMAIL } from "./onboarding.server";

export type OnboardingGuideContext = {
  currentPath: string;
  supplierCount: number;
  sentPoCount: number;
  checklist: Array<{ id: string; label: string; done: boolean }>;
  checklistSkipped: boolean;
  welcomeDone: boolean;
};

/** Explicit product facts — do not invent beyond this list. */
export const REQUISLY_FEATURE_FACTS = `
Requisly is a Shopify purchasing / supplier-ops app. Primary object: Purchase Order.
Golden workflow timeline: Created → Sent → Viewed → Confirmed → Production (optional) → Shipped → In Transit (optional) → Partially Received → Received → Closed.
Today's Work: operational queues — waiting confirmation, arrivals today, ready to receive, overdue suppliers, recent supplier updates. Not a BI dashboard.
Suppliers: name + email required; contacts and terms optional. Supplier catalog maps SKUs with unit cost, case qty, MOQ, lead time.
Supplier Link: no-login magic link for suppliers to confirm ship date / mark shipped / add tracking. Enhancement, not a dependency.
Receiving: partial/full, condition codes good/damaged/wrong_item/backorder; inventory write-back to Shopify for catalog lines (not free-text).
Documents: attach to a PO (invoice, packing slip, etc.) — not a standalone library.
Analytics / AI insights: unlock after real closed-PO history (or demo workspace). Agents narrate facts from POs/receipts/pricing — never invent sales velocity; never auto-send POs.
Templates: saved PO line patterns (exists in app). Team invites: workspace members via invite link.
Explicitly NOT in product: demand forecasting, reorder from sales velocity as sales inference, ERP, in-house ACH/card payments, chat with suppliers, bulk multi-currency ERP features.
`.trim();

const SYSTEM_PROMPT = `You are the Requisly onboarding guide inside the Shopify embedded app.

Rules (non-negotiable):
- Answer ONLY using Requisly Feature Facts and the Context JSON.
- Never invent a feature, screen, integration, payment method, or forecast.
- Never take an action on the merchant's behalf (do not claim you created, sent, deleted, or invited).
- If the question is outside Feature Facts, decline briefly and tell them to email ${SUPPORT_EMAIL}.
- Tone: direct, calm, operational — like a procurement ops note.
- Do not mention that you are an AI, Claude, or a language model.
- Respond with JSON only: {"summary":"...","body":null_or_string}
- "summary" is 1–3 short sentences.`;

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

export function templateOnboardingGuideAnswer(
  question: string,
  context: OnboardingGuideContext,
): { summary: string; body: string | null; outOfScope: boolean } {
  const q = question.toLowerCase();
  const next = context.checklist.find((s) => !s.done);

  const outOfScopePatterns = [
    /forecast|demand|sales velocity|predict/,
    /\bach\b|wire transfer|pay suppliers|stripe|melio|credit card payment/,
    /erp|netsuite|quickbooks sync|accounting integration/,
    /chat with supplier|whatsapp|slack bot/,
  ];
  if (outOfScopePatterns.some((re) => re.test(q))) {
    return {
      summary: `That's outside what Requisly does today. Email ${SUPPORT_EMAIL} if you need help with something else.`,
      body: null,
      outOfScope: true,
    };
  }

  if (/today'?s work|dashboard|home/.test(q)) {
    return {
      summary:
        "Today's Work is your daily ops board — waiting confirmations, arrivals, ready-to-receive, and overdue suppliers. It fills in after you send POs.",
      body: next
        ? `Next setup step: ${next.label}.`
        : "Your setup checklist looks complete.",
      outOfScope: false,
    };
  }

  if (/supplier link|magic link|portal/.test(q)) {
    return {
      summary:
        "Supplier Link is a no-login magic link on each PO. Suppliers can confirm a ship date, mark shipped, and add tracking. Your merchant flow still works if they never open it.",
      body: null,
      outOfScope: false,
    };
  }

  if (/analytic|insight|scorecard|report/.test(q)) {
    return {
      summary:
        "Analytics and AI insights unlock after enough closed PO history (demo workspaces are eligible immediately). You can preview sample Analytics with “See what this looks like with real history.”",
      body: null,
      outOfScope: false,
    };
  }

  if (/receive|damaged|inventory/.test(q)) {
    return {
      summary:
        "Receiving completes the PO. You can receive partial or full quantities and mark lines good, damaged, wrong item, or backorder. Catalog lines write inventory back to Shopify; free-text lines do not.",
      body: null,
      outOfScope: false,
    };
  }

  if (/checklist|getting started|onboard|next/.test(q)) {
    return {
      summary: next
        ? `You're on ${context.currentPath}. Next: ${next.label}.`
        : context.checklistSkipped
          ? "You skipped the setup checklist — you can still add suppliers and send POs anytime from the nav."
          : "Setup looks complete — keep sending POs so Today's Work and Analytics fill in.",
      body: `Suppliers: ${context.supplierCount}. Sent POs: ${context.sentPoCount}.`,
      outOfScope: false,
    };
  }

  return {
      summary:
        "I can help with Today's Work, suppliers, POs, Supplier Link, receiving, and Analytics. Ask about one of those — or email " +
        SUPPORT_EMAIL +
        " for anything else.",
      body: null,
      outOfScope: false,
  };
}

export async function askOnboardingGuide(opts: {
  question: string;
  context: OnboardingGuideContext;
}): Promise<NarratedCopy & { outOfScope: boolean }> {
  const fallbackTpl = templateOnboardingGuideAnswer(
    opts.question,
    opts.context,
  );
  const fallback: NarratedCopy & { outOfScope: boolean } = {
    summary: fallbackTpl.summary,
    body: fallbackTpl.body,
    source: "template",
    outOfScope: fallbackTpl.outOfScope,
  };

  if (fallbackTpl.outOfScope) {
    return fallback;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return { ...fallback, error: "ANTHROPIC_API_KEY is not set" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

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
        max_tokens: 350,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              "Requisly Feature Facts:",
              REQUISLY_FEATURE_FACTS,
              "",
              "Context (JSON — ground truth for this merchant session):",
              JSON.stringify(opts.context, null, 2),
              "",
              `Merchant question: ${opts.question}`,
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

    return {
      summary,
      body:
        parsed?.body == null || parsed.body === ""
          ? null
          : String(parsed.body),
      source: "claude",
      outOfScope: false,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Claude timed out after 12000ms"
          : err.message
        : "Claude request failed";
    return { ...fallback, error: message };
  } finally {
    clearTimeout(timer);
  }
}
