import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { BlockStack, InlineStack, Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { PoCalendar } from "../components/PoCalendar";
import { PoViewToggle } from "../components/PoViewToggle";
import { getMerchantContext } from "../lib/merchant.server";
import { listCalendarPurchaseOrders } from "../lib/purchase-orders.server";
import {
  addUtcDays,
  utcToday,
} from "../lib/recurring-po";
import { listCalendarRecurringEvents } from "../lib/recurring-pos.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const today = utcToday();
  const [rows, recurring] = await Promise.all([
    listCalendarPurchaseOrders(merchant.workspace.id),
    listCalendarRecurringEvents(
      merchant.workspace.id,
      addUtcDays(today, -180),
      addUtcDays(today, 400),
    ),
  ]);
  return { workspaceName: merchant.workspace.name, rows, recurring, month };
};

export default function CalendarPage() {
  const { workspaceName, rows, recurring, month } = useLoaderData<typeof loader>();

  const calendarPos = [
    ...rows.map((row) => ({
      id: row.id,
      poNumber: row.poNumber,
      status: row.status,
      statusLabel: row.statusLabel,
      statusTone: row.statusTone,
      total: row.total,
      supplierName: row.supplierName,
      plotDate: row.plotDate,
      dateSource: row.dateSource as "arrival" | "ship",
      href: `/app/purchase-orders/${row.id}`,
    })),
    ...recurring.map((row) => ({
      id: row.id,
      poNumber: row.poNumber,
      status: "draft" as const,
      statusLabel: row.statusLabel,
      statusTone: row.statusTone,
      total: row.total,
      supplierName: row.supplierName,
      plotDate: row.plotDate,
      dateSource: row.dateSource,
      href: row.href,
    })),
  ];

  return (
    <Page
      title="Calendar"
      subtitle={`${workspaceName} · ship / arrival / recurring drafts`}
      primaryAction={{
        content: "New PO",
        url: "/app/purchase-orders/new",
      }}
      secondaryActions={[
        {
          content: "All purchase orders",
          url: "/app/purchase-orders",
        },
      ]}
    >
      <TitleBar title="Calendar" />
      <BlockStack gap="400">
        <InlineStack align="start">
          <PoViewToggle
            view="calendar"
            month={month ?? undefined}
            basePath="/app/purchase-orders"
          />
        </InlineStack>
        <PoCalendar
          purchaseOrders={calendarPos}
          monthParam={month}
          basePath="/app/calendar"
        />
      </BlockStack>
    </Page>
  );
}
