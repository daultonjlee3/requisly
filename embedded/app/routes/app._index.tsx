import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  ResourceItem,
  ResourceList,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { loadDashboard } from "../lib/dashboard.server";
import { getMerchantContext } from "../lib/merchant.server";
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
  const dashboard = await loadDashboard(merchant.workspace.id, { forceError });

  const ms = timer.end({
    catalogSyncPending: merchant.catalogSyncPending,
    dashboardError: Boolean(dashboard.loadError),
  });

  return {
    workspaceName: merchant.workspace.name,
    shopDomain: merchant.shopDomain,
    syncedAt: merchant.workspace.shopify_synced_at,
    catalogSyncPending: merchant.catalogSyncPending,
    syncError: merchant.syncError,
    dashboard,
    loaderMs: ms,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
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
    syncedAt,
    catalogSyncPending,
    syncError,
    dashboard,
    loaderMs,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const syncing = navigation.state !== "idle" && navigation.formData != null;
  const sync = actionData?.sync ?? null;
  const bannerError = actionData?.error ?? syncError;

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
              This is not an empty board — the query failed. {dashboard.loadError}
            </p>
          </Banner>
        ) : null}

        {bannerError ? (
          <Banner tone="warning" title="Catalog sync issue">
            <p>{bannerError}</p>
          </Banner>
        ) : null}

        {sync ? (
          <Banner tone="success" title="Catalog synced">
            <p>
              {sync.locations} locations · {sync.variants} variants ·{" "}
              {sync.inventoryLevels} inventory levels
            </p>
          </Banner>
        ) : null}

        {!dashboard.loadError ? (
          <Layout>
            <Layout.Section variant="oneHalf">
              <DashCard
                title="Waiting for confirmation"
                empty="No POs waiting on suppliers."
                rows={dashboard.waitingConfirmation}
              />
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <DashCard
                title="Inventory to receive"
                empty="Nothing ready to receive."
                rows={dashboard.readyToReceive}
              />
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <DashCard
                title="Shipments arriving today"
                empty="No shipments dated today."
                rows={dashboard.arrivingToday}
              />
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <DashCard
                title="Suppliers overdue"
                empty="No overdue ship dates."
                rows={dashboard.overdue}
              />
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Recent supplier updates
                  </Text>
                  {dashboard.recentUpdates.length === 0 ? (
                    <Text as="p" tone="subdued">
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

        {process.env.NODE_ENV !== "production" && loaderMs != null ? (
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
  rows,
}: {
  title: string;
  empty: string;
  rows: DashRow[];
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          <Badge>{String(rows.length)}</Badge>
        </InlineStack>
        {rows.length === 0 ? (
          <Text as="p" tone="subdued">
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
                    <Badge tone={statusBadgeTone(row.status)}>
                      {statusLabel(row.status)}
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
