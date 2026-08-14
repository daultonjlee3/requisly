import { Form } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  List,
  Text,
} from "@shopify/polaris";
import { ClipboardChecklistIcon } from "@shopify/polaris-icons";
import { SectionHeading } from "./SectionHeading";
import type { ChecklistStep } from "../lib/onboarding.server";

export function OnboardingChecklist(props: {
  steps: ChecklistStep[];
  submitting?: boolean;
}) {
  const { steps, submitting } = props;
  const next = steps.find((s) => !s.done);

  return (
    <Card>
      <BlockStack gap="400">
        <SectionHeading
          title="Get set up"
          icon={ClipboardChecklistIcon}
          subtitle="Three steps — then Today's Work starts filling with real supplier activity."
        />
        <List type="number">
          {steps.map((step) => (
            <List.Item key={step.id}>
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <Text
                  as="span"
                  variant="bodyMd"
                  fontWeight={step.done ? "regular" : "semibold"}
                  tone={step.done ? "subdued" : undefined}
                >
                  {step.label}
                </Text>
                {step.done ? (
                  <Badge tone="success">Done</Badge>
                ) : (
                  <Button url={step.href} size="slim" variant="plain">
                    Open
                  </Button>
                )}
              </InlineStack>
            </List.Item>
          ))}
        </List>

        {next ? (
          <Button url={next.href} variant="primary">
            {next.id === "add_supplier"
              ? "Add your first supplier"
              : next.id === "send_po"
                ? "Create your first PO"
                : "Continue"}
          </Button>
        ) : null}

        <Banner tone="info" title="Want to peek ahead?">
          <p>
            <Button url="/app/analytics?sample=1" variant="plain">
              See what this looks like with real history →
            </Button>
          </p>
        </Banner>

        <Form method="post">
          <input type="hidden" name="intent" value="skip_onboarding_checklist" />
          <Button submit variant="plain" loading={submitting}>
            Skip for now
          </Button>
        </Form>
      </BlockStack>
    </Card>
  );
}
