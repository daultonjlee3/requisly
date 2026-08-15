import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getMerchantContext } from "../lib/merchant.server";
import { listRecipes } from "../lib/manufacturing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const recipes = await listRecipes(merchant.workspace.id);
  return { recipes };
};

export default function RecipesIndex() {
  const { recipes } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Bills of materials"
      backAction={{ content: "Manufacturing", url: "/app/manufacturing" }}
      primaryAction={{
        content: "New BOM",
        url: "/app/manufacturing/recipes/new",
      }}
    >
      <TitleBar title="BOMs" />
      <Card padding="0">
        {recipes.length === 0 ? (
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
    </Page>
  );
}
