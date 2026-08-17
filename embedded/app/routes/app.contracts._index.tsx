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
import { getMerchantContext } from "../lib/merchant.server";
import { listWorkspaceContracts } from "../lib/supplier-contracts.server";
import {
  indexTablePagination,
  parseListPage,
  parseListQuery,
  patchListParams,
} from "../lib/list-table";
import { useFilteredCsvExport } from "../lib/use-filtered-csv-export";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const q = parseListQuery(url.searchParams.get("q"));
  const page = parseListPage(url.searchParams.get("page"));
  const forExport = url.searchParams.get("export") === "1";
  const result = await listWorkspaceContracts(merchant.workspace.id, {
    q,
    ...(forExport ? { forExport: true } : { page }),
  });
  return {
    contracts: result.rows,
    total: result.total,
    q,
    page,
    exportRows: forExport ? result.rows : null,
    exportToken: forExport ? Date.now() : null,
  };
};

export default function ContractsIndex() {
  const { contracts, total, q, page } = useLoaderData<typeof loader>();
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
    path: "/app/contracts",
    searchParams,
    prefix: "contracts",
    headers: ["title", "supplier", "start", "renewal", "status"],
    mapRow: (row: (typeof contracts)[number]) => [
      row.title,
      row.supplierName,
      row.startLabel,
      row.renewalLabel,
      row.renewalStatusLabel,
    ],
  });

  return (
    <Page
      title="Contracts"
      subtitle="Vendor contracts and renewal dates"
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled: total === 0 || exporting,
        },
      ]}
    >
      <TitleBar title="Contracts" />
      <BlockStack gap="400">
        {total > 0 || q ? (
          <Card padding="0">
            <Filters
              queryValue={queryValue}
              queryPlaceholder="Search by title or notes"
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
              heading="No contracts yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Suppliers", url: "/app/suppliers" }}
            >
              <p>Open a supplier to add a contract and renewal date.</p>
            </EmptyState>
          ) : contracts.length === 0 ? (
            <EmptyState
              heading="No contracts match"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Try a different title or note.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "contract", plural: "contracts" }}
              itemCount={contracts.length}
              headings={[
                { title: "Contract" },
                { title: "Supplier" },
                { title: "Start" },
                { title: "Renewal" },
                { title: "Status" },
              ]}
              selectable={false}
              pagination={indexTablePagination({
                page,
                total,
                onPageChange: (next) => applyParams({ page: String(next) }),
              })}
            >
              {contracts.map((row, index) => (
                <IndexTable.Row
                  id={row.id}
                  key={row.id}
                  position={index}
                  onClick={() => navigate(`/app/suppliers/${row.supplierId}`)}
                >
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {row.title}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.supplierName}</IndexTable.Cell>
                  <IndexTable.Cell>{row.startLabel}</IndexTable.Cell>
                  <IndexTable.Cell>{row.renewalLabel}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={row.renewalTone}>{row.renewalStatusLabel}</Badge>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
