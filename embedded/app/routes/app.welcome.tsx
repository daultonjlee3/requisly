import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  getOnboardingState,
  markWelcomeDone,
} from "../lib/onboarding.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const onboarding = await getOnboardingState(merchant.workspace.id);
  if (!onboarding.showWelcome) {
    return merchant.redirect("/app");
  }
  return { workspaceName: merchant.workspace.name };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "continue");
  await markWelcomeDone(merchant.workspace.id);
  if (intent === "preview_demo") {
    return merchant.redirect("/app/analytics?sample=1");
  }
  return merchant.redirect("/app");
};

export default function WelcomePage() {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  return (
    <Page>
      <TitleBar title="Welcome to Requisly" />
      <Card>
        <BlockStack gap="500">
          <BlockStack gap="200">
            <Text as="h1" variant="headingLg">
              Your supplier ghosted your last PO and you found out three weeks
              late? That&apos;s what this fixes.
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Requisly keeps every purchase order on one timeline — sent,
              confirmed, shipped, received — so you see supplier silence the day
              it happens, not three weeks later in a spreadsheet.
            </Text>
          </BlockStack>

          <InlineStack gap="300" wrap>
            <Form method="post">
              <input type="hidden" name="intent" value="continue" />
              <Button submit variant="primary" loading={submitting}>
                Get started
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="preview_demo" />
              <Button submit loading={submitting}>
                See what this looks like with real history →
              </Button>
            </Form>
          </InlineStack>
        </BlockStack>
      </Card>
    </Page>
  );
}
