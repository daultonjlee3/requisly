import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  Icon,
  InlineStack,
  Layout,
  Page,
  ResourceItem,
  ResourceList,
  Text,
  type IconSource,
} from "@shopify/polaris";
import {
  DeliveryIcon,
  OrderIcon,
  PackageIcon,
  AlertCircleIcon,
  ChartVerticalIcon,
  CalendarTimeIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect } from "react";
import { AiInsightsPanel } from "../components/AiInsightsPanel";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { OnboardingGuide } from "../components/OnboardingGuide";
import { SectionHeading } from "../components/SectionHeading";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import {
  dismissInsight,
  listActiveInsights,
  workspaceIsInsightEligible,
} from "../lib/ai-agents.server";
import { listUpcomingRecurringPOs } from "../lib/recurring-pos.server";
import { loadDashboard } from "../lib/dashboard.server";
import { getMerchantContext } from "../lib/merchant.server";
import {
  getOnboardingState,
  markFirstPoCelebrated,
  skipChecklist,
} from "../lib/onboarding.server";
import { listPinnedReports } from "../lib/report-builder.server";
import type { DashRow } from "../lib/po-types";
import { statusBadgeTone, statusLabel } from "../lib/po-status";
import { syncShopifyCatalogGraphql } from "../lib/shopify-sync.server";
import { startTimer } from "../lib/timing.server";
import { ensureWorkspaceForShop } from "../lib/workspace.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const timer = startTimer("loader:/app");
  const url = new URL(request.url);
  const forceError =
    process.env.NODE_ENV !== "production" &&
    url.searchParams.get("forceError") === "1";

  const merchant = await getMerchantContext(request, { sync: "auto" });
  const onboarding = await getOnboardingState(merchant.workspace.id);
  if (onboarding.showWelcome) {
    return merchant.redirect("/app/welcome");
  }

  const [dashboard, gate, insights, pinnedReports, upcomingRecurring] =
    await Promise.all([
    loadDashboard(merchant.workspace.id, { forceError }),
    workspaceIsInsightEligible(merchant.workspace.id),
    listActiveInsights(merchant.workspace.id, 12),
    listPinnedReports(merchant.workspace.id, 5),
    listUpcomingRecurringPOs(merchant.workspace.id),
  ]);

  const ms = timer.end({
    catalogSyncPending: merchant.catalogSyncPending,
    dashboardError: Boolean(dashboard.loadError),
  });

  return {
    workspaceName: merchant.workspace.name,
    shopDomain: merchant.shopDomain,
    isDev: process.env.NODE_ENV !== "production",
    syncedAt: merchant.workspace.shopify_synced_at,
    catalogSyncPending: merchant.catalogSyncPending,
    syncError: merchant.syncError,
    dashboard,
    insightsEligible: gate.eligible,
    insightsGateReason: gate.reason ?? null,
    insights,
    pinnedReports,
    upcomingRecurring,
    onboarding,
    loaderMs: ms,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "sync");

  if (intent === "dismiss_insight") {
    const merchant = await getMerchantContext(request, { sync: false });
    const insightId = String(form.get("insightId") ?? "");
    if (insightId) await dismissInsight(merchant.workspace.id, insightId);
    return { sync: null, error: null as string | null };
  }

  if (intent === "skip_onboarding_checklist") {
    const merchant = await getMerchantContext(request, { sync: false });
    await skipChecklist(merchant.workspace.id);
    return { sync: null, error: null as string | null };
  }

  if (intent === "celebrate_first_po") {
    const merchant = await getMerchantContext(request, { sync: false });
    await markFirstPoCelebrated(merchant.workspace.id);
    return { sync: null, error: null as string | null };
  }

  const { admin, session } = await authenticate.admin(request);
  if (!session.accessToken) {
    return { sync: null, error: "Shopify session is missing an access token" };
  }
  const workspace = await ensureWorkspaceForShop({
    shop: session.shop,
    accessToken: session.accessToken,
  });
  try {
    const sync = await syncShopifyCatalogGraphql({
      admin,
      workspaceId: workspace.id,
    });
    return { sync, error: null as string | null };
  } catch (err) {
    return {
      sync: null,
      error: err instanceof Error ? err.message : "Catalog sync failed",
    };
  }
};

