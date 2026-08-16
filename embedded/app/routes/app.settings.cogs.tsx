import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  ChoiceList,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { cogsFeatureLabel, type CogsMethod } from "../lib/cogs";
import { getCogsSettings, setCogsMethod } from "../lib/cogs.server";
import { getMerchantContext } from "../lib/merchant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const settings = await getCogsSettings(merchant.workspace.id);
  return {
    workspaceName: merchant.workspace.name,
    method: settings.method,
    featureLabel: cogsFeatureLabel(settings.method),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const method = String(form.get("method") ?? "") as CogsMethod;
  try {
    const saved = await setCogsMethod(merchant.workspace.id, method);
    return {
      ok: true as const,
      method: saved.method,
      error: null as string | null,
    };
  } catch (err) {
    return {
      ok: false as const,
      method: null,
      error: err instanceof Error ? err.message : "Failed to save",
    };
  }
};

export default function CogsSettingsPage() {
  const { workspaceName, method: initialMethod, featureLabel } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";
  const [method, setMethod] = useState<CogsMethod>(
    (actionData && actionData.ok && actionData.method
      ? actionData.method
      : initialMethod) as CogsMethod,
  );

  return (
    <Page title="COGS costing" subtitle={workspaceName}>
      <TitleBar title="COGS costing" />
      <BlockStack gap="400">
        {actionData?.error ? (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}
        {actionData?.ok ? (
          <Banner tone="success" title="Saved">
            <p>{cogsFeatureLabel(actionData.method ?? method)}</p>
          </Banner>
        ) : null}

        <Banner tone="info" title={featureLabel}>
          <p>
            This is Requisly&apos;s calculation from your real purchase price
            history and receipts — not an automatic QuickBooks reconcile.
          </p>
        </Banner>

        <Card>
          <Form method="post">
            <input type="hidden" name="method" value={method} />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Costing method
              </Text>
              <ChoiceList
                title="How should Requisly calculate unit cost for COGS?"
                choices={[
                  {
                    label: "Weighted Average (default)",
                    value: "weighted_average",
                    helpText:
                      "Averages supplier price-schedule costs (including landed components) that were in effect during the period.",
                  },
                  {
                    label: "FIFO",
                    value: "fifo",
                    helpText:
                      "Consumes receipt cost layers in chronological order (qty × price × date). Remaining quantity is tracked per layer as sales and manufacturing consume stock.",
                  },
                ]}
                selected={[method]}
                onChange={(selected) =>
                  setMethod((selected[0] as CogsMethod) ?? "weighted_average")
                }
              />
              <Text as="p" tone="subdued" variant="bodySm">
                Choose the method that matches your QuickBooks setup for the
                closest match between the two systems. QBO&apos;s native
                inventory typically uses FIFO; QuickBooks Desktop typically
                defaults to average cost — Requisly can&apos;t know or control
                which your file actually uses. Even with matching methods,
                small variances from timing, rounding, or mapping are still
                possible.
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Out of scope: specific identification / lot-level exact costing
                (no lot-tracking infrastructure yet).
              </Text>
              <Button submit variant="primary" loading={saving}>
                Save costing method
              </Button>
            </BlockStack>
          </Form>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              QuickBooks push
            </Text>
            <Text as="p" tone="subdued">
              Requisly does not reconcile with QuickBooks&apos; own COGS.
              Different valuation methods (FIFO vs weighted average) mean the
              numbers may legitimately differ. Account-level mapping avoids
              QuickBooks calculating COGS at all; item-level mapping can still
              let QuickBooks compute independently.
            </Text>
            <Button url="/app/settings/quickbooks">
              Open QuickBooks settings
            </Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
