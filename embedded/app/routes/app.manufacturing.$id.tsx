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
  completeManufacturingOrder,
  getManufacturingOrder,
  previewBomRequirements,
  startManufacturingOrder,
  type CompleteMoResult,
} from "../lib/manufacturing.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const moId = String(params.id ?? "");
  const mo = await getManufacturingOrder(merchant.workspace.id, moId);
  if (!mo) throw new Response("Not found", { status: 404 });

  let requirements: Awaited<ReturnType<typeof previewBomRequirements>> = [];
  let previewError: string | null = null;
  if (mo.status !== "completed" && mo.status !== "cancelled") {
    try {
      requirements = await previewBomRequirements({
        workspaceId: merchant.workspace.id,
        productVariantId: mo.productVariantId,
        locationId: mo.locationId,
        qtyToMake: mo.qtyToMake,
      });
    } catch (err) {
      previewError = err instanceof Error ? err.message : "Preview failed";
    }
  }

  return { mo, requirements, previewError };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const moId = String(params.id ?? "");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "start") {
      await startManufacturingOrder(merchant.workspace.id, moId);
      return { ok: true as const };
    }
    if (intent === "complete") {
      const result = await completeManufacturingOrder(
        merchant.workspace.id,
        moId,
      );
      return { ok: true as const, complete: result };
    }
    return { error: "Unknown action" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Action failed",
    };
  }
};

export default function ManufacturingOrderDetailPage() {
  const { mo, requirements, previewError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const completeResult =
    actionData && "complete" in actionData
      ? (actionData.complete as CompleteMoResult | undefined)
      : undefined;

  const canComplete =
    mo.status === "draft" || mo.status === "in_progress";
  const blocked = requirements.some((r) => r.shortfall > 0);

  return (
    <Page
      title={mo.finishedTitle}
      subtitle={`Make ${mo.qtyToMake} · ${mo.locationName}`}
      backAction={{ content: "Manufacturing", url: "/app/manufacturing" }}
    >
      <TitleBar title="Manufacturing order" />
      <BlockStack gap="400">
        <InlineStack gap="200">
          <Badge
            tone={
              mo.status === "completed"
                ? "success"
                : mo.status === "in_progress"
                  ? "attention"
                  : "info"
            }
          >
            {mo.status}
          </Badge>
          <Badge>{mo.mode === "make_to_stock" ? "Make-to-stock" : "MTO"}</Badge>
          {mo.linkedOrderName ? (
            <Badge tone="info">Sales order {mo.linkedOrderName}</Badge>
          ) : null}
        </InlineStack>

        {mo.mode === "make_to_order" && mo.linkedOrderName ? (
          <Banner tone="info" title="Make-to-order">
            <p>
              Linked to sales order {mo.linkedOrderName}. Draft was created from
              a merchant-accepted suggestion — Requisly never auto-creates MOs.
            </p>
          </Banner>
        ) : null}

        {actionData && "error" in actionData && actionData.error ? (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
            <p>
              Inventory was <Text as="span" fontWeight="semibold">not</Text>{" "}
              changed — completion runs in a single database transaction and
              rolls back on any error.
            </p>
          </Banner>
        ) : null}

        {completeResult ? (
          <Banner tone="success" title="MO completed atomically">
            <p>
              Finished +{completeResult.finished.qty_added} (
              {completeResult.finished.on_hand_before} →{" "}
              {completeResult.finished.on_hand_after}). Deducted{" "}
              {completeResult.deductions.length} leaf ingredient line(s) in the
              same transaction.
            </p>
          </Banner>
        ) : null}

        {previewError ? (
          <Banner tone="warning" title="Could not preview requirements">
            <p>{previewError}</p>
          </Banner>
        ) : null}

        {canComplete && blocked ? (
          <Banner tone="warning" title="Insufficient ingredient stock">
            <p>
              Complete is blocked in the UI when any leaf ingredient is short.
              The RPC also refuses and rolls back if stock is insufficient.
            </p>
          </Banner>
        ) : null}

        {canComplete ? (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">
                Leaf ingredient requirements
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Exploded recursively through subassemblies. Completing deducts
                these quantities and adds finished goods in one Postgres
                transaction (`complete_manufacturing_order`).
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                headings={["Ingredient", "Required", "On hand", "Shortfall"]}
                rows={requirements.map((r) => [
                  r.sku ? `${r.title} (${r.sku})` : r.title,
                  String(Math.ceil(r.qtyRequired)),
                  String(r.onHand),
                  r.shortfall > 0 ? String(r.shortfall) : "—",
                ])}
              />
              <InlineStack gap="200">
                {mo.status === "draft" ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="start" />
                    <Button submit loading={busy}>
                      Mark in progress
                    </Button>
                  </Form>
                ) : null}
                <Form method="post">
                  <input type="hidden" name="intent" value="complete" />
                  <Button
                    submit
                    variant="primary"
                    tone="success"
                    loading={busy}
                    disabled={blocked || requirements.length === 0}
                  >
                    Complete manufacturing order
                  </Button>
                </Form>
              </InlineStack>
            </BlockStack>
          </Card>
        ) : (
          <Card>
            <Text as="p" tone="subdued">
              {mo.status === "completed"
                ? `Completed ${mo.completedAt ? new Date(mo.completedAt).toLocaleString() : ""}.`
                : `Status: ${mo.status}`}
            </Text>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
