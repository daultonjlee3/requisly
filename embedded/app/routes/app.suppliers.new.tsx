import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Page,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import { createSupplier } from "../lib/suppliers.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await getMerchantContext(request, { sync: false });
  const url = new URL(request.url);
  return { onboarding: url.searchParams.get("onboarding") === "1" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const onboarding = String(formData.get("onboarding") ?? "") === "1";
  try {
    const { id } = await createSupplier(merchant.workspace.id, formData);
    if (onboarding) {
      return merchant.redirect(`/app/suppliers/${id}/price-sheet`);
    }
    return merchant.redirect(`/app/suppliers/${id}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to create supplier",
    };
  }
};

export default function NewSupplier() {
  const { onboarding } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Page
      title="Add supplier"
      backAction={{ content: "Suppliers", url: "/app/suppliers" }}
    >
      <TitleBar title="Add supplier" />
      <Form method="post">
        {onboarding ? (
          <input type="hidden" name="onboarding" value="1" />
        ) : null}
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="contact_name" value={contactName} />
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="payment_terms" value={paymentTerms} />
        <input type="hidden" name="notes" value={notes} />
        <Card>
          <BlockStack gap="400">
            {onboarding ? (
              <Banner tone="info" title="Step 2 — add a supplier">
                <p>
                  After you save, you can upload their CSV price sheet and match
                  SKUs to your Shopify catalog.
                </p>
              </Banner>
            ) : null}
            {actionData?.error ? (
              <Banner tone="critical">
                <p>{actionData.error}</p>
              </Banner>
            ) : null}
            <FormLayout>
              <TextField
                label="Name"
                autoComplete="organization"
                value={name}
                onChange={setName}
                requiredIndicator
              />
              <TextField
                label="Primary contact email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                requiredIndicator
                helpText="You can add more contacts after saving."
              />
              <TextField
                label="Primary contact name"
                autoComplete="name"
                value={contactName}
                onChange={setContactName}
              />
              <TextField
                label="Phone"
                autoComplete="tel"
                value={phone}
                onChange={setPhone}
              />
              <TextField
                label="Payment terms"
                autoComplete="off"
                value={paymentTerms}
                onChange={setPaymentTerms}
              />
              <TextField
                label="Notes"
                autoComplete="off"
                multiline={3}
                value={notes}
                onChange={setNotes}
              />
            </FormLayout>
            <Button submit variant="primary" loading={submitting}>
              {onboarding ? "Save and upload price sheet" : "Save supplier"}
            </Button>
          </BlockStack>
        </Card>
      </Form>
    </Page>
  );
}
