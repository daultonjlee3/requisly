import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Card,
  EmptyState,
  Filters,
  IndexTable,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import {
  indexTablePagination,
  parseListPage,
  parseListQuery,
  patchListParams,
} from "../lib/list-table";
import { getMerchantContext } from "../lib/merchant.server";
import { listSuppliersPage } from "../lib/suppliers.server";
import { useFilteredCsvExport } from "../lib/use-filtered-csv-export";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const q = parseListQuery(url.searchParams.get("q"));
  const page = parseListPage(url.searchParams.get("page"));
  const forExport = url.searchParams.get("export") === "1";
  const result = await listSuppliersPage(merchant.workspace.id, {
    q,
    ...(forExport ? { forExport: true } : { page }),
  });
  return {
    workspaceName: merchant.workspace.name,
    suppliers: result.rows,
    total: result.total,
    q,
    page,
    exportRows: forExport ? result.rows : null,
    exportToken: forExport ? Date.now() : null,
  };
};

export default function SuppliersList() {
  const { workspaceName, suppliers, total, q, page } =
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
    path: "/app/suppliers",
    searchParams,
    prefix: "suppliers",
    headers: ["name", "email", "open_pos", "added"],
    mapRow: (s: (typeof suppliers)[number]) => [
      s.name,
      s.email,
      s.openOrders,
      s.createdAt,
    ],
  });

  return (
    <Page
      title="Suppliers"
      subtitle={`${workspaceName} · ${total} supplier${total === 1 ? "" : "s"}`}
      primaryAction={{ content: "Add supplier", url: "/app/suppliers/new" }}
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled: total === 0 || exporting,
        },
      ]}
    >
      <TitleBar title="Suppliers" />
      <BlockStack gap="400">
        {total > 0 || q ? (
          <Card padding="0">
            <Filters
              queryValue={queryValue}
              queryPlaceholder="Search by name or email"
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
            <EmptyState
              heading="No suppliers yet"
              action={{ content: "Add supplier", url: "/app/suppliers/new" }}
              image={EMPTY_STATE_IMAGE.suppliers}
            >
              <p>Add a supplier before creating purchase orders.</p>
            </EmptyState>
          ) : suppliers.length === 0 ? (
            <EmptyState
              heading="No suppliers match"
              image={EMPTY_STATE_IMAGE.suppliers}
            >
              <p>Try a different name or email.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "supplier", plural: "suppliers" }}
              itemCount={suppliers.length}
              headings={[
                { title: "Name" },
                { title: "Email" },
                { title: "Open POs" },
                { title: "Added" },
              ]}
              selectable={false}
              pagination={indexTablePagination({
                page,
                total,
                onPageChange: (next) => applyParams({ page: String(next) }),
              })}
            >
              {suppliers.map((s, index) => (
                <IndexTable.Row
                  id={s.id}
                  key={s.id}
                  position={index}
                  onClick={() => navigate(`/app/suppliers/${s.id}`)}
                >
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {s.name}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{s.email}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge>{String(s.openOrders)}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{s.createdAt}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
