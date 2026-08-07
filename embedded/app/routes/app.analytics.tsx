import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Card,
  DataTable,
  InlineGrid,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { loadAnalytics } from "../lib/analytics.server";
import { getMerchantContext } from "../lib/merchant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const analytics = await loadAnalytics(merchant.workspace.id);
  return { workspaceName: merchant.workspace.name, analytics };
};

export default function AnalyticsPage() {
  const { workspaceName, analytics } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

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

        {!analytics.loadError ? (
          <>
            {analytics.isDemo ? (
              <Banner tone="info" title="Demo workspace">
                <p>Scorecards may include seeded demo history.</p>
              </Banner>
            ) : null}

            <InlineGrid columns={3} gap="400">
              <Card>
                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">
                    Closed POs
                  </Text>
                  <Text as="p" variant="headingLg">
                    {analytics.closedCount}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">
                    Suppliers with scorecards
                  </Text>
                  <Text as="p" variant="headingLg">
                    {analytics.scorecards.length}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="span" tone="subdued" variant="bodySm">
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
                <Text as="h2" variant="headingMd">
                  Supplier scorecards
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Metrics unlock after 5 closed POs per supplier.
                </Text>
                {analytics.scorecards.length === 0 ? (
                  <Text as="p" tone="subdued">
                    No scorecard rows yet.
                  </Text>
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
                <Text as="h2" variant="headingMd">
                  Closed PO spend by supplier
                </Text>
                {analytics.spendBySupplier.length === 0 ? (
                  <Text as="p" tone="subdued">
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