export default function TodaysWork() {
  const {
    workspaceName,
    shopDomain,
    isDev,
    syncedAt,
    catalogSyncPending,
    syncError,
    dashboard,
    insightsEligible,
    insightsGateReason,
    insights,
    pinnedReports,
    onboarding,
    upcomingRecurring,
    loaderMs,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const shopify = useAppBridge();
  const syncing = navigation.state !== "idle" && navigation.formData != null;
  const sync = actionData?.sync ?? null;
  const bannerError = actionData?.error ?? syncError;
  const activated = searchParams.get("activated") === "1";
  const recurringError = searchParams.get("recurring_error");

  useEffect(() => {
    if (!activated) return;
    try {
      shopify.toast.show(
        "First PO sent — suppliers can open the link and confirm.",
      );
    } catch {
      /* toast unavailable outside Admin */
    }
  }, [activated, shopify]);

  return (
    <Page
      title="Today's Work"
      subtitle={`${workspaceName} · ${shopDomain}`}
      primaryAction={{
        content: "New PO",
        url: "/app/purchase-orders/new",
      }}
    >
      <TitleBar title="Today's Work" />
      <BlockStack gap="500">
        <InlineStack align="end" gap="300" blockAlign="center">
          {syncedAt && !catalogSyncPending ? (
            <Text as="span" variant="bodySm" tone="subdued">
              Catalog synced {new Date(syncedAt).toLocaleString()}
            </Text>
          ) : null}
          <Form method="post">
            <Button submit loading={syncing}>
              Sync catalog
            </Button>
          </Form>
        </InlineStack>

        {activated ? (
          <Banner
            tone="success"
            title="You're live — first PO sent"
            onDismiss={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("activated");
              setSearchParams(next, { replace: true });
            }}
          >
            <p>
              Supplier Link is ready. When they confirm or ship, it shows up
              here on Today&apos;s Work — not three weeks later in a thread.
            </p>
          </Banner>
        ) : null}

        {onboarding.showChecklist ? (
          <OnboardingChecklist
            steps={onboarding.steps}
            submitting={
              navigation.state !== "idle" &&
              navigation.formData?.get("intent") ===
                "skip_onboarding_checklist"
            }
          />
        ) : null}

        {onboarding.showGuide ? (
          <OnboardingGuide onboarding={onboarding} />
        ) : null}

        {catalogSyncPending ? (
          <Banner tone="info" title="Catalog syncing…">
            <p>
              Showing your last-synced catalog while Shopify products refresh in
              the background.
            </p>
          </Banner>
        ) : null}

        {dashboard.loadError ? (
          <Banner
            tone="critical"
            title="Dashboard data couldn’t be loaded"
            action={{
              content: "Retry",
              onAction: () => revalidator.revalidate(),
            }}
          >
            <p>
              This is not an empty board — the query failed.{" "}
              {dashboard.loadError}
            </p>
          </Banner>
        ) : null}

        {bannerError ? (
          <Banner tone="warning" title="Catalog sync issue">
            <p>{bannerError}</p>
          </Banner>
        ) : null}

        {recurringError ? (
          <Banner
            tone="warning"
            title="Couldn’t create a recurring PO"
            onDismiss={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("recurring_error");
              setSearchParams(next, { replace: true });
            }}
          >
            <p>{recurringError}</p>
          </Banner>
        ) : null}

        {pinnedReports.length ? (
          <Card>
            <BlockStack gap="300">
              <SectionHeading
                title="Pinned reports"
                icon={ChartVerticalIcon}
                subtitle="Living tiles from Report Builder — dismiss anytime."
              />
              {pinnedReports.map((pin) => {
                const support = (pin.supporting_data ?? {}) as {
                  title?: string;
                  template_id?: string;
                };
                return (
                  <BlockStack key={pin.id} gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Badge tone="success">Report</Badge>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {new Date(pin.generated_at).toLocaleString()}
                      </Text>
                    </InlineStack>
                    <Text as="h3" variant="headingSm">
                      {support.title ?? pin.summary}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {pin.summary}
                    </Text>
                    <InlineStack gap="200">
                      <Button
                        url={`/app/reports`}
                        onClick={() => undefined}
                      >
                        Open Report Builder
                      </Button>
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="dismiss_insight"
                        />
                        <input
                          type="hidden"
                          name="insightId"
                          value={pin.id}
                        />
                        <Button submit variant="plain">
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

        <AiInsightsPanel
          eligible={insightsEligible}
          gateReason={insightsGateReason}
          insights={insights}
        />

        {sync ? (
          <Banner tone="success" title="Catalog synced">
            <p>
              {sync.locations} locations · {sync.variants} variants ·{" "}
              {sync.inventoryLevels} inventory levels
            </p>
          </Banner>
        ) : null}

        {upcomingRecurring.length ? (
          <DashCard
            title="Upcoming recurring POs"
            empty="No recurring drafts due soon."
            icon={CalendarTimeIcon}
            rows={upcomingRecurring.map((row) => ({
              id: row.id,
              href: row.href,
              primary: row.primary,
              secondary: row.secondary,
              meta: row.meta,
              status: "draft" as const,
              right: row.right,
              badgeLabel: row.badgeLabel,
              badgeTone: row.badgeTone,
            }))}
          />
        ) : null}

        {!dashboard.loadError &&
        !dashboard.hasAnyPurchaseOrders &&
        !onboarding.showChecklist ? (
          <Card>
            <EmptyState
              heading="Create your first purchase order"
              image={EMPTY_STATE_IMAGE.orders}
              action={{
                content: "New PO",
                url: "/app/purchase-orders/new",
              }}
              secondaryAction={{
                content: "Add a supplier",
                url: "/app/suppliers/new",
              }}
            >
              <p>
                Today&apos;s Work fills in once you send POs — waiting
                confirmation, arrivals, and receiving queues all start here.
              </p>
            </EmptyState>
          </Card>
        ) : null}

        {!dashboard.loadError && dashboard.hasAnyPurchaseOrders ? (
          <Layout>
            <Layout.Section variant="oneHalf">
              <DashCard
                title="Waiting for confirmation"
                empty="No POs waiting on suppliers."
                icon={OrderIcon}
                rows={dashboard.waitingConfirmation}
              />
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <DashCard
                title="Inventory to receive"
                empty="Nothing ready to receive."
                icon={PackageIcon}
                rows={dashboard.readyToReceive}
              />
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <DashCard
                title="Shipments arriving today"
                empty="No shipments dated today."
                icon={DeliveryIcon}
                rows={dashboard.arrivingToday}
              />
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <DashCard
                title="Suppliers overdue"
                empty="No overdue ship dates."
                icon={AlertCircleIcon}
                rows={dashboard.overdue}
              />
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <SectionHeading
                    title="Recent supplier updates"
                    icon={DeliveryIcon}
                  />
                  {dashboard.recentUpdates.length === 0 ? (
                    <Text as="p" tone="subdued" variant="bodyMd">
                      Supplier Link activity will show up here once a supplier
                      opens or updates an order.
                    </Text>
                  ) : (
                    <ResourceList
                      resourceName={{ singular: "update", plural: "updates" }}
                      items={dashboard.recentUpdates}
                      renderItem={(event) => (
                        <ResourceItem
                          id={event.id}
                          url={`/app/purchase-orders/${event.poId}`}
                          accessibilityLabel={`View ${event.poNumber}`}
                        >
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                          >
                            <Text as="span" variant="bodyMd">
                              <Text as="span" fontWeight="semibold">
                                {event.poNumber}
                              </Text>{" "}
                              · {event.eventType} via {event.actor}
                              {event.supplierName
                                ? ` · ${event.supplierName}`
                                : ""}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {event.relative}
                            </Text>
                          </InlineStack>
                        </ResourceItem>
                      )}
                    />
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        ) : null}

        {isDev && loaderMs != null ? (
          <Text as="p" tone="subdued" variant="bodySm">
            Loader {loaderMs}ms (dev timing)
          </Text>
        ) : null}
      </BlockStack>
    </Page>
  );
}

function DashCard({
  title,
  empty,
  icon,
  rows,
}: {
  title: string;
  empty: string;
  icon: IconSource;
  rows: DashRow[];
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={icon} tone="base" />
            <Text as="h2" variant="headingMd">
              {title}
            </Text>
          </InlineStack>
          <Badge>{String(rows.length)}</Badge>
        </InlineStack>
        {rows.length === 0 ? (
          <Text as="p" tone="subdued" variant="bodyMd">
            {empty}
          </Text>
        ) : (
          <ResourceList
            resourceName={{ singular: "order", plural: "orders" }}
            items={rows}
            renderItem={(row) => (
              <ResourceItem
                id={row.id}
                url={row.href}
                accessibilityLabel={`View ${row.primary}`}
              >
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  gap="400"
                >
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {row.primary}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {row.secondary}
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge
                      tone={
                        row.badgeTone ?? statusBadgeTone(row.status)
                      }
                    >
                      {row.badgeLabel ?? statusLabel(row.status)}
                    </Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {row.meta}
                    </Text>
                    {row.right ? (
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {row.right}
                      </Text>
                    ) : null}
                  </InlineStack>
                </InlineStack>
              </ResourceItem>
            )}
          />
        )}
      </BlockStack>
    </Card>
  );
}
