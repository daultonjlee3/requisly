import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Card,
  EmptyState,
  Filters,
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import { PoCalendar } from "../components/PoCalendar";
import { PoViewToggle } from "../components/PoViewToggle";
import { getMerchantContext } from "../lib/merchant.server";
import { listCalendarPurchaseOrders } from "../lib/purchase-orders.server";
import {
  addUtcDays,
  utcToday,
} from "../lib/recurring-po";
import { listCalendarRecurringEvents } from "../lib/recurring-pos.server";
import {
  indexTablePagination,
  LIST_PAGE_SIZE,
  parseListPage,
  parseListQuery,
  patchListParams,
} from "../lib/list-table";
import { useFilteredCsvExport } from "../lib/use-filtered-csv-export";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const q = parseListQuery(url.searchParams.get("q"));
  const page = parseListPage(url.searchParams.get("page"));
  const forExport = url.searchParams.get("export") === "1";
  const today = utcToday();
  const [rows, recurring] = await Promise.all([
    listCalendarPurchaseOrders(merchant.workspace.id),
    listCalendarRecurringEvents(
      merchant.workspace.id,
      addUtcDays(today, -180),
      addUtcDays(today, 400),
    ),
  ]);

  const needle = q.toLowerCase();
  const all = [
    ...rows.map((row) => ({
      id: row.id,
      poNumber: row.poNumber,
      status: row.status,
      statusLabel: row.statusLabel,
      statusTone: row.statusTone,
      total: row.total,
      supplierName: row.supplierName,
      plotDate: row.plotDate,
      dateSource: row.dateSource as "arrival" | "ship" | "recurring",
      href: `/app/purchase-orders/${row.id}`,
    })),
    ...recurring.map((row) => ({
      id: row.id,
      poNumber: row.poNumber,
      status: "draft" as const,
      statusLabel: row.statusLabel,
      statusTone: row.statusTone,
      total: row.total,
      supplierName: row.supplierName,
      plotDate: row.plotDate,
      dateSource: row.dateSource,
      href: row.href,
    })),
  ]
    .filter((row) => {
      if (!needle) return true;
      return (
        row.poNumber.toLowerCase().includes(needle) ||
        row.supplierName.toLowerCase().includes(needle) ||
        row.statusLabel.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => (a.plotDate < b.plotDate ? -1 : 1));

  const total = all.length;
  const pageRows = forExport
    ? all
    : all.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);

  return {
    workspaceName: merchant.workspace.name,
    rows: all,
    tableRows: pageRows,
    total,
    q,
    page,
    month,
    exportRows: forExport ? all : null,
    exportToken: forExport ? Date.now() : null,
  };
};

export default function CalendarPage() {
  const { workspaceName, rows, tableRows, total, q, page, month } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(q);
  const applyParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(patchListParams(searchParams, patch));
    },
    [searchParams, setSearchParams],
  );
  const { exportCsv, exporting } = useFilteredCsvExport({
    path: "/app/calendar",
    searchParams,
    prefix: "calendar",
    headers: ["date", "source", "number", "supplier", "status", "total"],
    mapRow: (row: (typeof rows)[number]) => [
      row.plotDate,
      row.dateSource,
      row.poNumber,
      row.supplierName,
      row.statusLabel,
      row.total,
    ],
  });

  return (
    <Page
      title="Calendar"
      subtitle={`${workspaceName} · ship / arrival / recurring drafts`}
      primaryAction={{
        content: "New PO",
        url: "/app/purchase-orders/new",
      }}
      secondaryActions={[
        {
          content: "All purchase orders",
          url: "/app/purchase-orders",
        },
        {
          content: "Export",
          onAction: exportCsv,
          disabled: total === 0 || exporting,
        },
      ]}
    >
      <TitleBar title="Calendar" />
      <BlockStack gap="400">
        <InlineStack align="start">
          <PoViewToggle
            view="calendar"
            month={month ?? undefined}
            basePath="/app/purchase-orders"
          />
        </InlineStack>
        {total > 0 || q ? (
          <Card padding="0">
            <Filters
              queryValue={queryValue}
              queryPlaceholder="Search by PO, supplier, or status"
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
        <PoCalendar
          purchaseOrders={rows}
          monthParam={month}
          basePath="/app/calendar"
        />
        <Card padding="0">
          {total === 0 ? (
            <EmptyState
              heading={q ? "No calendar rows match" : "Nothing on the calendar"}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                {q
                  ? "Try a different PO number, supplier, or status."
                  : "POs with a ship or arrival date appear here."}
              </p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "event", plural: "events" }}
              itemCount={tableRows.length}
              headings={[
                { title: "Date" },
                { title: "Number" },
                { title: "Supplier" },
                { title: "Status" },
                { title: "Total" },
              ]}
              selectable={false}
              pagination={indexTablePagination({
                page,
                total,
                onPageChange: (next) => applyParams({ page: String(next) }),
              })}
            >
              {tableRows.map((row, index) => (
                <IndexTable.Row
                  id={row.id}
                  key={row.id}
                  position={index}
                  onClick={() => navigate(row.href)}
                >
                  <IndexTable.Cell>
                    <Text as="span">{row.plotDate}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {row.dateSource}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.poNumber}</IndexTable.Cell>
                  <IndexTable.Cell>{row.supplierName}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.total}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
