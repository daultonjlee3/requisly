/**
 * Adversarial narration stress tests — thin history, ties, missing alternate.
 *
 *   npx tsx --env-file=embedded/.env scripts/stress-ai-insights.ts
 */
import { narrateInsight } from "../embedded/app/lib/ai-narration.server.ts";
import {
  SCORECARD_MIN_COMPLETED_POS,
  templateAlternateSupplier,
} from "../embedded/app/lib/ai-agents.server.ts";

function section(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function pair(
  label: string,
  template: string,
  result: { summary: string; source: string; error?: string },
  expectNotes: string[],
) {
  console.log(`\n--- ${label} ---`);
  console.log("TEMPLATE:");
  console.log(template);
  console.log("CLAUDE:");
  console.log(result.summary);
  console.log(`(source=${result.source}${result.error ? `; err=${result.error}` : ""})`);
  console.log("CHECK:");
  for (const note of expectNotes) console.log(`  ? ${note}`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY required for stress tests");
  }

  // -------------------------------------------------------------------------
  section(
    "1) Thin history — exactly at scorecard gate (5 closed), mediocre on-time",
  );
  {
    const supplierName = "Thin History Co";
    const completed = SCORECARD_MIN_COMPLETED_POS; // 5
    const onTime = 0.6; // 3/5 on time → 40% late
    const latePct = Math.round((1 - onTime) * 100);
    const altName = "Steady Supply Inc";
    const template = templateAlternateSupplier({
      supplierName,
      latePct,
      completed,
      altName,
    });
    const result = await narrateInsight({
      insightType: "alternate_supplier",
      facts: {
        supplier_name: supplierName,
        completed_pos: completed,
        on_time_pct: onTime,
        late_pct: latePct,
        alternate_supplier_name: altName,
        alternate_on_time_pct: 0.8,
        alternate_completed_pos: 5,
        scorecard_min_completed_pos: SCORECARD_MIN_COMPLETED_POS,
        sample_note:
          "Only 5 closed POs — minimum gate. Treat as early signal, not a long trend.",
      },
      fallback: { summary: template },
    });
    pair("Thin history (5 POs, 60% on-time)", template, result, [
      "Mentions 5 completed / thin sample?",
      "Does NOT claim 'pattern over months' or high confidence?",
      "Keeps Thin History Co / Steady Supply Inc / 40% late or 60% on-time only?",
    ]);
  }

  // -------------------------------------------------------------------------
  section(
    "2) Tie — two suppliers identical on-time; no stronger alternate in facts",
  );
  {
    const supplierName = "North Bindery";
    const completed = 12;
    const onTime = 0.5;
    const latePct = 50;
    // Deliberately: alternate has SAME on-time — not stronger
    const altName = "South Bindery";
    const template = templateAlternateSupplier({
      supplierName,
      latePct,
      completed,
      altName: null, // production template only names alternate when stronger
    });
    const result = await narrateInsight({
      insightType: "alternate_supplier",
      facts: {
        supplier_name: supplierName,
        completed_pos: completed,
        on_time_pct: onTime,
        late_pct: latePct,
        alternate_supplier_name: altName,
        alternate_on_time_pct: onTime, // exact tie
        alternate_completed_pos: 12,
        alternate_is_stronger: false,
        tie: true,
        scorecard_min_completed_pos: SCORECARD_MIN_COMPLETED_POS,
        instruction_in_facts:
          "On-time rates are identical (tie). Do not claim either supplier is more reliable.",
      },
      fallback: { summary: template },
    });
    pair(
      "Tied on-time (North vs South both 50%)",
      template,
      result,
      [
        "Does NOT assert South is better / more reliable?",
        "Acknowledges tie or equal performance?",
        "Does not invent a third supplier?",
      ],
    );
  }

  // -------------------------------------------------------------------------
  section("3) No alternate exists — omit alternate fields entirely");
  {
    const supplierName = "Lone Source Fabrics";
    const completed = 14;
    const onTime = 0.45;
    const latePct = Math.round((1 - onTime) * 100);
    const template = templateAlternateSupplier({
      supplierName,
      latePct,
      completed,
      altName: null,
    });
    const result = await narrateInsight({
      insightType: "alternate_supplier",
      facts: {
        supplier_name: supplierName,
        completed_pos: completed,
        on_time_pct: onTime,
        late_pct: latePct,
        alternate_supplier_name: null,
        alternate_on_time_pct: null,
        has_eligible_alternate: false,
        scorecard_min_completed_pos: SCORECARD_MIN_COMPLETED_POS,
      },
      fallback: { summary: template },
    });
    pair("No alternate in facts", template, result, [
      "Does NOT invent a named alternate supplier?",
      "Says review / find alternates without naming a fake vendor?",
      "Keeps Lone Source Fabrics + ~55% late / 45% on-time?",
    ]);
  }

  // -------------------------------------------------------------------------
  section("4) Extra trap — price increase with null SKU (omit sku)");
  {
    const template =
      "Atlas Trim Supply raised Mystery Part from $1.00 to $1.25 effective 2026-07-01.";
    const result = await narrateInsight({
      insightType: "price_increase",
      facts: {
        supplier_name: "Atlas Trim Supply",
        product_title: "Mystery Part",
        // sku deliberately omitted
        from_unit_cost: 1.0,
        to_unit_cost: 1.25,
        effective_date: "2026-07-01",
      },
      fallback: { summary: template },
    });
    pair("Price rise without SKU", template, result, [
      "Does NOT invent a SKU code?",
      "Keeps $1.00 → $1.25 and 2026-07-01?",
    ]);
  }

  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
