import { Form } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { ChartVerticalIcon } from "@shopify/polaris-icons";
import { SectionHeading } from "./SectionHeading";
import type { AiInsightRow } from "../lib/ai-agents.server";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";

const AGENT_LABEL: Record<string, string> = {
  operations: "Operations",
  supplier: "Supplier",
  procurement: "Procurement",
  margin: "Margin",
  quality: "Quality",
  reorder: "Reorder",
  documentation: "Documentation",
  hygiene: "Data hygiene",
};

const TYPE_TONE: Record<string, "info" | "warning" | "success" | "attention"> =
  {
    daily_digest: "info",
    po_unopened: "warning",
    po_unconfirmed: "warning",
    shipment_late: "warning",
    alternate_supplier: "attention",
    price_increase: "warning",
    draft_po_suggestion: "success",
    margin_compression: "warning",
    quality_pattern: "attention",
    reorder_cadence: "info",
    missing_documents: "warning",
    missing_documents_pattern: "attention",
    catalog_incomplete: "info",
    catalog_price_stale: "warning",
  };

export function AiInsightsPanel(props: {
  eligible: boolean;
  gateReason?: string | null;
  insights: AiInsightRow[];
  /** Show generate button (Analytics). */
  showGenerate?: boolean;
  generating?: boolean;
}) {
  const { eligible, gateReason, insights, showGenerate, generating } = props;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <SectionHeading
            title="AI insights"
            icon={ChartVerticalIcon}
            subtitle="Claude turns your PO metrics into short insights. Draft suggestions never auto-send — you review first."
          />
          {showGenerate && eligible ? (
            <Form method="post">
              <input type="hidden" name="intent" value="generate_insights" />
              <Button submit loading={generating}>
                Refresh insights
              </Button>
            </Form>
          ) : null}
        </InlineStack>

        {!eligible ? (
          <EmptyState
            heading="Not enough history yet"
            image={EMPTY_STATE_IMAGE.insights}
          >
            <p>
              {gateReason ||
                "Insights unlock after 5 closed purchase orders in this workspace. We won't invent recommendations on thin data."}
            </p>
          </EmptyState>
        ) : insights.length === 0 ? (
          <Banner tone="info" title="No active insights">
            <p>
              Run Refresh insights to generate today's digest and follow-ups,
              or wait for the daily Operations Agent schedule.
            </p>
          </Banner>
        ) : (
          <BlockStack gap="300">
            {insights.map((insight) => {
              const tone =
                insight.insight_type === "shipment_late"
                  ? "warning"
                  : TYPE_TONE[insight.insight_type] ?? "info";
              const poId = insight.po_id;
              const isDraft =
                insight.insight_type === "draft_po_suggestion" && poId;

              return (
                <BlockStack key={insight.id} gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={tone}>
                      {AGENT_LABEL[insight.agent] ?? insight.agent}
                    </Badge>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {new Date(insight.generated_at).toLocaleString()}
                    </Text>
                  </InlineStack>
                  <Text as="h3" variant="headingSm">
                    {insight.summary}
                  </Text>
                  {insight.body && insight.insight_type !== "daily_digest" ? (
                    <Text as="p" tone="subdued" variant="bodyMd">
                      {insight.body}
                    </Text>
                  ) : null}
                  <InlineStack gap="200">
                    {isDraft ? (
                      <Button url={`/app/purchase-orders/${poId}`}>
                        Review draft PO
                      </Button>
                    ) : null}
                    {poId && !isDraft ? (
                      <Button url={`/app/purchase-orders/${poId}`} variant="plain">
                        Open PO
                      </Button>
                    ) : null}
                    <Form method="post">
                      <input type="hidden" name="intent" value="dismiss_insight" />
                      <input type="hidden" name="insightId" value={insight.id} />
                      <Button submit variant="plain" tone="critical">
                        Dismiss
                      </Button>
                    </Form>
                  </InlineStack>
                </BlockStack>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
