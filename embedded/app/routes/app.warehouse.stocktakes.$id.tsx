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
  IndexTable,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  completeStocktake,
  getStocktake,
  updateStocktakeCounts,
} from "../lib/warehouse.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const stocktake = await getStocktake(
    merchant.workspace.id,
    String(params.id ?? ""),
  );
  if (!stocktake) throw new Response("Not found", { status: 404 });
  return { stocktake };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const id = String(params.id ?? "");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "save_counts") {
      let counts: Array<{ lineId: string; countedQty: number }> = [];
      try {
        counts = JSON.parse(String(form.get("counts_json") ?? "[]"));
      } catch {
        return { error: "Invalid counts payload" };
      }
      await updateStocktakeCounts(merchant.workspace.id, id, counts);
      return { ok: true as const, saved: true };
    }
    if (intent === "complete") {
      let counts: Array<{ lineId: string; countedQty: number }> = [];
      try {
        counts = JSON.parse(String(form.get("counts_json") ?? "[]"));
      } catch {
        counts = [];
      }
      if (counts.length) {
        await updateStocktakeCounts(merchant.workspace.id, id, counts);
      }
      const result = await completeStocktake(merchant.workspace.id, id);
      return { ok: true as const, result };
    }
    return { error: "Unknown action" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
};

export default function StocktakeDetailPage() {
  const { stocktake } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const [counts, setCounts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const line of stocktake.lines) {
      init[line.id] =
        line.countedQty != null
          ? String(line.countedQty)
          : String(line.expectedQty);
    }
    return init;
  });

  const countsJson = JSON.stringify(
    Object.entries(counts).map(([lineId, countedQty]) => ({
      lineId,
      countedQty: Number(countedQty),
    })),
  );

  const variancePreview = stocktake.lines.map((line) => {
    const counted = Number(counts[line.id] ?? line.expectedQty);
    return {
      ...line,
      counted,
      variance: counted - line.expectedQty,
    };
  });
  const flagged = variancePreview.filter((l) => l.variance !== 0).length;

  return (
    <Page
      title={`Stocktake — ${stocktake.locationName}`}
      backAction={{ content: "Warehouse", url: "/app/warehouse" }}
    >
      <TitleBar title="Stocktake" />
      <BlockStack gap="400">
        <InlineStack gap="200">
          <Badge
            tone={stocktake.status === "completed" ? "success" : "attention"}
          >
            {stocktake.status}
          </Badge>
          {stocktake.status === "in_progress" ? (
            <Badge tone={flagged ? "warning" : "success"}>
              {flagged
                ? `${flagged} variance(s) flagged`
                : "No variances yet"}
            </Badge>
          ) : null}
        </InlineStack>

        {actionData && "error" in actionData && actionData.error ? (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        {actionData && "ok" in actionData && actionData.ok && "result" in actionData ? (
          <Banner tone="success" title="Stocktake completed">
            <p>
              On-hand quantities were set to counted values in one transaction.
            </p>
          </Banner>
        ) : null}

        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "SKU", plural: "SKUs" }}
            itemCount={variancePreview.length}
            headings={[
              { title: "Product" },
              { title: "Expected" },
              { title: "Counted" },
              { title: "Variance" },
            ]}
            selectable={false}
          >
            {variancePreview.map((line, index) => (
              <IndexTable.Row id={line.id} key={line.id} position={index}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="semibold">
                    {line.title}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>{line.expectedQty}</IndexTable.Cell>
                <IndexTable.Cell>
                  {stocktake.status === "in_progress" ? (
                    <TextField
                      label="Counted"
                      labelHidden
                      type="number"
                      value={counts[line.id] ?? ""}
                      onChange={(val) =>
                        setCounts((prev) => ({ ...prev, [line.id]: val }))
                      }
                      autoComplete="off"
                      min={0}
                    />
                  ) : (
                    line.countedQty ?? "—"
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {line.variance === 0 ? (
                    "—"
                  ) : (
                    <Text
                      as="span"
                      tone={line.variance < 0 ? "critical" : "success"}
                    >
                      {line.variance > 0 ? `+${line.variance}` : line.variance}
                    </Text>
                  )}
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>

        {stocktake.status === "in_progress" ? (
          <InlineStack gap="200">
            <Form method="post">
              <input type="hidden" name="intent" value="save_counts" />
              <input type="hidden" name="counts_json" value={countsJson} />
              <Button submit loading={busy}>
                Save counts
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="complete" />
              <input type="hidden" name="counts_json" value={countsJson} />
              <Button submit variant="primary" tone="success" loading={busy}>
                Complete stocktake
              </Button>
            </Form>
          </InlineStack>
        ) : (
          <Text as="p" tone="subdued">
            Completed{" "}
            {stocktake.completedAt
              ? new Date(stocktake.completedAt).toLocaleString()
              : ""}
            .
          </Text>
        )}
      </BlockStack>
    </Page>
  );
}
