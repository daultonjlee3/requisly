/**
 * Print onboarding guide answers for stop-report QA.
 *
 *   npx tsx --env-file=embedded/.env scripts/demo-onboarding-guide.ts
 */
async function main() {
  const { askOnboardingGuide, templateOnboardingGuideAnswer } = await import(
    "../embedded/app/lib/ai-onboarding.server.ts"
  );
  const { templateOnboardingNudge } = await import(
    "../embedded/app/lib/ai-agents.server.ts"
  );

  const context = {
    currentPath: "/app",
    supplierCount: 0,
    sentPoCount: 0,
    checklist: [
      { id: "connect_store", label: "Connect your Shopify store", done: true },
      { id: "add_supplier", label: "Add your first supplier", done: false },
      {
        id: "send_po",
        label: "Create and send your first PO",
        done: false,
      },
    ],
    checklistSkipped: false,
    welcomeDone: true,
  };

  const questions = [
    "What is Today's Work?",
    "How does Supplier Link work?",
    "When do Analytics and AI insights unlock?",
    "Can you forecast next month's demand from my sales?",
  ];

  console.log("=== ONBOARDING FLOW (summary) ===\n");
  console.log(
    "1. Welcome — ghosted-PO pain point → Get started / sample Analytics",
  );
  console.log(
    "2. Today's Work checklist — connect (done), add supplier, send first PO + Skip",
  );
  console.log(
    "3. Add supplier (onboarding=1) → CSV price sheet exact then fuzzy confirm",
  );
  console.log(
    "4. Analytics?sample=1 — demo workspace read-only + sample banner",
  );
  console.log(
    "5. First PO send → /app?activated=1 Banner + App Bridge toast",
  );
  console.log(
    "6. Stalled checklist → Operations onboarding_nudge email + insight",
  );
  console.log("7. Setup guide — Haiku + template fallback, answers only\n");

  console.log("=== RE-ENGAGEMENT NUDGE (template) ===\n");
  console.log(
    JSON.stringify(
      templateOnboardingNudge({
        workspaceName: "Acme Goods",
        nextStepLabel: "Add your first supplier",
        nextStepHref: "/app/suppliers/new?onboarding=1",
        daysStalled: 2,
      }),
      null,
      2,
    ),
  );

  console.log("\n=== GUIDE Q&A ===\n");
  for (const question of questions) {
    const tpl = templateOnboardingGuideAnswer(question, context);
    const answered = await askOnboardingGuide({ question, context });
    console.log(`Q: ${question}`);
    console.log(
      `  template outOfScope=${tpl.outOfScope} → ${tpl.summary}`,
    );
    console.log(
      `  live source=${answered.source} outOfScope=${answered.outOfScope} → ${answered.summary}`,
    );
    if (answered.body) console.log(`  body: ${answered.body}`);
    if (answered.error) console.log(`  narration_error: ${answered.error}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
