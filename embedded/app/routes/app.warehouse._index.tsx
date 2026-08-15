import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Filters,
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import {
  indexTablePagination,
  parseListPage,
  parseListQuery,
  patchListParams,
} from "../lib/list-table";
import { getMerchantContext } from "../lib/merchant.server";
import { listStocktakes, listTransfers } from "../lib/warehouse.server";
import { useFilteredCsvExport } from "../lib/use-filtered-csv-export";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const q = parseListQuery(url.searchParams.get("q"));
  const tPage = parseListPage(url.searchParams.get("tpage"));
  const sPage = parseListPage(url.searchParams.get("spage"));
  const forExport = url.searchParams.get("export") === "1";
  const [transfers, stocktakes] = await Promise.all([
    listTransfers(merchant.workspace.id, {
      q,
      ...(forExport ? { forExport: true } : { page: tPage }),
    }),
    listStocktakes(merchant.workspace.id, {
      q,
      ...(forExport ? { forExport: true } : { page: sPage }),
    }),
  ]);
  const exportRows = forExport
    ? [
        ...transfers.rows.map((t) => ({
          type: "transfer",
          name: `${t.fromLocationName} → ${t.toLocationName}`,
          status: t.status,
          lines: t.lineCount,
          date: t.createdAt,
        })),
        ...stocktakes.rows.map((s) => ({
          type: "stocktake",
          name: s.locationName,
          status: s.status,
          lines: s.lineCount,
          date: s.startedAt,
        })),
      ]
    : null;
  return {
    transfers: transfers.rows,
    transferTotal: transfers.total,
    stocktakes: stocktakes.rows,
    stocktakeTotal: stocktakes.total,
    workspaceName: merchant.workspace.name,
    q,
    tPage,
    sPage,
    exportRows,
    exportToken: forExport ? Date.now() : null,
  };
};

export default function WarehouseIndex() {
  const {
    transfers,
    transferTotal,
    stocktakes,
    stocktakeTotal,
    workspaceName,
    q,
    tPage,
    sPage,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(q);
  const applyParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(patchListParams(searchParams, patch));
    },
    [searchParams, setSearchParams],
  );
  const { exportCsv, exporting } = useFilteredCsvExport({
    path: "/app/warehouse",
    searchParams,
    prefix: "warehouse",
    headers: ["type", "name", "status", "lines", "date"],
    mapRow: (row: {
      type: string;
      name: string;
      status: string;
      lines: number;
      date: string;
    }) => [row.type, row.name, row.status, row.lines, row.date],
  });

  return (
    <Page
      title="Warehouse"
      subtitle={workspaceName}
      primaryAction={{
        content: "New transfer",
        url: "/app/warehouse/transfers/new",
      }}
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled: (transferTotal === 0 && stocktakeTotal === 0) || exporting,
        },
        { content: "New stocktake", url: "/app/warehouse/stocktakes/new" },
      ]}
    >
      <TitleBar title="Warehouse" />
      <BlockStack gap="500">
        <Card padding="0">
          <Filters
            queryValue={queryValue}
            queryPlaceholder="Search by location"
            filters={[]}
            onQueryChange={setQueryValue}
            onQueryClear={() => {
              setQueryValue("");
              applyParams({ q: null });
            }}
            onQueryBlur={() => applyParams({ q: queryValue || null })}
            onClearAll={() => {
              setQueryValue("");
              applyParams({ q: null });
            }}
          />
        </Card>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">
                Transfers
              </Text>
              <Button url="/app/warehouse/transfers/new">New transfer</Button>
            </InlineStack>
            {transferTotal === 0 ? (
              <Text as="p" tone="subdued">
                {q
                  ? "No transfers match."
                  : "No transfers yet. Move stock between locations with draft → in transit → received."}
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
                pagination={indexTablePagination({
                  page: tPage,
                  total: transferTotal,
                  onPageChange: (next) => applyParams({ tpage: String(next) }),
                })}
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
            {stocktakeTotal === 0 ? (
              <Box>
                <Text as="p" tone="subdued">
                  {q
                    ? "No stocktakes match."
                    : "No stocktakes yet. Count expected vs physical and apply variance in one transaction."}
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
                pagination={indexTablePagination({
                  page: sPage,
                  total: stocktakeTotal,
                  onPageChange: (next) => applyParams({ spage: String(next) }),
                })}
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
