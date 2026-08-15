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
  Filters,
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
import { useCallback, useMemo, useState } from "react";
import { AiInsightsPanel } from "../components/AiInsightsPanel";
import { SectionHeading } from "../components/SectionHeading";
import {
  dismissInsight,
  listActiveInsights,
  runAllAgentsForWorkspace,
  workspaceIsInsightEligible,
} from "../lib/ai-agents.server";
import { loadAnalytics } from "../lib/analytics.server";
import { downloadListCsv } from "../lib/csv";
import { indexTablePagination, LIST_PAGE_SIZE } from "../lib/list-table";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import { getMerchantContext } from "../lib/merchant.server";
import { resolveDemoWorkspaceId } from "../lib/onboarding.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const sample = url.searchParams.get("sample") === "1";

  // Narrow, explicit exception to workspace scoping: sample Analytics loads
  // the demo workspace read-only so merchants can preview real history.
  let analyticsWorkspaceId = merchant.workspace.id;
  let workspaceName = merchant.workspace.name;
  let sampleMode = false;
  if (sample) {
    const demo = await resolveDemoWorkspaceId();
    if (demo) {
      analyticsWorkspaceId = demo.id;
      workspaceName = demo.name;
      sampleMode = true;
    }
  }

  const [analytics, gate, insights] = await Promise.all([
    loadAnalytics(analyticsWorkspaceId),
    workspaceIsInsightEligible(analyticsWorkspaceId),
    sampleMode
      ? Promise.resolve([])
      : listActiveInsights(merchant.workspace.id),
  ]);
  return {
    workspaceName,
    analytics,
    insightsEligible: sampleMode ? false : gate.eligible,
    insightsGateReason: sampleMode
      ? "Sample preview — insights stay on your workspace."
      : (gate.reason ?? null),
    insights,
    sampleMode,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const url = new URL(request.url);
  if (url.searchParams.get("sample") === "1") {
    return { ok: false, generated: null, error: "Sample preview is read-only" };
  }

  if (intent === "dismiss_insight") {
    const insightId = String(form.get("insightId") ?? "");
    if (insightId) {
      await dismissInsight(merchant.workspace.id, insightId);
    }
    return { ok: true, generated: null as null, error: null as string | null };
  }

  if (intent === "generate_insights") {
    const result = await runAllAgentsForWorkspace(merchant.workspace.id, {
      force: true,
    });
    return { ok: true, generated: result, error: null as string | null };
  }

  return { ok: false, generated: null, error: null as string | null };
};

export default function AnalyticsPage() {
  const {
    workspaceName,
    analytics,
    insightsEligible,
    insightsGateReason,
    insights,
    sampleMode,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const generating =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "generate_insights";

  const [tableQuery, setTableQuery] = useState("");
  const [scorePage, setScorePage] = useState(1);
  const [spendPage, setSpendPage] = useState(1);
  const needle = tableQuery.trim().toLowerCase();

  const filteredScorecards = useMemo(() => {
    if (!needle) return analytics.scorecards;
    return analytics.scorecards.filter((s) =>
      s.supplierName.toLowerCase().includes(needle),
    );
  }, [analytics.scorecards, needle]);

  const filteredSpend = useMemo(() => {
    if (!needle) return analytics.spendBySupplier;
    return analytics.spendBySupplier.filter((s) =>
      s.supplierName.toLowerCase().includes(needle),
    );
  }, [analytics.spendBySupplier, needle]);

  const scoreSlice = filteredScorecards.slice(
    (scorePage - 1) * LIST_PAGE_SIZE,
    scorePage * LIST_PAGE_SIZE,
  );
  const spendSlice = filteredSpend.slice(
    (spendPage - 1) * LIST_PAGE_SIZE,
    spendPage * LIST_PAGE_SIZE,
  );

  const exportCsv = useCallback(() => {
    const rows: Array<Array<string | number | null>> = [
      ...filteredSpend.map((s) => [
        "spend",
        s.supplierName,
        s.count,
        Number(s.totalRaw.toFixed(2)),
      ]),
      ...filteredScorecards.map((s) => [
        "scorecard",
        s.supplierName,
        s.completedPos,
        s.ready ? "ready" : "not_ready",
      ]),
      ...analytics.spendByMonthExport.map((m) => [
        "month",
        m.month,
        null,
        Number(m.spend.toFixed(2)),
      ]),
    ];
    downloadListCsv(
      "analytics",
      ["type", "name", "closed_pos", "value"],
      rows,
    );
  }, [
    analytics.spendByMonthExport,
    filteredScorecards,
    filteredSpend,
  ]);

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
    <Page
      title="Analytics"
      subtitle={sampleMode ? `${workspaceName} (sample)` : workspaceName}
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled:
            analytics.loadError != null ||
            (filteredSpend.length === 0 &&
              filteredScorecards.length === 0 &&
              analytics.spendByMonthExport.length === 0),
        },
      ]}
    >
      <TitleBar title="Analytics" />
      <BlockStack gap="500">
        {sampleMode ? (
          <Banner
            tone="warning"
            title="You're viewing sample data"
            action={{ content: "Back to my workspace", url: "/app/analytics" }}
          >
            <p>
              This is the Requisly demo workspace — a narrow, read-only preview
              of Analytics with real history. Nothing here writes to your store.
            </p>
          </Banner>
        ) : null}

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
              showGenerate={!sampleMode}
              generating={generating}
            />

            <InlineGrid columns={4} gap="400">
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
                    {analytics.cogs?.cardTitle ?? "COGS (Weighted Average)"}
                  </Text>
                  <Text as="p" variant="headingLg">
                    {analytics.cogs?.totalCogs ?? "—"}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {analytics.cogs
                      ? `${analytics.cogs.periodLabel} · ${analytics.cogs.totalUnits} units`
                      : "Last 30 days"}
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

            <Card padding="0">
              <Filters
                queryValue={tableQuery}
                queryPlaceholder="Filter tables by supplier"
                filters={[]}
                onQueryChange={(value) => {
                  setTableQuery(value);
                  setScorePage(1);
                  setSpendPage(1);
                }}
                onQueryClear={() => {
                  setTableQuery("");
                  setScorePage(1);
                  setSpendPage(1);
                }}
                onClearAll={() => {
                  setTableQuery("");
                  setScorePage(1);
                  setSpendPage(1);
                }}
              />
            </Card>

            <Card>
              <BlockStack gap="300">
                <SectionHeading
                  title="Supplier scorecards"
                  icon={ChartVerticalIcon}
                  subtitle="Metrics unlock after 5 closed POs per supplier."
                />
                {filteredScorecards.length === 0 ? (
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
                    rows={scoreSlice.map((s) => [
                      s.supplierName,
                      String(s.completedPos),
                      s.ready ? "Yes" : "No",
                      s.onTimePct,
                      s.fillRate,
                      s.avgConfirmDays,
                    ])}
                    pagination={indexTablePagination({
                      page: scorePage,
                      total: filteredScorecards.length,
                      onPageChange: setScorePage,
                    })}
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
                {filteredSpend.length === 0 ? (
                  <Text as="p" tone="subdued" variant="bodyMd">
                    No closed orders yet.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric"]}
                    headings={["Supplier", "Closed POs", "Spend"]}
                    rows={spendSlice.map((s) => [
                      s.supplierName,
                      String(s.count),
                      s.total,
                    ])}
                    pagination={indexTablePagination({
                      page: spendPage,
                      total: filteredSpend.length,
                      onPageChange: setSpendPage,
                    })}
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
