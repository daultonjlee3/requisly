import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { useNavigate } from "@remix-run/react";
import type { PoStatus } from "../lib/po-status";
import { shortDate } from "../lib/format";

export type CalendarPo = {
  id: string;
  poNumber: string;
  status: PoStatus;
  statusLabel: string;
  statusTone?: "info" | "success" | "warning" | "critical";
  total: string;
  supplierName: string;
  plotDate: string;
  dateSource: "arrival" | "ship" | "recurring";
  href?: string;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function monthKey(year: number, monthIndex: number) {
  return `${year}-${pad(monthIndex + 1)}`;
}

export function parseMonthParam(
  value: string | null | undefined,
): { year: number; month: number } {
  const now = new Date();
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  const [y, m] = value.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year: y, month: m - 1 };
}

function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(year, month + delta, 1);
  return monthKey(d.getFullYear(), d.getMonth());
}

/**
 * Month-scoped PO schedule using Polaris primitives only.
 * Gap: Polaris has no month-grid calendar — this is a dated IndexTable + month controls.
 */
export function PoCalendar({
  purchaseOrders,
  monthParam,
  basePath = "/app/purchase-orders",
}: {
  purchaseOrders: CalendarPo[];
  monthParam?: string | null;
  basePath?: string;
}) {
  const navigate = useNavigate();
  const { year, month } = parseMonthParam(monthParam ?? undefined);
  const label = new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const thisMonth = monthKey(new Date().getFullYear(), new Date().getMonth());
  const key = monthKey(year, month);

  const rows = purchaseOrders
    .filter((po) => po.plotDate.startsWith(key))
    .sort((a, b) => (a.plotDate < b.plotDate ? -1 : 1));

  const href = (m: string) =>
    basePath.includes("calendar")
      ? `${basePath}?month=${m}`
      : `${basePath}?view=calendar&month=${m}`;

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
        <InlineStack gap="200" blockAlign="center">
          <Button url={href(prev)} accessibilityLabel="Previous month">
            Previous
          </Button>
          <Text as="h3" variant="headingMd">
            {label}
          </Text>
          <Button url={href(next)} accessibilityLabel="Next month">
            Next
          </Button>
        </InlineStack>
        <Button url={href(thisMonth)}>Today</Button>
      </InlineStack>

      {rows.length === 0 ? (
        <Box padding="400">
          <EmptyState
            heading={`No dated POs in ${label}`}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              Orders appear when they have a requested ship date, estimated
              arrival, or a recurring template draft date in this month.
            </p>
          </EmptyState>
        </Box>
      ) : (
        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "order", plural: "orders" }}
            itemCount={rows.length}
            headings={[
              { title: "Date" },
              { title: "Source" },
              { title: "PO #" },
              { title: "Supplier" },
              { title: "Status" },
              { title: "Total" },
            ]}
            selectable={false}
          >
            {rows.map((po, index) => (
              <IndexTable.Row
                id={po.id}
                key={po.id}
                position={index}
                onClick={() =>
                  navigate(po.href ?? `/app/purchase-orders/${po.id}`)
                }
              >
                <IndexTable.Cell>
                  <Text as="span" fontWeight="semibold">
                    {shortDate(po.plotDate)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {po.dateSource === "arrival"
                    ? "Arrival"
                    : po.dateSource === "recurring"
                      ? "Recurring"
                      : "Ship"}
                </IndexTable.Cell>
                <IndexTable.Cell>{po.poNumber}</IndexTable.Cell>
                <IndexTable.Cell>{po.supplierName}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={po.statusTone}>{po.statusLabel}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>{po.total}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      )}
    </BlockStack>
  );
}
