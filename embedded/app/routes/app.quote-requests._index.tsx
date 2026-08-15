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
import { listQuoteRequests } from "../lib/quote-requests.server";
import { useFilteredCsvExport } from "../lib/use-filtered-csv-export";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const q = parseListQuery(url.searchParams.get("q"));
  const page = parseListPage(url.searchParams.get("page"));
  const forExport = url.searchParams.get("export") === "1";
  const result = await listQuoteRequests(merchant.workspace.id, {
    q,
    ...(forExport ? { forExport: true } : { page }),
  });
  return {
    rows: result.rows,
    total: result.total,
    workspaceName: merchant.workspace.name,
    q,
    page,
    exportRows: forExport ? result.rows : null,
    exportToken: forExport ? Date.now() : null,
  };
};

function statusTone(
  status: string,
): "success" | "attention" | "info" | "critical" | undefined {
  if (status === "awarded") return "success";
  if (status === "responded" || status === "partially_responded")
    return "attention";
  if (status === "cancelled") return "critical";
  return "info";
}

export default function QuoteRequestsIndex() {
  const { rows, total, workspaceName, q, page } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(q);
  const applyParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(patchListParams(searchParams, patch));
    },
    [searchParams, setSearchParams],
  );
  const { exportCsv, exporting } = useFilteredCsvExport({
    path: "/app/quote-requests",
    searchParams,
    prefix: "quote-requests",
    headers: ["title", "status", "suppliers_responded", "suppliers", "lines", "needed_by"],
    mapRow: (row: (typeof rows)[number]) => [
      row.title,
      row.status,
      row.responseCount,
      row.supplierCount,
      row.lineCount,
      row.neededBy ?? "",
    ],
  });

  return (
    <Page
      title="Quote requests"
      subtitle={`${workspaceName} · ${total} request${total === 1 ? "" : "s"}`}
      primaryAction={{
        content: "New quote request",
        url: "/app/quote-requests/new",
      }}
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled: total === 0 || exporting,
        },
      ]}
    >
      <TitleBar title="Quote requests" />
      <BlockStack gap="400">
        {total > 0 || q ? (
          <Card padding="0">
            <Filters
              queryValue={queryValue}
              queryPlaceholder="Search by title"
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
        ) : null}
        <Card padding="0">
          {total === 0 && !q ? (
            <Box padding="400">
              <BlockStack gap="200">
                <Text as="p" tone="subdued">
                  Request quotes from multiple suppliers, compare responses, then
                  award lines into draft POs.
                </Text>
                <Button url="/app/quote-requests/new" variant="primary">
                  New quote request
                </Button>
              </BlockStack>
            </Box>
          ) : rows.length === 0 ? (
            <Box padding="400">
              <Text as="p" tone="subdued">
                No quote requests match.
              </Text>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "request", plural: "requests" }}
              itemCount={rows.length}
              headings={[
                { title: "Title" },
                { title: "Status" },
                { title: "Suppliers" },
                { title: "Lines" },
              ]}
              selectable={false}
              pagination={indexTablePagination({
                page,
                total,
                onPageChange: (next) => applyParams({ page: String(next) }),
              })}
            >
              {rows.map((row, index) => (
                <IndexTable.Row id={row.id} key={row.id} position={index}>
                  <IndexTable.Cell>
                    <Link to={`/app/quote-requests/${row.id}`}>
                      <Text as="span" fontWeight="semibold">
                        {row.title}
                      </Text>
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.responseCount}/{row.supplierCount} responded
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.lineCount}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
