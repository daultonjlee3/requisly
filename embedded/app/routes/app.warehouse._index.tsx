import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getMerchantContext } from "../lib/merchant.server";
import { listStocktakes, listTransfers } from "../lib/warehouse.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const [transfers, stocktakes] = await Promise.all([
    listTransfers(merchant.workspace.id),
    listStocktakes(merchant.workspace.id),
  ]);
  return { transfers, stocktakes, workspaceName: merchant.workspace.name };
};

export default function WarehouseIndex() {
  const { transfers, stocktakes, workspaceName } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Warehouse"
      subtitle={workspaceName}
      primaryAction={{
        content: "New transfer",
        url: "/app/warehouse/transfers/new",
      }}
      secondaryActions={[
        { content: "New stocktake", url: "/app/warehouse/stocktakes/new" },
      ]}
    >
      <TitleBar title="Warehouse" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">
                Transfers
              </Text>
              <Button url="/app/warehouse/transfers/new">New transfer</Button>
            </InlineStack>
            {transfers.length === 0 ? (
              <Text as="p" tone="subdued">
                No transfers yet. Move stock between locations with
                draft → in transit → received.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "transfer", plural: "transfers" }}
                itemCount={transfers.length}
                headings={[
                  { title: "Route" },
                  { title: "Lines" },
                  { title: "Status" },
                  { title: "Created" },
                ]}
                selectable={false}
              >
                {transfers.map((t, i) => (
                  <IndexTable.Row id={t.id} key={t.id} position={i}>
                    <IndexTable.Cell>
                      <Link to={`/app/warehouse/transfers/${t.id}`}>
                        <Text as="span" fontWeight="semibold">
                          {t.fromLocationName} → {t.toLocationName}
                        </Text>
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{t.lineCount}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge
                        tone={
                          t.status === "received"
                            ? "success"
                            : t.status === "in_transit"
                              ? "attention"
                              : "info"
                        }
                      >
                        {t.status}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {new Date(t.createdAt).toLocaleDateString()}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">
                Stocktakes
              </Text>
              <Button url="/app/warehouse/stocktakes/new">New stocktake</Button>
            </InlineStack>
            {stocktakes.length === 0 ? (
              <Box>
                <Text as="p" tone="subdued">
                  No stocktakes yet. Count expected vs physical and apply
                  variance in one transaction.
                </Text>
              </Box>
            ) : (
              <IndexTable
                resourceName={{ singular: "stocktake", plural: "stocktakes" }}
                itemCount={stocktakes.length}
                headings={[
                  { title: "Location" },
                  { title: "Lines" },
                  { title: "Status" },
                  { title: "Started" },
                ]}
                selectable={false}
              >
                {stocktakes.map((s, i) => (
                  <IndexTable.Row id={s.id} key={s.id} position={i}>
                    <IndexTable.Cell>
                      <Link to={`/app/warehouse/stocktakes/${s.id}`}>
                        <Text as="span" fontWeight="semibold">
                          {s.locationName}
                        </Text>
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{s.lineCount}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge
                        tone={
                          s.status === "completed" ? "success" : "attention"
                        }
                      >
                        {s.status}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {new Date(s.startedAt).toLocaleDateString()}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
