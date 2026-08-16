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
  Select,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  QboReconnectNeededError,
  disconnectQbo,
  getQboAppConfig,
  getQboConnection,
  getQboSettings,
  listQboExpenseAccounts,
  saveQboSettings,
} from "../lib/quickbooks.server";
import type { QboMappingMode } from "../lib/quickbooks-map";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const config = getQboAppConfig();
  const [connection, settings] = await Promise.all([
    getQboConnection(merchant.workspace.id),
    getQboSettings(merchant.workspace.id),
  ]);
  let accounts: Array<{ id: string; name: string }> = [];
  let catalogError: string | null = null;
  if (config.configured && connection.connected && !connection.reconnectNeeded) {
    try {
      accounts = await listQboExpenseAccounts(merchant.workspace.id);
    } catch (err) {
      catalogError =
        err instanceof QboReconnectNeededError || err instanceof Error
          ? err.message
          : "Could not load QuickBooks accounts.";
    }
  }
  return {
    workspaceName: merchant.workspace.name,
    config: {
      configured: config.configured,
      missing: config.missing,
      env: config.env,
      redirectUri: config.redirectUri,
    },
    connection,
    settings,
    accounts,
    catalogError,
    connectedQuery: new URL(request.url).searchParams.get("connected") === "1",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "disconnect") {
      await disconnectQbo(merchant.workspace.id);
      return { ok: true, error: null as string | null };
    }
    if (intent === "save_settings") {
      const mappingMode = String(form.get("mapping_mode") ?? "account") as QboMappingMode;
      const accountId = String(form.get("default_account_id") ?? "");
      const accountName = String(form.get("default_account_name") ?? "");
      await saveQboSettings(merchant.workspace.id, {
        mappingMode,
        defaultExpenseAccountId: accountId || null,
        defaultExpenseAccountName: accountName || null,
      });
      return { ok: true, error: null as string | null };
    }
    return { ok: false, error: "Unknown action" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save QuickBooks settings",
    };
  }
};

export default function QuickBooksSettingsPage() {
  const {
    workspaceName,
    config,
    connection,
    settings,
    accounts,
    catalogError,
    connectedQuery,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "save_settings";
  const disconnecting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "disconnect";
  const [mappingMode, setMappingMode] = useState<QboMappingMode>(
    settings.mappingMode,
  );
  const [accountId, setAccountId] = useState(
    settings.defaultExpenseAccountId ?? "",
  );

  const accountName =
    accounts.find((row) => row.id === accountId)?.name ??
    settings.defaultExpenseAccountName ??
    "";

  return (
    <Page title="QuickBooks" subtitle={workspaceName}>
      <TitleBar title="QuickBooks" />
      <BlockStack gap="400">
        {actionData?.error ? (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}
        {actionData?.ok ? (
          <Banner tone="success" title="Saved">
            <p>QuickBooks settings updated.</p>
          </Banner>
        ) : null}
        {connectedQuery ? (
          <Banner tone="success" title="Connected">
            <p>
              QuickBooks Online is connected
              {connection.companyName ? ` as ${connection.companyName}` : ""}.
            </p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Connection
            </Text>
            {!config.configured ? (
              <Banner tone="warning" title="App credentials missing">
                <p>
                  Set {config.missing.join(", ")} on the embedded app, then
                  reload this page.
                </p>
              </Banner>
            ) : null}
            {connection.reconnectNeeded ? (
              <Banner tone="warning" title="Reconnect needed">
                <p>
                  {connection.lastError ??
                    "The QuickBooks connection expired or was revoked. Re-authorize to keep pushing bills."}
                </p>
              </Banner>
            ) : null}
            {connection.connected && !connection.reconnectNeeded ? (
              <Text as="p" variant="bodyMd">
                Connected
                {connection.companyName ? ` to ${connection.companyName}` : ""}
                {connection.realmId ? ` · realm ${connection.realmId}` : ""}
                {config.env === "sandbox" ? " · sandbox" : ""}.
              </Text>
            ) : (
              <Text as="p" variant="bodyMd" tone="subdued">
                Not connected. Authorize Requisly to create bills after a 3-way
                match.
              </Text>
            )}
            <BlockStack gap="200">
              {config.configured ? (
                <Button
                  url="/app/quickbooks/connect"
                  variant="primary"
                  disabled={!config.configured}
                >
                  {connection.reconnectNeeded
                    ? "Reconnect QuickBooks"
                    : connection.connected
                      ? "Reconnect QuickBooks"
                      : "Connect QuickBooks"}
                </Button>
              ) : null}
              {connection.connected ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="disconnect" />
                  <Button submit tone="critical" loading={disconnecting}>
                    Disconnect
                  </Button>
                </Form>
              ) : null}
            </BlockStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Redirect URI (must match the Intuit dashboard exactly):{" "}
              {config.redirectUri}
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save_settings" />
            <input type="hidden" name="mapping_mode" value={mappingMode} />
            <input type="hidden" name="default_account_id" value={accountId} />
            <input type="hidden" name="default_account_name" value={accountName} />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Line mapping default
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Workspace-level, not per-supplier: this is a file-wide
                accounting choice. Preview can still mix Item and Account on
                one bill. Free-text lines always use the default account.
              </Text>
              {catalogError ? (
                <Banner tone="critical">
                  <p>{catalogError}</p>
                </Banner>
              ) : null}
              <ChoiceList
                title="Default for catalog products"
                choices={[
                  {
                    label: "Account-level (recommended to start)",
                    value: "account",
                    helpText:
                      "Zero extra setup. Posts to one expense/COGS account so QuickBooks does not calculate its own COGS.",
                  },
                  {
                    label: "Item-level",
                    value: "item",
                    helpText:
                      "Confirm or create a QuickBooks item per product. Remembered after the first push. QuickBooks may then calculate COGS independently — Requisly will not reconcile that number.",
                  },
                ]}
                selected={[mappingMode]}
                onChange={(selected) =>
                  setMappingMode((selected[0] as QboMappingMode) ?? "account")
                }
              />
              <Select
                label="Default expense / COGS account"
                options={[
                  { label: "Select an account", value: "" },
                  ...accounts.map((row) => ({
                    label: row.name,
                    value: row.id,
                  })),
                ]}
                value={accountId}
                onChange={setAccountId}
                disabled={!accounts.length}
                helpText={
                  accounts.length
                    ? undefined
                    : "Connect QuickBooks to load accounts."
                }
              />
              <Button submit variant="primary" loading={saving}>
                Save mapping defaults
              </Button>
            </BlockStack>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}
