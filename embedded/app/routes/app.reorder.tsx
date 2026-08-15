import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { InventoryIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionHeading } from "../components/SectionHeading";
import {
  dismissInsight,
  listActiveInsights,
  runInventoryAgent,
  workspaceIsInsightEligible,
} from "../lib/ai-agents.server";
import { getMerchantContext } from "../lib/merchant.server";
import { listReorderRecommendations } from "../lib/reorder.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const [recs, insights, gate] = await Promise.all([
    listReorderRecommendations(merchant.workspace.id),
    listActiveInsights(merchant.workspace.id, 40),
    workspaceIsInsightEligible(merchant.workspace.id),
  ]);
  const inventoryInsights = insights.filter(
    (i) =>
      i.agent === "inventory" && i.insight_type === "reorder_recommendation",
  );
  return {
    workspaceName: merchant.workspace.name,
    eligible: gate.eligible,
    gateReason: gate.reason ?? null,
    inventoryInsights,
    ...recs,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "dismiss_insight") {
    const insightId = String(form.get("insightId") ?? "");
    if (insightId) await dismissInsight(merchant.workspace.id, insightId);
    return { ok: true };
  }

  if (intent === "run_inventory_agent") {
    const ids = await runInventoryAgent(merchant.workspace.id, {
      force: true,
    });
    return { ok: true, created: ids.length };
  }

  return { ok: false };
};

function fmt(n: number, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

export default function ReorderPage() {
  const {
    workspaceName,
    rows,
    anySyntheticVelocity,
    needsReorderCount,
    inventoryInsights,
    eligible,
    gateReason,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const running =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "run_inventory_agent";

  return (
    <Page
      title="Reorder recommendations"
      subtitle={workspaceName}
      backAction={{ content: "Products", url: "/app/products" }}
    >
      <TitleBar title="Reorder" />
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="center">
          <SectionHeading icon={InventoryIcon} title="What to reorder" />
          {eligible ? (
            <Form method="post">
              <input type="hidden" name="intent" value="run_inventory_agent" />
              <Button submit loading={running}>
                Run Inventory Agent
              </Button>
            </Form>
          ) : null}
        </InlineStack>

        {!eligible ? (
          <Banner tone="info" title="Inventory Agent locked">
            <p>
              {gateReason ||
                "Insights unlock after 5 closed purchase orders in this workspace."}
            </p>
          </Banner>
        ) : null}

        {anySyntheticVelocity ? (
          <Banner tone="warning" title="Synthetic test velocity — mechanism check only">
            <p>
              One or more recommendations use sales velocity from Shopify orders
              tagged <Text as="span" fontWeight="semibold">requisly_synthetic_test</Text>{" "}
              (Bogus/QA). This confirms the reorder math works. It does{" "}
              <Text as="span" fontWeight="semibold">not</Text> confirm real
              customer-driven demand — no real customer has transacted through
              this store.
            </p>
          </Banner>
        ) : null}

        <Banner tone="info" title={`${needsReorderCount} SKU(s) at or below reorder point`}>
          <p>
            Lead time is <Text as="span" fontWeight="semibold">confirmed</Text>{" "}
            from closed-PO timeline (sent → shipped) when history exists;
            otherwise it shows as an explicit{" "}
            <Text as="span" fontWeight="semibold">fallback estimate</Text> — never
            silently blended. Inventory Agent drafts never auto-send.
          </p>
        </Banner>

        {inventoryInsights.length > 0 ? (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingSm">
                  Inventory Agent insights
                </Text>
                <Badge tone="attention">Grouped separately from other agents</Badge>
              </InlineStack>
              {inventoryInsights.map((insight) => {
                const synthetic = Boolean(
                  (
                    insight.supporting_data as {
                      velocity_is_synthetic_test?: boolean;
                    }
                  )?.velocity_is_synthetic_test,
                );
                const leadSource = (
                  insight.supporting_data as { lead_time_source?: string }
                )?.lead_time_source;
                return (
                  <BlockStack key={insight.id} gap="200">
                    <InlineStack gap="200" wrap>
                      <Badge tone="attention">Inventory</Badge>
                      {synthetic ? (
                        <Badge tone="warning">Synthetic velocity</Badge>
                      ) : null}
                      {leadSource === "confirmed" ? (
                        <Badge tone="success">Confirmed lead time</Badge>
                      ) : null}
                      {leadSource === "fallback_estimate" ? (
                        <Badge tone="attention">Fallback lead time</Badge>
                      ) : null}
                    </InlineStack>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {insight.summary}
                    </Text>
                    {insight.body ? (
                      <Text as="p" tone="subdued">
                        {insight.body}
                      </Text>
                    ) : null}
                    <InlineStack gap="200">
                      {insight.po_id ? (
                        <Button url={`/app/purchase-orders/${insight.po_id}`}>
                          Review draft PO
                        </Button>
                      ) : null}
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="dismiss_insight"
                        />
                        <input
                          type="hidden"
                          name="insightId"
                          value={insight.id}
                        />
                        <Button submit variant="plain" tone="critical">
                          Dismiss
                        </Button>
                      </Form>
                    </InlineStack>
                  </BlockStack>
                );
              })}
            </BlockStack>
          </Card>
        ) : null}

        <Card padding="0">
          {rows.length === 0 ? (
            <Box padding="400">
              <Text as="p" tone="subdued">
                No reorder settings yet. Enable reorder points on products that
                have supplier links and inventory.
              </Text>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "SKU", plural: "SKUs" }}
              itemCount={rows.length}
              headings={[
                { title: "Product" },
                { title: "On hand" },
                { title: "Velocity / day" },
                { title: "Lead time" },
                { title: "Reorder point" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {rows.map((row, index) => (
                <IndexTable.Row
                  id={row.product_variant_id}
                  key={row.product_variant_id}
                  position={index}
                >
                  <IndexTable.Cell>
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">
                        {row.title}
                      </Text>
                      <InlineStack gap="200">
                        {row.velocity_is_synthetic_test ? (
                          <Badge tone="warning">Synthetic velocity</Badge>
                        ) : (
                          <Badge tone="success">Live velocity</Badge>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.on_hand}</IndexTable.Cell>
                  <IndexTable.Cell>{fmt(row.units_per_day, 2)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="100">
                      <Text as="span">
                        {row.lead_time_days == null
                          ? "—"
                          : `${fmt(row.lead_time_days, 1)} days`}
                      </Text>
                      {row.lead_time_source === "confirmed" ? (
                        <Badge tone="success">
                          {`Confirmed (${row.confirmed_lead_po_count} POs)`}
                        </Badge>
                      ) : (
                        <Badge tone="attention">Fallback estimate</Badge>
                      )}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{fmt(row.reorder_point, 1)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.needs_reorder ? (
                      <Badge tone="critical">Needs reorder</Badge>
                    ) : (
                      <Badge>OK</Badge>
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
