import { Form, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { isQboPushableStatus, type ThreeWayMatch } from "../lib/three-way-match";

export function ThreeWayMatchCard({
  poId,
  status,
  match,
  invoiceAmountRaw,
  qbPushedAt,
  qbBillUrl,
}: {
  poId: string;
  status: string;
  match: ThreeWayMatch;
  invoiceAmountRaw: number | null;
  qbPushedAt: string | null;
  qbBillUrl: string | null;
}) {
  const navigation = useNavigation();
  const [invoiceAmount, setInvoiceAmount] = useState(
    invoiceAmountRaw != null ? String(invoiceAmountRaw) : "",
  );

  const savingInvoice =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "submit_invoice";
  const statusReady = isQboPushableStatus(status);
  const canOpenPreview = match.hasInvoice && statusReady;

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          3-way match
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Compares PO total, confirmed received quantity, and the invoiced
          amount. Push to QuickBooks is previewed and confirmed separately —
          it stays blocked until the invoiced amount is recorded, and a
          discrepancy must be acknowledged.
        </Text>

        {match.ready && match.hasDiscrepancy ? (
          <Banner tone="warning" title="3-way discrepancy">
            <p>{match.summary}</p>
          </Banner>
        ) : null}

        {match.ready && !match.hasDiscrepancy ? (
          <Banner tone="success" title="3-way match">
            <p>{match.summary}</p>
          </Banner>
        ) : null}

        {!match.ready ? (
          <Text as="p" variant="bodySm">
            {match.summary}
          </Text>
        ) : null}

        <Form method="post">
          <input type="hidden" name="intent" value="submit_invoice" />
          <BlockStack gap="300">
            <TextField
              label="Invoiced amount"
              type="number"
              min={0}
              step={0.01}
              prefix="$"
              value={invoiceAmount}
              onChange={setInvoiceAmount}
              autoComplete="off"
              helpText="The amount on the supplier invoice, not the PO total."
            />
            <input type="hidden" name="invoice_amount" value={invoiceAmount} />
            <Button submit loading={savingInvoice}>
              {match.hasInvoice ? "Update invoiced amount" : "Record invoiced amount"}
            </Button>
          </BlockStack>
        </Form>

        <BlockStack gap="200">
          {qbPushedAt && qbBillUrl ? (
            <Button url={qbBillUrl} external>
              Open in QuickBooks
            </Button>
          ) : null}
          <Button
            variant="primary"
            url={`/app/purchase-orders/${poId}/quickbooks`}
            disabled={!canOpenPreview}
          >
            {qbPushedAt ? "Review QuickBooks sync" : "Push to QuickBooks"}
          </Button>
          {!match.hasInvoice ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Record an invoiced amount first.
            </Text>
          ) : null}
          {match.hasInvoice && !statusReady ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Push is available once the PO is received or closed.
            </Text>
          ) : null}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
