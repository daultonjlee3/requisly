import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Banner,
  BlockStack,
  Card,
  Page,
  Text,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import {
  findWorkspaceByRealmId,
  shopifyAdminEmbeddedUrl,
} from "../lib/quickbooks.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const realmId = url.searchParams.get("realmId") ?? url.searchParams.get("realm_id");
  if (realmId) {
    const found = await findWorkspaceByRealmId(realmId);
    if (found?.shopDomain) {
      throw redirect(
        shopifyAdminEmbeddedUrl(
          found.shopDomain,
          "/app/quickbooks/connect",
        ),
      );
    }
  }
  return { polarisTranslations };
};

export default function QuickBooksReconnect() {
  const { polarisTranslations: i18n } = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider i18n={i18n}>
      <Page title="Reconnect QuickBooks">
        <Card>
          <BlockStack gap="300">
            <Banner tone="warning" title="Reconnect needed">
              <p>
                The QuickBooks connection for Requisly expired or was revoked.
                Re-authorize from inside Shopify Admin.
              </p>
            </Banner>
            <Text as="p" variant="bodyMd">
              Open Shopify Admin → Apps → Requisly → Settings → QuickBooks →
              Reconnect QuickBooks.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Intuit sends merchants here when a reconnect is required. The
              one-click re-auth lives in the embedded app because QuickBooks
              OAuth must start from a signed Shopify session.
            </Text>
          </BlockStack>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
