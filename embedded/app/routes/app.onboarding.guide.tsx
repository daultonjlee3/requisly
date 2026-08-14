/**
 * Resource actions for the onboarding guide (ask / dismiss).
 * Mounted from OnboardingGuide via action="/app/onboarding/guide".
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { askOnboardingGuide } from "../lib/ai-onboarding.server";
import { getMerchantContext } from "../lib/merchant.server";
import {
  getOnboardingState,
  markGuideDismissed,
} from "../lib/onboarding.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "dismiss_onboarding_guide") {
    await markGuideDismissed(merchant.workspace.id);
    return { ok: true, guide: null as null, error: null as string | null };
  }

  if (intent === "ask_onboarding_guide") {
    const question = String(form.get("question") ?? "").trim();
    if (!question) {
      return { ok: false, guide: null, error: "Enter a question" };
    }
    const onboarding = await getOnboardingState(merchant.workspace.id);
    const guide = await askOnboardingGuide({
      question,
      context: {
        currentPath: String(form.get("current_path") ?? "/app"),
        supplierCount: onboarding.supplierCount,
        sentPoCount: onboarding.sentPoCount,
        checklist: onboarding.steps.map((s) => ({
          id: s.id,
          label: s.label,
          done: s.done,
        })),
        checklistSkipped: Boolean(onboarding.flags.checklist_skipped_at),
        welcomeDone: Boolean(onboarding.flags.welcome_completed_at),
      },
    });
    return {
      ok: true,
      guide: {
        summary: guide.summary,
        body: guide.body,
        source: guide.source,
        outOfScope: guide.outOfScope,
      },
      error: guide.error ?? null,
    };
  }

  return { ok: false, guide: null, error: "Unknown intent" };
};
