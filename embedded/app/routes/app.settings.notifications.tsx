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
  Box,
  Button,
  Card,
  Checkbox,
  FormLayout,
  IndexTable,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  loadNotificationSettings,
  updateNotificationRule,
} from "../lib/notifications.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const settings = await loadNotificationSettings(merchant.workspace.id);
  return { workspaceName: merchant.workspace.name, settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const ruleId = String(formData.get("rule_id") ?? "");
  try {
    await updateNotificationRule(merchant.workspace.id, ruleId, formData);
    return { ok: true, error: null as string | null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save rule",
    };
  }
};

function RuleCard({
  rule,
}: {
  rule: {
    id: string;
    title: string;
    description: string;
    thresholdLabel?: string;
    enabled: boolean;
    thresholdValue: string;
  };
}) {
  const navigation = useNavigation();
  const [enabled, setEnabled] = useState(rule.enabled);
  const [threshold, setThreshold] = useState(rule.thresholdValue);
  const saving =
    navigation.state !== "idle" &&
    navigation.formData?.get("rule_id") === rule.id;

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="rule_id" value={rule.id} />
        <input type="hidden" name="enabled" value={enabled ? "true" : "false"} />
        <input type="hidden" name="threshold_value" value={threshold} />
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {rule.title}
          </Text>
          <Text as="p" tone="subdued" variant="bodyMd">
            {rule.description}
          </Text>
          <Checkbox
            label="Enabled"
            checked={enabled}
            onChange={setEnabled}
          />
          {rule.thresholdLabel ? (
            <FormLayout>
              <TextField
                label={rule.thresholdLabel}
                type="number"
                value={threshold}
                onChange={setThreshold}
                autoComplete="off"
              />
            </FormLayout>
          ) : null}
          <Button submit loading={saving}>
            Save
          </Button>
        </BlockStack>
      </Form>
    </Card>
  );
}

export default function NotificationsSettings() {
  const { workspaceName, settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page title="Notifications" subtitle={workspaceName}>
      <TitleBar title="Notifications" />
      <BlockStack gap="500">
        {actionData?.error ? (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        ) : actionData?.ok ? (
          <Banner tone="success">
            <p>Rule saved.</p>
          </Banner>
        ) : null}

        <Layout>
          {settings.rules.map((rule) => (
            <Layout.Section key={rule.id} variant="oneHalf">
              <RuleCard rule={rule} />
            </Layout.Section>
          ))}
        </Layout>

        <Card padding="0">
          <BlockStack gap="300">
            <Box paddingInline="400" paddingBlockStart="400">
              <Text as="h2" variant="headingMd">
                Recent sends
              </Text>
            </Box>
            {settings.log.length === 0 ? (
              <Box padding="400">
                <Text as="p" tone="subdued" variant="bodyMd">
                  No notification emails logged yet. Cron still runs from the
                  Next.js / Edge side.
                </Text>
              </Box>
            ) : (
              <IndexTable
                resourceName={{ singular: "send", plural: "sends" }}
                itemCount={settings.log.length}
                headings={[
                  { title: "Rule" },
                  { title: "PO" },
                  { title: "Recipient" },
                  { title: "When" },
                ]}
                selectable={false}
              >
                {settings.log.map((row, index) => (
                  <IndexTable.Row id={row.id} key={row.id} position={index}>
                    <IndexTable.Cell>{row.ruleTitle}</IndexTable.Cell>
                    <IndexTable.Cell>{row.poNumber}</IndexTable.Cell>
                    <IndexTable.Cell>{row.recipient}</IndexTable.Cell>
                    <IndexTable.Cell>{row.sentAt}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
