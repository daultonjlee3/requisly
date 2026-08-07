import type { LoaderFunctionArgs } from "@remix-run/node";
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

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

/**
 * Manual shop-domain login is removed for App Store compliance.
 * Installation must start from Shopify-owned surfaces only.
 * This route remains as a safe landing if OAuth redirects here without shop.
 */
export const loader = async (_args: LoaderFunctionArgs) => {
  return { polarisTranslations };
};

export default function Auth() {
  const { polarisTranslations } = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">
              Open Requisly from Shopify Admin
            </Text>
            <Banner tone="warning" title="No manual shop entry">
              <p>
                For security and App Store requirements, Requisly does not
                accept a typed myshopify.com domain. Install or reopen the app
                from the Shopify App Store listing or your Shopify Admin → Apps
                menu.
              </p>
            </Banner>
            <Text as="p" tone="subdued">
              If you reached this page during development, use{" "}
              <Text as="span" fontWeight="semibold">
                shopify app dev
              </Text>{" "}
              Preview URL, which includes the shop parameter from Shopify.
            </Text>
          </BlockStack>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
