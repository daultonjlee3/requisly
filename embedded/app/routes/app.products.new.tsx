import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Page,
  Select,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import { createSupplierProduct } from "../lib/products.server";
import { listSuppliers } from "../lib/suppliers.server";
import { todayDateInputValue } from "../lib/pricing";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const suppliers = await listSuppliers(merchant.workspace.id);
  return {
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  try {
    const product = await createSupplierProduct(
      merchant.workspace.id,
      formData,
    );
    return merchant.redirect(`/app/products/${product.id}`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to create product",
    };
  }
};

export default function NewProduct() {
  const { suppliers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [sku, setSku] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [caseQty, setCaseQty] = useState("");
  const [moq, setMoq] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayDateInputValue());

  if (!suppliers.length) {
    return (
      <Page
        title="Add product"
        backAction={{ content: "Products", url: "/app/products" }}
      >
        <TitleBar title="Add product" />
        <Banner tone="warning" title="Add a supplier first">
          <p>Products belong to a supplier.</p>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Add catalog product"
      backAction={{ content: "Products", url: "/app/products" }}
    >
      <TitleBar title="Add product" />
      <Form method="post">
        <input type="hidden" name="supplier_id" value={supplierId} />
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="sku" value={sku} />
        <input type="hidden" name="unit_cost" value={unitCost} />
        <input type="hidden" name="case_qty" value={caseQty} />
        <input type="hidden" name="moq" value={moq} />
        <input type="hidden" name="effective_date" value={effectiveDate} />
        <Card>
          <BlockStack gap="400">
            {actionData?.error ? (
              <Banner tone="critical">
                <p>{actionData.error}</p>
              </Banner>
            ) : null}
            <FormLayout>
              <Select
                label="Supplier"
                options={suppliers.map((s) => ({
                  label: s.name,
                  value: s.id,
                }))}
                value={supplierId}
                onChange={setSupplierId}
              />
              <TextField
                label="Title"
                value={title}
                onChange={setTitle}
                autoComplete="off"
                requiredIndicator
              />
              <TextField
                label="SKU"
                value={sku}
                onChange={setSku}
                autoComplete="off"
              />
              <FormLayout.Group>
                <TextField
                  label="Unit cost"
                  type="number"
                  value={unitCost}
                  onChange={setUnitCost}
                  autoComplete="off"
                />
                <TextField
                  label="Effective date"
                  type="date"
                  value={effectiveDate}
                  onChange={setEffectiveDate}
                  autoComplete="off"
                  helpText="Required when setting a unit cost"
                />
              </FormLayout.Group>
              <FormLayout.Group>
                <TextField
                  label="Case qty"
                  type="number"
                  value={caseQty}
                  onChange={setCaseQty}
                  autoComplete="off"
                />
                <TextField
                  label="MOQ"
                  type="number"
                  value={moq}
                  onChange={setMoq}
                  autoComplete="off"
                />
              </FormLayout.Group>
            </FormLayout>
            <Button submit variant="primary" loading={submitting}>
              Save product
            </Button>
          </BlockStack>
        </Card>
      </Form>
    </Page>
  );
}
