import { Form, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  FormLayout,
  Icon,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { DeliveryIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import type { PoShipment } from "../lib/shipments.server";

type LineOption = {
  id: string;
  description: string;
  qtyRaw: number;
};

type Props = {
  shipments: PoShipment[];
  lineItems: LineOption[];
  canAdd: boolean;
};

export function PoShipmentsCard({ shipments, lineItems, canAdd }: Props) {
  const navigation = useNavigation();
  const busy =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "add_shipment";

  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("UPS");
  const [eta, setEta] = useState("");
  const [note, setNote] = useState("");
  const [lineQtys, setLineQtys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const line of lineItems) init[line.id] = "";
    return init;
  });

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="start" wrap={false}>
            <Icon source={DeliveryIcon} tone="base" />
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Shipments
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Partial shipments each keep their own tracking, carrier, and
                ETA.
              </Text>
            </BlockStack>
          </InlineStack>
          {canAdd && !open ? (
            <Button onClick={() => setOpen(true)}>Add shipment</Button>
          ) : null}
        </InlineStack>

        {shipments.length === 0 ? (
          <Text as="p" tone="subdued">
            No shipments logged yet.
          </Text>
        ) : (
          <BlockStack gap="300">
            {shipments.map((shipment, index) => (
              <Card key={shipment.id} background="bg-surface-secondary">
                <BlockStack gap="200">
                  <InlineStack align="space-between" wrap>
                    <Text as="p" fontWeight="semibold">
                      Shipment {shipments.length - index}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {shipment.shippedAtLabel} · {shipment.createdBy}
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm">
                    {shipment.carrier || "Carrier —"}
                    {shipment.trackingNumber
                      ? ` · ${shipment.trackingNumber}`
                      : " · No tracking"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    ETA {shipment.estimatedArrivalDate}
                  </Text>
                  {shipment.note ? (
                    <Text as="p" variant="bodySm">
                      {shipment.note}
                    </Text>
                  ) : null}
                  {shipment.lines.length > 0 ? (
                    <BlockStack gap="100">
                      {shipment.lines.map((line) => (
                        <Text as="p" variant="bodySm" key={line.poLineItemId}>
                          {line.description} × {line.qty}
                        </Text>
                      ))}
                    </BlockStack>
                  ) : (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Full order / no line allocation
                    </Text>
                  )}
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        )}

        {open && canAdd ? (
          <Card background="bg-surface-secondary">
            <Form method="post">
              <input type="hidden" name="intent" value="add_shipment" />
              <input type="hidden" name="tracking_number" value={tracking} />
              <input type="hidden" name="carrier" value={carrier} />
              <input type="hidden" name="estimated_arrival_date" value={eta} />
              <input type="hidden" name="note" value={note} />
              <input
                type="hidden"
                name="lines_json"
                value={JSON.stringify(
                  Object.entries(lineQtys)
                    .filter(([, qty]) => Number(qty) > 0)
                    .map(([poLineItemId, qty]) => ({
                      poLineItemId,
                      qty: Number(qty),
                    })),
                )}
              />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  New shipment
                </Text>
                <FormLayout>
                  <TextField
                    label="Tracking number"
                    value={tracking}
                    onChange={setTracking}
                    autoComplete="off"
                  />
                  <Select
                    label="Carrier"
                    options={[
                      "UPS",
                      "FedEx",
                      "USPS",
                      "Freight / LTL",
                      "Other",
                    ].map((c) => ({ label: c, value: c }))}
                    value={carrier}
                    onChange={setCarrier}
                  />
                  <TextField
                    label="Estimated arrival"
                    type="date"
                    value={eta}
                    onChange={setEta}
                    autoComplete="off"
                  />
                  <TextField
                    label="Note"
                    value={note}
                    onChange={setNote}
                    autoComplete="off"
                    multiline={2}
                  />
                </FormLayout>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    Line quantities in this shipment (optional)
                  </Text>
                  {lineItems.map((line) => (
                    <TextField
                      key={line.id}
                      label={`${line.description} (ordered ${line.qtyRaw})`}
                      type="number"
                      min={0}
                      value={lineQtys[line.id] ?? ""}
                      onChange={(value) =>
                        setLineQtys((prev) => ({ ...prev, [line.id]: value }))
                      }
                      autoComplete="off"
                    />
                  ))}
                </BlockStack>
                <InlineStack gap="200" align="end">
                  <Button onClick={() => setOpen(false)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button submit variant="primary" loading={busy}>
                    Save shipment
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        ) : null}
      </BlockStack>
    </Card>
  );
}
