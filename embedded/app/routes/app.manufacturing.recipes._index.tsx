import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import {
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
import { listRecipes } from "../lib/manufacturing.server";
import { useFilteredCsvExport } from "../lib/use-filtered-csv-export";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const q = parseListQuery(url.searchParams.get("q"));
  const page = parseListPage(url.searchParams.get("page"));
  const forExport = url.searchParams.get("export") === "1";
  const result = await listRecipes(merchant.workspace.id, {
    q,
    ...(forExport ? { forExport: true } : { page }),
  });
  return {
    recipes: result.rows,
    total: result.total,
    q,
    page,
    exportRows: forExport ? result.rows : null,
    exportToken: forExport ? Date.now() : null,
  };
};

export default function RecipesIndex() {
  const { recipes, total, q, page } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(q);
  const applyParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(patchListParams(searchParams, patch));
    },
    [searchParams, setSearchParams],
  );
  const { exportCsv, exporting } = useFilteredCsvExport({
    path: "/app/manufacturing/recipes",
    searchParams,
    prefix: "boms",
    headers: ["finished_product", "sku", "ingredients"],
    mapRow: (r: (typeof recipes)[number]) => [
      r.finishedTitle,
      r.finishedSku ?? "",
      r.lineCount,
    ],
  });

  return (
    <Page
      title="Bills of materials"
      backAction={{ content: "Manufacturing", url: "/app/manufacturing" }}
      primaryAction={{
        content: "New BOM",
        url: "/app/manufacturing/recipes/new",
      }}
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled: total === 0 || exporting,
        },
      ]}
    >
      <TitleBar title="BOMs" />
      <BlockStack gap="400">
        {total > 0 || q ? (
          <Card padding="0">
            <Filters
              queryValue={queryValue}
              queryPlaceholder="Search finished product or SKU"
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
                  No recipes yet. Define ingredients for a finished product —
                  raw materials stay on the normal PO / Supplier Link path.
                </Text>
                <Button url="/app/manufacturing/recipes/new" variant="primary">
                  New BOM
                </Button>
              </BlockStack>
            </Box>
          ) : recipes.length === 0 ? (
            <Box padding="400">
              <Text as="p" tone="subdued">
                No BOMs match.
              </Text>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "BOM", plural: "BOMs" }}
              itemCount={recipes.length}
              headings={[
                { title: "Finished product" },
                { title: "SKU" },
                { title: "Ingredients" },
              ]}
              selectable={false}
              pagination={indexTablePagination({
                page,
                total,
                onPageChange: (next) => applyParams({ page: String(next) }),
              })}
            >
              {recipes.map((r, index) => (
                <IndexTable.Row id={r.id} key={r.id} position={index}>
                  <IndexTable.Cell>
                    <Link to={`/app/manufacturing/recipes/${r.id}`}>
                      <Text as="span" fontWeight="semibold">
                        {r.finishedTitle}
                      </Text>
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{r.finishedSku ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{r.lineCount}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
