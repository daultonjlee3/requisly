import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  getTransfer,
  markTransferInTransit,
  receiveTransfer,
} from "../lib/warehouse.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const transfer = await getTransfer(
    merchant.workspace.id,
    String(params.id ?? ""),
  );
  if (!transfer) throw new Response("Not found", { status: 404 });
  return { transfer };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const id = String(params.id ?? "");
  const intent = String((await request.formData()).get("intent") ?? "");
  try {
    if (intent === "in_transit") {
      const result = await markTransferInTransit(merchant.workspace.id, id);
      return { ok: true as const, result };
    }
    if (intent === "receive") {
      const result = await receiveTransfer(merchant.workspace.id, id);
      return { ok: true as const, result };
    }
    return { error: "Unknown action" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
};

export default function TransferDetailPage() {
  const { transfer } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <Page
      title={`${transfer.fromLocationName} → ${transfer.toLocationName}`}
      backAction={{ content: "Warehouse", url: "/app/warehouse" }}
    >
      <TitleBar title="Transfer" />
      <BlockStack gap="400">
        <InlineStack gap="200">
          <Badge
            tone={
              transfer.status === "received"
                ? "success"
                : transfer.status === "in_transit"
                  ? "attention"
                  : "info"
            }
          >
            {transfer.status}
          </Badge>
        </InlineStack>

        {actionData && "error" in actionData && actionData.error ? (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
            <p>
              Inventory was not partially updated — transfer RPCs run in a
              single transaction.
            </p>
          </Banner>
        ) : null}

        {actionData && "ok" in actionData && actionData.ok ? (
          <Banner tone="success" title="Transfer updated">
            <p>Status is now {(actionData.result as { status: string }).status}.</p>
          </Banner>
        ) : null}

        <Card>
          <DataTable
            columnContentTypes={["text", "text", "numeric"]}
            headings={["Product", "SKU", "Qty"]}
            rows={transfer.lines.map((l) => [
              l.title,
              l.sku ?? "—",
              l.qty,
            ])}
          />
        </Card>

        <InlineStack gap="200">
          {transfer.status === "draft" ? (
            <Form method="post">
              <input type="hidden" name="intent" value="in_transit" />
              <Button submit variant="primary" loading={busy}>
                Mark in transit
              </Button>
            </Form>
          ) : null}
          {transfer.status === "in_transit" ? (
            <Form method="post">
              <input type="hidden" name="intent" value="receive" />
              <Button submit variant="primary" tone="success" loading={busy}>
                Mark received
              </Button>
            </Form>
          ) : null}
          {transfer.status === "received" ? (
            <Text as="p" tone="subdued">
              Received{" "}
              {transfer.receivedAt
                ? new Date(transfer.receivedAt).toLocaleString()
                : ""}
              . Source was deducted on in-transit; destination credited on
              receive.
            </Text>
          ) : null}
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
