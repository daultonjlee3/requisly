import { Form, useFetcher, useLocation } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  Collapsible,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { ChatIcon } from "@shopify/polaris-icons";
import { useEffect, useState } from "react";
import { SectionHeading } from "./SectionHeading";
import type { OnboardingState } from "../lib/onboarding.server";

type GuideAnswer = {
  summary: string;
  body: string | null;
  source?: string;
  outOfScope?: boolean;
};

export function OnboardingGuide(props: {
  onboarding: Pick<
    OnboardingState,
    "steps" | "supplierCount" | "sentPoCount" | "flags" | "showGuide"
  >;
  /** Remix action path that handles intent=ask_onboarding_guide */
  action?: string;
}) {
  const { onboarding, action = "/app/onboarding/guide" } = props;
  const location = useLocation();
  const fetcher = useFetcher<{ guide?: GuideAnswer; error?: string }>();
  const [open, setOpen] = useState(true);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<
    Array<{ q: string; a: GuideAnswer }>
  >([]);

  useEffect(() => {
    if (fetcher.data?.guide && question) {
      setHistory((prev) => [
        ...prev,
        { q: question, a: fetcher.data!.guide! },
      ]);
      setQuestion("");
    }
    // Only react to new fetcher data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  if (!onboarding.showGuide) return null;

  const submitting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "ask_onboarding_guide";

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <SectionHeading
            title="Setup guide"
            icon={ChatIcon}
            subtitle="Ask how Requisly works — answers only, never takes actions for you."
          />
          <InlineStack gap="200">
            <Button
              variant="plain"
              onClick={() => setOpen((v) => !v)}
              accessibilityLabel={open ? "Collapse guide" : "Expand guide"}
            >
              {open ? "Hide" : "Show"}
            </Button>
            <Form method="post" action={action}>
              <input type="hidden" name="intent" value="dismiss_onboarding_guide" />
              <Button submit variant="plain">
                Dismiss
              </Button>
            </Form>
          </InlineStack>
        </InlineStack>

        <Collapsible open={open} id="onboarding-guide-panel">
          <BlockStack gap="300">
            {history.map((item, idx) => (
              <BlockStack key={`${idx}-${item.q}`} gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  You: {item.q}
                </Text>
                <Text as="p" variant="bodyMd">
                  {item.a.summary}
                </Text>
                {item.a.body ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {item.a.body}
                  </Text>
                ) : null}
              </BlockStack>
            ))}

            <fetcher.Form method="post" action={action}>
              <input type="hidden" name="intent" value="ask_onboarding_guide" />
              <input type="hidden" name="current_path" value={location.pathname} />
              <input type="hidden" name="question" value={question} />
              <BlockStack gap="200">
                <TextField
                  label="Ask a question"
                  labelHidden
                  autoComplete="off"
                  value={question}
                  onChange={setQuestion}
                  placeholder="e.g. What is Today's Work?"
                  connectedRight={
                    <Button submit loading={submitting} disabled={!question.trim()}>
                      Ask
                    </Button>
                  }
                />
              </BlockStack>
            </fetcher.Form>
            {fetcher.data?.error ? (
              <Text as="p" tone="critical" variant="bodySm">
                {fetcher.data.error}
              </Text>
            ) : null}
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}
