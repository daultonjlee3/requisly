import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Banner,
  BlockStack,
  Card,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Install / open only via Shopify-owned surfaces (Admin, App Store, Partner link).
  // If Shopify already attached ?shop=, continue into the embedded app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { polarisTranslations };
};

export default function App() {
  const { polarisTranslations } = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <Page title="Requisly">
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Purchase orders for Shopify
              </Text>
              <Text as="p" tone="subdued">
                Create POs, share a Supplier Link, and receive inventory —
                inside Admin.
              </Text>
            </BlockStack>

            <Banner tone="info" title="Install from Shopify">
              <p>
                Requisly is installed from the Shopify App Store or a
                Partner-generated install link — not by typing a shop domain
                here. Open the app from your Shopify Admin Apps menu after
                install.
              </p>
            </Banner>

            <List type="bullet">
              <List.Item>Golden-workflow purchase orders</List.Item>
              <List.Item>Supplier Link without a supplier login</List.Item>
              <List.Item>Receive against Shopify inventory</List.Item>
            </List>
          </BlockStack>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
