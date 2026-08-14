import { mapPromptToReportTemplate } from "../embedded/app/lib/report-prompt.server";

async function main() {
  const tests = [
    "Show suppliers with margin below 25%",
    "Compare spend vs revenue by supplier",
    "which products have thin margins but ship late",
    "asdf qwerty xyz",
  ];

  for (const t of tests) {
    const m = await mapPromptToReportTemplate(t);
    console.log(
      JSON.stringify({
        q: t,
        id: m.templateId,
        conf: m.confidence,
        src: m.source,
        params: m.params,
      }),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
