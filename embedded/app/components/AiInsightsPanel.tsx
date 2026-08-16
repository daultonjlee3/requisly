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
  reorder: "Reorder cadence",
  inventory: "Inventory",
  documentation: "Documentation",
  hygiene: "Data hygiene",
  reports: "Report",
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
    reorder_recommendation: "attention",
    missing_documents: "warning",
    missing_documents_pattern: "attention",
    catalog_incomplete: "info",
    catalog_price_stale: "warning",
    onboarding_nudge: "info",
    pinned_report: "success",
  };

function InsightRow(props: { insight: AiInsightRow }) {
  const { insight } = props;
  const tone =
    insight.insight_type === "shipment_late"
      ? "warning"
      : TYPE_TONE[insight.insight_type] ?? "info";
  const poId = insight.po_id;
  const isDraftPo =
    Boolean(poId) &&
    (insight.insight_type === "draft_po_suggestion" ||
      insight.insight_type === "reorder_recommendation");
  const synthetic = Boolean(
    (insight.supporting_data as { velocity_is_synthetic_test?: boolean })
      ?.velocity_is_synthetic_test,
  );
  const leadSource = (
    insight.supporting_data as { lead_time_source?: string }
  )?.lead_time_source;

  return (
    <BlockStack gap="200">
      <InlineStack gap="200" blockAlign="center" wrap>
        <Badge tone={tone}>
          {AGENT_LABEL[insight.agent] ?? insight.agent}
        </Badge>
        {synthetic ? <Badge tone="warning">Synthetic velocity</Badge> : null}
        {leadSource === "confirmed" ? (
          <Badge tone="success">Confirmed lead time</Badge>
        ) : null}
        {leadSource === "fallback_estimate" ? (
          <Badge tone="attention">Fallback lead time</Badge>
        ) : null}
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
        {isDraftPo ? (
          <Button url={`/app/purchase-orders/${poId}`}>Review draft PO</Button>
        ) : null}
        {poId && !isDraftPo ? (
          <Button url={`/app/purchase-orders/${poId}`} variant="plain">
            Open PO
          </Button>
        ) : null}
        {insight.insight_type === "reorder_cadence" && insight.supplier_id ? (
          <Form method="post" action="/app/templates/from-cadence">
            <input type="hidden" name="insightId" value={insight.id} />
            <Button submit variant="primary">
              Turn this into a recurring PO
            </Button>
          </Form>
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
}

export function AiInsightsPanel(props: {
  eligible: boolean;
  gateReason?: string | null;
  insights: AiInsightRow[];
  /** Show generate button (Analytics). */
  showGenerate?: boolean;
  generating?: boolean;
}) {
  const { eligible, gateReason, insights, showGenerate, generating } = props;

  const inventoryInsights = insights.filter((i) => i.agent === "inventory");
  const otherInsights = insights.filter((i) => i.agent !== "inventory");
  const anySyntheticInventory = inventoryInsights.some((i) =>
    Boolean(
      (i.supporting_data as { velocity_is_synthetic_test?: boolean })
        ?.velocity_is_synthetic_test,
    ),
  );

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
          <BlockStack gap="400">
            {inventoryInsights.length > 0 ? (
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingSm">
                    Inventory Agent
                  </Text>
                  <Badge tone="attention">Reorder points</Badge>
                </InlineStack>
                {anySyntheticInventory ? (
                  <Banner
                    tone="warning"
                    title="Inventory insights include synthetic test velocity"
                  >
                    <p>
                      These recommendations use Salt &amp; Fern / QA synthetic
                      orders — not real customer demand. Treat as a mechanism
                      check until live Orders data drives velocity.
                    </p>
                  </Banner>
                ) : null}
                {inventoryInsights.map((insight) => (
                  <InsightRow key={insight.id} insight={insight} />
                ))}
              </BlockStack>
            ) : null}

            {otherInsights.length > 0 ? (
              <BlockStack gap="300">
                {inventoryInsights.length > 0 ? (
                  <Text as="h3" variant="headingSm">
                    Other agents
                  </Text>
                ) : null}
                {otherInsights.map((insight) => (
                  <InsightRow key={insight.id} insight={insight} />
                ))}
              </BlockStack>
            ) : null}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
