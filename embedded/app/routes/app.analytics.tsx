import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Card,
  DataTable,
  EmptyState,
  InlineGrid,
  Page,
  Text,
} from "@shopify/polaris";
import {
  CashDollarIcon,
  ChartLineIcon,
  ChartVerticalIcon,
} from "@shopify/polaris-icons";
import { BarChart, LineChart } from "@shopify/polaris-viz";
import { TitleBar } from "@shopify/app-bridge-react";
import { AiInsightsPanel } from "../components/AiInsightsPanel";
import { SectionHeading } from "../components/SectionHeading";
import {
  dismissInsight,
  listActiveInsights,
  runAllAgentsForWorkspace,
  workspaceIsInsightEligible,
} from "../lib/ai-agents.server";
import { loadAnalytics } from "../lib/analytics.server";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import { getMerchantContext } from "../lib/merchant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const [analytics, gate, insights] = await Promise.all([
    loadAnalytics(merchant.workspace.id),
    workspaceIsInsightEligible(merchant.workspace.id),
    listActiveInsights(merchant.workspace.id),
  ]);
  return {
    workspaceName: merchant.workspace.name,
    analytics,
    insightsEligible: gate.eligible,
    insightsGateReason: gate.reason ?? null,
    insights,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "dismiss_insight") {
    const insightId = String(form.get("insightId") ?? "");
    if (insightId) {
      await dismissInsight(merchant.workspace.id, insightId);
    }
    return { ok: true, generated: null as null };
  }

  if (intent === "generate_insights") {
    const result = await runAllAgentsForWorkspace(merchant.workspace.id, {
      force: true,
    });
    return { ok: true, generated: result };
  }

  return { ok: false, generated: null };
};

export default function AnalyticsPage() {
  const {
    workspaceName,
    analytics,
    insightsEligible,
    insightsGateReason,
    insights,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const generating =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "generate_insights";

  const spendSeries = [
    {
      name: "Closed spend",
      data: analytics.spendByMonth.map((p) => ({
        key: p.key,
        value: p.value,
      })),
    },
  ];

  const onTimeSeries = [
    {
      name: "On-time %",
      data: analytics.onTimeByMonth.map((p) => ({
        key: p.key,
        value: p.value,
      })),
    },
  ];

  return (
    <Page title="Analytics" subtitle={workspaceName}>
      <TitleBar title="Analytics" />
      <BlockStack gap="500">
        {analytics.loadError ? (
          <Banner
            tone="critical"
            title="Analytics data couldn’t be loaded"
            action={{
              content: "Retry",
              onAction: () => revalidator.revalidate(),
            }}
          >
            <p>{analytics.loadError}</p>
          </Banner>
        ) : null}

        {actionData?.generated && !actionData.generated.eligible ? (
          <Banner tone="warning" title="Insights not generated">
            <p>{actionData.generated.reason}</p>
          </Banner>
        ) : null}

        {actionData?.generated?.eligible ? (
          <Banner tone="success" title="Agents refreshed">
            <p>
              Created {actionData.generated.insightsCreated} insight
              {actionData.generated.insightsCreated === 1 ? "" : "s"}
              {actionData.generated.digest
                ? `. Digest email ${actionData.generated.digest.emailSent ? "sent" : "not sent"}${actionData.generated.digest.emailError ? ` (${actionData.generated.digest.emailError})` : ""}.`
                : "."}
            </p>
          </Banner>
        ) : null}

        {!analytics.loadError ? (
          <>
            {analytics.isDemo ? (
              <Banner tone="info" title="Demo workspace">
                <p>
                  Scorecards and AI insights may include seeded demo history.
                </p>
              </Banner>
            ) : null}

            <AiInsightsPanel
              eligible={insightsEligible}
              gateReason={insightsGateReason}
              insights={insights}
              showGenerate
              generating={generating}
            />

            <InlineGrid columns={3} gap="400">
              <Card>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    Closed POs
                  </Text>
                  <Text as="p" variant="headingLg">
                    {analytics.closedCount}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    Suppliers with scorecards
                  </Text>
                  <Text as="p" variant="headingLg">
                    {analytics.scorecards.length}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    Ready scorecards
                  </Text>
                  <Text as="p" variant="headingLg">
                    {analytics.scorecards.filter((s) => s.ready).length}
                  </Text>
                </BlockStack>
              </Card>
            </InlineGrid>

            <Card>
              <BlockStack gap="300">
                <SectionHeading
                  title="On-time rate over time"
                  icon={ChartLineIcon}
                  subtitle="Share of closed POs that shipped on or before the requested date, by month."
                />
                {analytics.onTimeByMonth.length === 0 ? (
                  <EmptyState
                    heading="No on-time trend yet"
                    image={EMPTY_STATE_IMAGE.insights}
                  >
                    <p>
                      Charts unlock after closed POs with ship dates land in
                      the timeline.
                    </p>
                  </EmptyState>
                ) : (
                  <LineChart data={onTimeSeries} theme="Light" />
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <SectionHeading
                  title="Spend by month"
                  icon={CashDollarIcon}
                  subtitle="Total of closed purchase orders, by month created."
                />
                {analytics.spendByMonth.length === 0 ? (
                  <EmptyState
                    heading="No spend history yet"
                    image={EMPTY_STATE_IMAGE.insights}
                  >
                    <p>Close a few POs to see monthly spend trends.</p>
                  </EmptyState>
                ) : (
                  <BarChart data={spendSeries} theme="Light" />
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <SectionHeading
                  title="Supplier scorecards"
                  icon={ChartVerticalIcon}
                  subtitle="Metrics unlock after 5 closed POs per supplier."
                />
                {analytics.scorecards.length === 0 ? (
                  <EmptyState
                    heading="No scorecard rows yet"
                    image={EMPTY_STATE_IMAGE.suppliers}
                  >
                    <p>Add suppliers and close purchase orders to populate scorecards.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "numeric",
                      "text",
                      "text",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "Supplier",
                      "Closed",
                      "Ready",
                      "On-time",
                      "Fill rate",
                      "Avg confirm",
                    ]}
                    rows={analytics.scorecards.map((s) => [
                      s.supplierName,
                      String(s.completedPos),
                      s.ready ? "Yes" : "No",
                      s.onTimePct,
                      s.fillRate,
                      s.avgConfirmDays,
                    ])}
                  />
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <SectionHeading
                  title="Closed PO spend by supplier"
                  icon={CashDollarIcon}
                />
                {analytics.spendBySupplier.length === 0 ? (
                  <Text as="p" tone="subdued" variant="bodyMd">
                    No closed orders yet.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric"]}
                    headings={["Supplier", "Closed POs", "Spend"]}
                    rows={analytics.spendBySupplier.map((s) => [
                      s.supplierName,
                      String(s.count),
                      s.total,
                    ])}
                  />
                )}
              </BlockStack>
            </Card>
          </>
        ) : null}
      </BlockStack>
    </Page>
  );
}
