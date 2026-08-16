import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  Card,
  EmptyState,
  IndexTable,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getMerchantContext } from "../lib/merchant.server";
import { listBlanketPurchaseOrders } from "../lib/blanket-pos.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const blankets = await listBlanketPurchaseOrders(merchant.workspace.id);
  return { blankets };
};

export default function BlanketPurchaseOrdersIndex() {
  const { blankets } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page
      title="Blanket POs"
      subtitle="Committed quantity or value with a supplier. Real POs draw it down."
    >
      <TitleBar title="Blanket POs" />
      {blankets.length === 0 ? (
        <Card>
          <EmptyState
            heading="No blanket POs yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            action={{ content: "Suppliers", url: "/app/suppliers" }}
          >
            <p>
              Open a supplier and create a blanket there. Then attach it when
              you draft a purchase order.
            </p>
          </EmptyState>
        </Card>
      ) : (
        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "blanket", plural: "blankets" }}
            itemCount={blankets.length}
            headings={[
              { title: "Blanket" },
              { title: "Supplier" },
              { title: "Period" },
              { title: "Remaining" },
              { title: "Committed" },
              { title: "Status" },
            ]}
            selectable={false}
          >
            {blankets.map((blanket, index) => (
              <IndexTable.Row
                id={blanket.id}
                key={blanket.id}
                position={index}
                onClick={() => navigate(`/app/blankets/${blanket.id}`)}
              >
                <IndexTable.Cell>
                  <Text as="span" fontWeight="semibold">
                    {blanket.blanketNumber}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {blanket.title}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>{blanket.supplierName}</IndexTable.Cell>
                <IndexTable.Cell>{blanket.periodLabel}</IndexTable.Cell>
                <IndexTable.Cell>{blanket.remainingLabel}</IndexTable.Cell>
                <IndexTable.Cell>{blanket.committedLabel}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={blanket.statusTone}>{blanket.statusLabel}</Badge>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      )}
    </Page>
  );
}
