import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  InlineStack,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useMemo, useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  awardQuoteRequest,
  formatComparisonCost,
  getQuoteRequestDetail,
  sendQuoteRequest,
} from "../lib/quote-requests.server";
import { createServiceClient } from "../lib/supabase.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const detail = await getQuoteRequestDetail(
    merchant.workspace.id,
    params.id ?? "",
  );
  if (!detail) throw new Response("Not found", { status: 404 });

  const supabase = createServiceClient();
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, is_primary")
    .eq("workspace_id", merchant.workspace.id)
    .order("name");

  return {
    detail,
    workspaceName: merchant.workspace.name,
    locations: (locations ?? []).map((l) => ({
      id: l.id as string,
      name: l.name as string,
      isPrimary: Boolean(l.is_primary),
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = params.id ?? "";

  try {
    if (intent === "send") {
      const result = await sendQuoteRequest({
        workspaceId: merchant.workspace.id,
        quoteRequestId: id,
        workspaceName: merchant.workspace.name,
      });
      return { ok: true as const, sent: result, awarded: null };
    }
    if (intent === "award") {
      const raw = String(form.get("awards_json") ?? "{}");
      const awards = JSON.parse(raw) as Record<string, string>;
      const locationId = String(form.get("locationId") ?? "").trim() || null;
      const awarded = await awardQuoteRequest({
        workspaceId: merchant.workspace.id,
        quoteRequestId: id,
        awards,
        locationId,
      });
      return { ok: true as const, sent: null, awarded };
    }
    return { error: "Unknown action" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Action failed",
    };
  }
};

function statusTone(
  status: string,
): "success" | "attention" | "info" | "critical" | undefined {
  if (status === "awarded") return "success";
  if (status === "responded" || status === "partially_responded")
    return "attention";
  if (status === "cancelled") return "critical";
  return "info";
}

export default function QuoteRequestDetailPage() {
  const { detail, locations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const primaryLoc =
    locations.find((l) => l.isPrimary)?.id ?? locations[0]?.id ?? "";
  const [locationId, setLocationId] = useState(primaryLoc);

  // Default award picks: cheapest responder per line (quiet signal).
  const defaultAwards = useMemo(() => {
    const map: Record<string, string> = {};
    for (const line of detail.comparison) {
      const cheapest = line.cells.find((c) => c.isCheapest && c.hasResponse);
      if (cheapest) map[line.lineId] = cheapest.quoteRequestSupplierId;
      else if (line.awardedQuoteRequestSupplierId) {
        map[line.lineId] = line.awardedQuoteRequestSupplierId;
      }
    }
    return map;
  }, [detail.comparison]);

  const [awards, setAwards] = useState<Record<string, string>>(defaultAwards);

  const canAward =
    detail.status !== "awarded" &&
    detail.status !== "cancelled" &&
    detail.status !== "draft" &&
    detail.responses.length > 0;

  const supplierOptions = [
    { label: "— skip —", value: "" },
    ...detail.suppliers.map((s) => ({
      label: s.supplierName,
      value: s.id,
    })),
  ];

  const comparisonHeadings = [
    "Line",
    "Qty",
    ...detail.suppliers.map((s) => s.supplierName),
    "Award to",
  ];

  const comparisonRows = detail.comparison.map((line) => {
    const cells = detail.suppliers.map((s) => {
      const cell = line.cells.find((c) => c.quoteRequestSupplierId === s.id);
      if (!cell?.hasResponse) {
        return (
          <Text as="span" tone="subdued">
            —
          </Text>
        );
      }
      const costLabel = formatComparisonCost(cell.unitCost);
      const lead =
        cell.leadTimeDays != null ? `${cell.leadTimeDays}d` : null;
      return (
        <BlockStack gap="100">
          <InlineStack gap="100" blockAlign="center">
            <Text
              as="span"
              fontWeight={cell.isCheapest ? "semibold" : "regular"}
            >
              {costLabel}
            </Text>
            {cell.isCheapest ? (
              <Badge tone="success">Lowest</Badge>
            ) : null}
          </InlineStack>
          {lead ? (
            <Text as="span" tone="subdued" variant="bodySm">
              {lead} lead
            </Text>
          ) : null}
        </BlockStack>
      );
    });

    return [
      <BlockStack key={line.lineId} gap="100">
        <InlineStack gap="100" blockAlign="center">
          <Text as="span" fontWeight="semibold">
            {line.description}
          </Text>
          {!line.isFreeText ? (
            <Badge>Catalog</Badge>
          ) : null}
        </InlineStack>
        {line.sku ? (
          <Text as="span" tone="subdued" variant="bodySm">
            {line.sku}
          </Text>
        ) : null}
      </BlockStack>,
      String(line.qty),
      ...cells,
      canAward ? (
        <Select
          label="Award"
          labelHidden
          options={supplierOptions.filter((o) => {
            if (!o.value) return true;
            const cell = line.cells.find(
              (c) => c.quoteRequestSupplierId === o.value,
            );
            return Boolean(cell?.hasResponse);
          })}
          value={awards[line.lineId] ?? ""}
          onChange={(v) =>
            setAwards((prev) => ({ ...prev, [line.lineId]: v }))
          }
        />
      ) : (
        <Text as="span" tone="subdued">
          {detail.suppliers.find(
            (s) => s.id === line.awardedQuoteRequestSupplierId,
          )?.supplierName ?? "—"}
        </Text>
      ),
    ];
  });

  return (
    <Page
      title={detail.title}
      backAction={{ content: "Quote requests", url: "/app/quote-requests" }}
    >
      <TitleBar title={detail.title} />
      <BlockStack gap="400">
        <InlineStack gap="200">
          <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
          {detail.neededBy ? (
            <Text as="span" tone="subdued">
              Needed by {detail.neededBy}
            </Text>
          ) : null}
        </InlineStack>

        {actionData && "error" in actionData && actionData.error ? (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        {actionData && "sent" in actionData && actionData.sent ? (
          <Banner tone="success" title="Quote request sent">
            <p>
              Emailed {actionData.sent.emailed} supplier
              {actionData.sent.emailed === 1 ? "" : "s"}. Each has a no-login
              link (and Reply-To for plain-text pricing).
            </p>
          </Banner>
        ) : null}

        {actionData && "awarded" in actionData && actionData.awarded ? (
          <Banner tone="success" title="Awarded — draft POs created">
            <BlockStack gap="200">
              <p>
                Golden workflow starts at <Text as="span" fontWeight="semibold">draft</Text>{" "}
                — not confirmed. Review and send each PO normally.
              </p>
              {actionData.awarded.purchaseOrders.map((po) => (
                <InlineStack key={po.poId} gap="200">
                  <Text as="span">
                    {po.supplierName}: {po.lineCount} line
                    {po.lineCount === 1 ? "" : "s"} →
                  </Text>
                  <Link to={`/app/purchase-orders/${po.poId}`}>
                    {po.poNumber}
                  </Link>
                </InlineStack>
              ))}
            </BlockStack>
          </Banner>
        ) : null}

        {(detail.status === "draft" ||
          detail.status === "sent" ||
          detail.status === "partially_responded" ||
          detail.status === "responded") &&
        detail.status !== "awarded" ? (
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="send" />
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" tone="subdued">
                  {detail.suppliers.length} supplier
                  {detail.suppliers.length === 1 ? "" : "s"} invited. Link +
                  email reply both accepted.
                </Text>
                <Button submit variant="primary" loading={busy}>
                  {detail.status === "draft" ? "Send to suppliers" : "Resend"}
                </Button>
              </InlineStack>
            </Form>
          </Card>
        ) : null}

        {/* —— Comparison view (lines × suppliers, cheapest quiet signal) —— */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Comparison
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Lines as rows, suppliers as columns. Lowest unit cost per line is
              marked quietly (same pattern as Supplier Catalog — cheapest
              first/emphasized, not a loud promo).
            </Text>
            {detail.responses.length === 0 ? (
              <Text as="p" tone="subdued">
                No responses yet. Send the request, then compare here.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  ...detail.suppliers.map(() => "text" as const),
                  "text",
                ]}
                headings={comparisonHeadings}
                rows={comparisonRows}
              />
            )}
          </BlockStack>
        </Card>

        {/* —— Award → draft PO (split by line across suppliers) —— */}
        {canAward ? (
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="award" />
              <input
                type="hidden"
                name="awards_json"
                value={JSON.stringify(awards)}
              />
              <input type="hidden" name="locationId" value={locationId} />
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Award → draft POs
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Split awards across suppliers by line. Each supplier with at
                  least one awarded line gets a separate{" "}
                  <Text as="span" fontWeight="semibold">draft</Text> PO at the
                  quoted unit cost — then the normal send → confirm → receive
                  workflow. Nothing is auto-confirmed.
                </Text>
                {locations.length ? (
                  <Select
                    label="Ship-to location for draft POs"
                    options={locations.map((l) => ({
                      label: l.name,
                      value: l.id,
                    }))}
                    value={locationId}
                    onChange={setLocationId}
                  />
                ) : null}
                <InlineStack gap="200">
                  <Button
                    onClick={() => setAwards(defaultAwards)}
                    disabled={busy}
                  >
                    Prefer lowest per line
                  </Button>
                  <Button
                    submit
                    variant="primary"
                    tone="success"
                    loading={busy}
                  >
                    Create draft POs from awards
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        ) : null}

        {detail.status === "awarded" ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">
                Awarded purchase orders
              </Text>
              {detail.suppliers
                .filter((s) => s.purchaseOrderId)
                .map((s) => (
                  <Link
                    key={s.id}
                    to={`/app/purchase-orders/${s.purchaseOrderId}`}
                  >
                    {s.supplierName} — open draft PO
                  </Link>
                ))}
            </BlockStack>
          </Card>
        ) : null}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingSm">
              Supplier links
            </Text>
            {detail.suppliers.map((s) => (
              <Box key={s.id} paddingBlock="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" fontWeight="semibold">
                    {s.supplierName}
                  </Text>
                  <Badge>{s.status}</Badge>
                  <Text as="span" tone="subdued" variant="bodySm">
                    {s.linkUrl}
                  </Text>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
