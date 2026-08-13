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
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import { getMerchantContext } from "../lib/merchant.server";
import { listSuppliers } from "../lib/suppliers.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const suppliers = await listSuppliers(merchant.workspace.id);
  return { workspaceName: merchant.workspace.name, suppliers };
};

export default function SuppliersList() {
  const { workspaceName, suppliers } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page
      title="Suppliers"
      subtitle={`${workspaceName} · ${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}`}
      primaryAction={{ content: "Add supplier", url: "/app/suppliers/new" }}
    >
      <TitleBar title="Suppliers" />
      <Card padding="0">
        {suppliers.length === 0 ? (
          <EmptyState
            heading="No suppliers yet"
            action={{ content: "Add supplier", url: "/app/suppliers/new" }}
            image={EMPTY_STATE_IMAGE.suppliers}
          >
            <p>Add a supplier before creating purchase orders.</p>
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
    </Page>
  );
}
