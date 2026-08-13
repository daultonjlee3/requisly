import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Card,
  ChoiceList,
  EmptyState,
  Filters,
  IndexTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback, useMemo, useState } from "react";
import { PoCalendar } from "../components/PoCalendar";
import { PoKanbanBoard } from "../components/PoKanbanBoard";
import {
  PoViewToggle,
  resolvePoView,
} from "../components/PoViewToggle";
import { EMPTY_STATE_IMAGE } from "../lib/empty-state-images";
import { getMerchantContext } from "../lib/merchant.server";
import { listPurchaseOrders } from "../lib/purchase-orders.server";
import { listSuppliers } from "../lib/suppliers.server";
import { TIMELINE_STEPS } from "../lib/po-status";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const view = resolvePoView(url.searchParams.get("view"));
  const month = url.searchParams.get("month");
  const status = url.searchParams.get("status");
  const supplierId = url.searchParams.get("supplier");
  const [purchaseOrders, suppliers] = await Promise.all([
    listPurchaseOrders(merchant.workspace.id, { status, supplierId }),
    listSuppliers(merchant.workspace.id),
  ]);
  return {
    workspaceName: merchant.workspace.name,
    purchaseOrders,
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
    view,
    month,
    status,
    supplierId,
  };
};

export default function PurchaseOrdersList() {
  const {
    workspaceName,
    purchaseOrders,
    suppliers,
    view,
    month,
    status,
    supplierId,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState("");

  const count = purchaseOrders.length;

  const filtered = useMemo(() => {
    const q = queryValue.trim().toLowerCase();
    if (!q) return purchaseOrders;
    return purchaseOrders.filter((po) => {
      const hay =
        `${po.poNumber} ${po.supplierName} ${po.statusLabel}`.toLowerCase();
      return hay.includes(q);
    });
  }, [purchaseOrders, queryValue]);

  const applyParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (!value) next.delete(key);
        else next.set(key, value);
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={TIMELINE_STEPS.map((s) => ({
            label: s.label,
            value: s.key,
          }))}
          selected={status ? [status] : []}
          onChange={(selected) =>
            applyParams({ status: selected[0] ?? null })
          }
        />
      ),
      shortcut: true,
    },
    {
      key: "supplier",
      label: "Supplier",
      filter: (
        <ChoiceList
          title="Supplier"
          titleHidden
          choices={suppliers.map((s) => ({ label: s.name, value: s.id }))}
          selected={supplierId ? [supplierId] : []}
          onChange={(selected) =>
            applyParams({ supplier: selected[0] ?? null })
          }
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = [
    ...(status
      ? [
          {
            key: "status",
            label: `Status: ${TIMELINE_STEPS.find((s) => s.key === status)?.label ?? status}`,
            onRemove: () => applyParams({ status: null }),
          },
        ]
      : []),
    ...(supplierId
      ? [
          {
            key: "supplier",
            label: `Supplier: ${suppliers.find((s) => s.id === supplierId)?.name ?? "Selected"}`,
            onRemove: () => applyParams({ supplier: null }),
          },
        ]
      : []),
  ];

  const calendarPos = filtered
    .map((po) => {
      const plotDate = po.estimatedArrivalRaw || po.requestedShipDateRaw;
      if (!plotDate) return null;
      return {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        statusLabel: po.statusLabel,
        statusTone: po.statusTone,
        total: po.total,
        supplierName: po.supplierName,
        plotDate,
        dateSource: po.estimatedArrivalRaw
          ? ("arrival" as const)
          : ("ship" as const),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p != null);

  return (
    <Page
      title="Purchase orders"
      subtitle={`${workspaceName} · ${count} order${count === 1 ? "" : "s"}`}
      primaryAction={{
        content: "New PO",
        url: "/app/purchase-orders/new",
      }}
      secondaryActions={[
        {
          content: "Calendar page",
          url: "/app/calendar",
        },
      ]}
      backAction={{ content: "Today's Work", url: "/app" }}
    >
      <TitleBar title="Purchase orders" />
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <PoViewToggle view={view} month={month ?? undefined} />
        </InlineStack>

        <Card padding="0">
          <Filters
            queryValue={queryValue}
            filters={filters}
            appliedFilters={appliedFilters}
            onQueryChange={setQueryValue}
            onQueryClear={() => setQueryValue("")}
            onClearAll={() => {
              setQueryValue("");
              applyParams({ status: null, supplier: null });
            }}
          />
        </Card>

        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              heading="No purchase orders match"
              action={{
                content: "New PO",
                url: "/app/purchase-orders/new",
              }}
              image={EMPTY_STATE_IMAGE.orders}
            >
              <p>Clear filters or create a new purchase order.</p>
            </EmptyState>
          </Card>
        ) : view === "kanban" ? (
          <PoKanbanBoard purchaseOrders={filtered} />
        ) : view === "calendar" ? (
          <PoCalendar purchaseOrders={calendarPos} monthParam={month} />
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{
                singular: "purchase order",
                plural: "purchase orders",
              }}
              itemCount={filtered.length}
              headings={[
                { title: "PO #" },
                { title: "Supplier" },
                { title: "Status" },
                { title: "Total" },
                { title: "Ship date" },
                { title: "Updated" },
              ]}
              selectable={false}
            >
              {filtered.map((po, index) => (
                <IndexTable.Row
                  id={po.id}
                  key={po.id}
                  position={index}
                  onClick={() => navigate(`/app/purchase-orders/${po.id}`)}
                >
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {po.poNumber}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{po.supplierName}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={po.statusTone}>{po.statusLabel}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" numeric>
                      {po.total}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{po.shipDate}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" tone="subdued">
                      {po.updated}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
