import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useEffect } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  buildConnectAuthorizeUrl,
  getQboAppConfig,
} from "../lib/quickbooks.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const config = getQboAppConfig();
  if (!config.configured) {
    return {
      authorizeUrl: null as string | null,
      error: `QuickBooks is not configured (missing ${config.missing.join(", ")}).`,
    };
  }
  const authorizeUrl = buildConnectAuthorizeUrl({
    workspaceId: merchant.workspace.id,
    shop: merchant.shopDomain,
  });
  return { authorizeUrl, error: null as string | null };
};

export default function QuickBooksConnect() {
  const { authorizeUrl, error } = useLoaderData<typeof loader>();

  useEffect(() => {
    if (!authorizeUrl || typeof window === "undefined") return;
    const top = window.top ?? window;
    top.location.href = authorizeUrl;
  }, [authorizeUrl]);

  return (
    <Page
      title="Connect QuickBooks"
      backAction={{ content: "QuickBooks", url: "/app/settings/quickbooks" }}
    >
      <TitleBar title="Connect QuickBooks" />
      <Card>
        <BlockStack gap="300">
          {error ? (
            <Banner tone="critical">
              <p>{error}</p>
            </Banner>
          ) : (
            <>
              <Text as="p" variant="bodyMd">
                Redirecting to Intuit to authorize QuickBooks Online…
              </Text>
              {authorizeUrl ? (
                <Button url={authorizeUrl} variant="primary" external>
                  Continue to QuickBooks
                </Button>
              ) : null}
            </>
          )}
        </BlockStack>
      </Card>
    </Page>
  );
}
