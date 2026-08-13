import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
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
import { useCallback, useMemo, useState } from "react";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import { downloadCsv, stampFilename, toCsv } from "../lib/csv";
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
  const [queryValue, setQueryValue] = useState("");

  const filtered = useMemo(() => {
    const q = queryValue.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => {
      const hay = `${s.name} ${s.email}`.toLowerCase();
      return hay.includes(q);
    });
  }, [suppliers, queryValue]);

  const exportCsv = useCallback(() => {
    const csv = toCsv(
      ["name", "email", "open_pos", "added"],
      filtered.map((s) => [s.name, s.email, s.openOrders, s.createdAt]),
    );
    downloadCsv(stampFilename("suppliers"), csv);
  }, [filtered]);

  return (
    <Page
      title="Suppliers"
      subtitle={`${workspaceName} · ${filtered.length} of ${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}`}
      primaryAction={{ content: "Add supplier", url: "/app/suppliers/new" }}
      secondaryActions={[
        {
          content: "Export",
          onAction: exportCsv,
          disabled: filtered.length === 0,
        },
      ]}
    >
      <TitleBar title="Suppliers" />
      <BlockStack gap="400">
        {suppliers.length > 0 ? (
          <Card padding="0">
            <Filters
              queryValue={queryValue}
              queryPlaceholder="Search by name or email"
              filters={[]}
              onQueryChange={setQueryValue}
              onQueryClear={() => setQueryValue("")}
              onClearAll={() => setQueryValue("")}
            />
          </Card>
        ) : null}

        <Card padding="0">
          {suppliers.length === 0 ? (
            <EmptyState
              heading="No suppliers yet"
              action={{ content: "Add supplier", url: "/app/suppliers/new" }}
              image={EMPTY_STATE_IMAGE.suppliers}
            >
              <p>Add a supplier before creating purchase orders.</p>
            </EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState
              heading="No suppliers match"
              image={EMPTY_STATE_IMAGE.suppliers}
            >
              <p>Try a different name or email.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "supplier", plural: "suppliers" }}
              itemCount={filtered.length}
              headings={[
                { title: "Name" },
                { title: "Email" },
                { title: "Open POs" },
                { title: "Added" },
              ]}
              selectable={false}
            >
              {filtered.map((s, index) => (
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
