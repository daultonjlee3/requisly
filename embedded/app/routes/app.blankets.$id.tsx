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
  FormLayout,
  IndexTable,
  InlineGrid,
  InlineStack,
  Page,
  ProgressBar,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  closeBlanketPurchaseOrder,
  deleteBlanketPurchaseOrder,
  getBlanketDetail,
  updateBlanketPurchaseOrder,
} from "../lib/blanket-pos.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const blanket = await getBlanketDetail(
    merchant.workspace.id,
    params.id ?? "",
  );
  if (!blanket) throw new Response("Not found", { status: 404 });
  return { blanket };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const blanketId = params.id ?? "";

  try {
    if (intent === "update_blanket") {
      await updateBlanketPurchaseOrder({
        workspaceId: merchant.workspace.id,
        blanketId,
        title: String(formData.get("title") ?? ""),
        startDate: String(formData.get("start_date") ?? ""),
        endDate: String(formData.get("end_date") ?? ""),
        committedQty: String(formData.get("committed_qty") ?? ""),
        committedValue: String(formData.get("committed_value") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      return merchant.redirect(`/app/blankets/${blanketId}`);
    }
    if (intent === "close_blanket") {
      await closeBlanketPurchaseOrder(merchant.workspace.id, blanketId);
      return merchant.redirect(`/app/blankets/${blanketId}`);
    }
    if (intent === "delete_blanket") {
      await deleteBlanketPurchaseOrder(merchant.workspace.id, blanketId);
      return merchant.redirect("/app/blankets");
    }
    return { error: "Unknown action" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Action failed",
    };
  }
};

export default function BlanketPurchaseOrderDetail() {
  const { blanket } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const intent = String(navigation.formData?.get("intent") ?? "");
  const closed = blanket.storedStatus === "closed";

  const [title, setTitle] = useState(blanket.title);
  const [startDate, setStartDate] = useState(blanket.startDate ?? "");
  const [endDate, setEndDate] = useState(blanket.endDate ?? "");
  const [committedQty, setCommittedQty] = useState(
    blanket.committedQty == null ? "" : String(blanket.committedQty),
  );
  const [committedValue, setCommittedValue] = useState(
    blanket.committedValue == null ? "" : String(blanket.committedValue),
  );
  const [notes, setNotes] = useState(blanket.notes ?? "");

  return (
    <Page
      title={blanket.blanketNumber}
      subtitle={`${blanket.supplierName} · ${blanket.title}`}
      titleMetadata={
        <Badge tone={blanket.statusTone}>{blanket.statusLabel}</Badge>
      }
      backAction={{ content: "Blanket POs", url: "/app/blankets" }}
      primaryAction={{
        content: "New PO against this",
        url: `/app/purchase-orders/new?supplier=${blanket.supplierId}&blanket=${blanket.id}`,
        disabled: blanket.status !== "active",
      }}
      secondaryActions={[
        {
          content: "Supplier",
          url: `/app/suppliers/${blanket.supplierId}?tab=blankets`,
        },
      ]}
    >
      <TitleBar title={blanket.blanketNumber} />
      <BlockStack gap="400">
        {actionData?.error ? (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Remaining commitment
            </Text>
            <InlineGrid columns={3} gap="400">
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  Remaining
                </Text>
                <Text as="p" variant="headingLg">
                  {blanket.remainingLabel}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  Committed
                </Text>
                <Text as="p" variant="headingLg">
                  {blanket.committedLabel}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  Period
                </Text>
                <Text as="p" variant="headingMd">
                  {blanket.periodLabel}
                </Text>
              </BlockStack>
            </InlineGrid>
            <ProgressBar progress={blanket.progress} size="small" />
            <Text as="p" variant="bodySm" tone="subdued">
              {blanket.progress}% drawn down. Cancelled POs return their
              quantity and value.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Draw-down history
            </Text>
            {blanket.drawdowns.length === 0 ? (
              <Text as="p" tone="subdued">
                No purchase orders have drawn against this blanket yet.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "draw-down", plural: "draw-downs" }}
                itemCount={blanket.drawdowns.length}
                headings={[
                  { title: "PO" },
                  { title: "Qty" },
                  { title: "Value" },
                  { title: "Remaining after" },
                  { title: "Date" },
                  { title: "Status" },
                ]}
                selectable={false}
              >
                {blanket.drawdowns.map((row, index) => (
                  <IndexTable.Row id={row.id} key={row.id} position={index}>
                    <IndexTable.Cell>
                      <Button
                        variant="plain"
                        url={`/app/purchase-orders/${row.poId}`}
                      >
                        {row.poNumber}
                      </Button>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.qtyLabel}</IndexTable.Cell>
                    <IndexTable.Cell>{row.valueLabel}</IndexTable.Cell>
                    <IndexTable.Cell>{row.remainingAfterLabel}</IndexTable.Cell>
                    <IndexTable.Cell>{row.createdLabel}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={row.reversed ? "attention" : undefined}>
                        {row.reversed ? "Released" : "Drawn"}
                      </Badge>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="update_blanket" />
            <input type="hidden" name="title" value={title} />
            <input type="hidden" name="start_date" value={startDate} />
            <input type="hidden" name="end_date" value={endDate} />
            <input type="hidden" name="committed_qty" value={committedQty} />
            <input
              type="hidden"
              name="committed_value"
              value={committedValue}
            />
            <input type="hidden" name="notes" value={notes} />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Details
              </Text>
              <FormLayout>
                <TextField
                  label="Title"
                  value={title}
                  onChange={setTitle}
                  autoComplete="off"
                  disabled={closed}
                />
                <FormLayout.Group>
                  <TextField
                    label="Start date"
                    type="date"
                    value={startDate}
                    onChange={setStartDate}
                    autoComplete="off"
                    disabled={closed}
                  />
                  <TextField
                    label="End date"
                    type="date"
                    value={endDate}
                    onChange={setEndDate}
                    autoComplete="off"
                    disabled={closed}
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Committed quantity"
                    type="number"
                    min={0}
                    value={committedQty}
                    onChange={setCommittedQty}
                    autoComplete="off"
                    disabled={closed}
                  />
                  <TextField
                    label="Committed value"
                    type="number"
                    min={0}
                    step={0.01}
                    value={committedValue}
                    onChange={setCommittedValue}
                    autoComplete="off"
                    disabled={closed}
                  />
                </FormLayout.Group>
                <TextField
                  label="Notes"
                  value={notes}
                  onChange={setNotes}
                  autoComplete="off"
                  multiline={3}
                  disabled={closed}
                />
              </FormLayout>
              {!closed ? (
                <InlineStack align="end">
                  <Button
                    submit
                    variant="primary"
                    loading={busy && intent === "update_blanket"}
                  >
                    Save blanket
                  </Button>
                </InlineStack>
              ) : (
                <Text as="p" tone="subdued">
                  This blanket is closed. Remaining is frozen; history stays.
                </Text>
              )}
            </BlockStack>
          </Form>
        </Card>

        <InlineStack align="end" gap="200">
          {!closed ? (
            <Form method="post">
              <input type="hidden" name="intent" value="close_blanket" />
              <Button submit loading={busy && intent === "close_blanket"}>
                Close blanket
              </Button>
            </Form>
          ) : null}
          <Form method="post">
            <input type="hidden" name="intent" value="delete_blanket" />
            <Button
              submit
              tone="critical"
              loading={busy && intent === "delete_blanket"}
            >
              Delete
            </Button>
          </Form>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
