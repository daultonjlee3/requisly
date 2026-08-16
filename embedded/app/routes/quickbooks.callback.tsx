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
  exchangeAuthorizationCode,
  fetchQboCompanyName,
  readConnectState,
  saveQboConnection,
  shopifyAdminEmbeddedUrl,
} from "../lib/quickbooks.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const errorParam = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  if (errorParam) {
    return {
      polarisTranslations,
      error: errorDescription || errorParam,
    };
  }

  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  if (!code || !realmId || !state) {
    return {
      polarisTranslations,
      error: "QuickBooks did not return an authorization code. Start Connect again from Settings.",
    };
  }

  try {
    const payload = readConnectState(state);
    const tokens = await exchangeAuthorizationCode(code);
    await saveQboConnection({
      workspaceId: payload.workspaceId,
      realmId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      refreshExpiresIn: tokens.x_refresh_token_expires_in,
    });
    const companyName = await fetchQboCompanyName(payload.workspaceId, realmId);
    if (companyName) {
      await saveQboConnection({
        workspaceId: payload.workspaceId,
        realmId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        refreshExpiresIn: tokens.x_refresh_token_expires_in,
        companyName,
      });
    }
    throw redirect(
      shopifyAdminEmbeddedUrl(payload.shop, "/app/settings/quickbooks?connected=1"),
    );
  } catch (err) {
    if (err instanceof Response) throw err;
    return {
      polarisTranslations,
      error:
        err instanceof Error
          ? err.message
          : "QuickBooks authorization failed. Start Connect again from Settings.",
    };
  }
};

export default function QuickBooksCallback() {
  const data = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider i18n={data.polarisTranslations ?? polarisTranslations}>
      <Page title="QuickBooks">
        <Card>
          <BlockStack gap="300">
            <Banner tone="critical" title="Could not connect QuickBooks">
              <p>{data.error}</p>
            </Banner>
            <Text as="p" variant="bodySm" tone="subdued">
              Open Requisly in Shopify Admin → Settings → QuickBooks and try
              Connect again.
            </Text>
          </BlockStack>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
