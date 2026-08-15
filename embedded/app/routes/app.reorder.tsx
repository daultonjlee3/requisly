import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { InventoryIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionHeading } from "../components/SectionHeading";
import { getMerchantContext } from "../lib/merchant.server";
import { listReorderRecommendations } from "../lib/reorder.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const recs = await listReorderRecommendations(merchant.workspace.id);
  return {
    workspaceName: merchant.workspace.name,
    ...recs,
  };
};

function fmt(n: number, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

export default function ReorderPage() {
  const { workspaceName, rows, anySyntheticVelocity, needsReorderCount } =
    useLoaderData<typeof loader>();

  return (
    <Page
      title="Reorder recommendations"
      subtitle={workspaceName}
      backAction={{ content: "Products", url: "/app/products" }}
    >
      <TitleBar title="Reorder" />
      <BlockStack gap="500">
        <SectionHeading icon={InventoryIcon} title="What to reorder" />

        {anySyntheticVelocity ? (
          <Banner tone="warning" title="Synthetic test velocity — mechanism check only">
            <p>
              One or more recommendations use sales velocity from Shopify orders
              tagged <Text as="span" fontWeight="semibold">requisly_synthetic_test</Text>{" "}
              (Bogus/QA). This confirms the reorder math works. It does{" "}
              <Text as="span" fontWeight="semibold">not</Text> confirm real
              customer-driven demand — no real customer has transacted through
              this store.
            </p>
          </Banner>
        ) : null}

        <Banner tone="info" title={`${needsReorderCount} SKU(s) at or below reorder point`}>
          <p>
            Lead time is <Text as="span" fontWeight="semibold">confirmed</Text>{" "}
            from closed-PO timeline (sent → shipped) when history exists;
            otherwise it shows as an explicit{" "}
            <Text as="span" fontWeight="semibold">fallback estimate</Text> — never
            silently blended.
          </p>
        </Banner>

        <Card padding="0">
          {rows.length === 0 ? (
            <Box padding="400">
              <Text as="p" tone="subdued">
                No reorder settings yet. Enable reorder points on products that
                have supplier links and inventory.
              </Text>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "SKU", plural: "SKUs" }}
              itemCount={rows.length}
              headings={[
                { title: "Product" },
                { title: "On hand" },
                { title: "Velocity / day" },
                { title: "Lead time" },
                { title: "Reorder point" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {rows.map((row, index) => (
                <IndexTable.Row
                  id={row.product_variant_id}
                  key={row.product_variant_id}
                  position={index}
                >
                  <IndexTable.Cell>
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">
                        {row.title}
                      </Text>
                      <InlineStack gap="200">
                        {row.velocity_is_synthetic_test ? (
                          <Badge tone="warning">Synthetic velocity</Badge>
                        ) : (
                          <Badge tone="success">Live velocity</Badge>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.on_hand}</IndexTable.Cell>
                  <IndexTable.Cell>{fmt(row.units_per_day, 2)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="100">
                      <Text as="span">
                        {row.lead_time_days == null
                          ? "—"
                          : `${fmt(row.lead_time_days, 1)} days`}
                      </Text>
                      {row.lead_time_source === "confirmed" ? (
                        <Badge tone="success">
                          {`Confirmed (${row.confirmed_lead_po_count} POs)`}
                        </Badge>
                      ) : (
                        <Badge tone="attention">Fallback estimate</Badge>
                      )}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{fmt(row.reorder_point, 1)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.needs_reorder ? (
                      <Badge tone="critical">Needs reorder</Badge>
                    ) : (
                      <Badge>OK</Badge>
                    )}
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
