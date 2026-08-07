import { Form, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";

type Props = {
  defaultName: string;
  existingTemplates: Array<{ id: string; name: string }>;
};

export function SaveAsTemplateCard({
  defaultName,
  existingTemplates,
}: Props) {
  const navigation = useNavigation();
  const busy =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "save_as_template";

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [replaceId, setReplaceId] = useState("");
  const [saveSupplier, setSaveSupplier] = useState(true);
  const [saveQuantities, setSaveQuantities] = useState(true);
  const [savePricing, setSavePricing] = useState(true);

  if (!open) {
    return (
      <Card>
        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Save as template
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Reuse this order next time without rebuilding lines.
            </Text>
          </BlockStack>
          <Button onClick={() => setOpen(true)}>Save as template</Button>
        </InlineStack>
      </Card>
    );
  }

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="intent" value="save_as_template" />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="replace_template_id" value={replaceId} />
        <input
          type="hidden"
          name="save_supplier"
          value={saveSupplier ? "true" : "false"}
        />
        <input
          type="hidden"
          name="save_quantities"
          value={saveQuantities ? "true" : "false"}
        />
        <input
          type="hidden"
          name="save_pricing"
          value={savePricing ? "true" : "false"}
        />
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Save as template
          </Text>
          <FormLayout>
            <TextField
              label="Template name"
              value={name}
              onChange={setName}
              autoComplete="off"
              requiredIndicator
            />
            <TextField
              label="Description"
              value={description}
              onChange={setDescription}
              autoComplete="off"
              multiline={2}
            />
            {existingTemplates.length > 0 ? (
              <Select
                label="Replace existing?"
                options={[
                  { label: "Create new template", value: "" },
                  ...existingTemplates.map((t) => ({
                    label: t.name,
                    value: t.id,
                  })),
                ]}
                value={replaceId}
                onChange={setReplaceId}
                helpText="Optional — overwrite an existing template instead of creating another."
              />
            ) : null}
            <Checkbox
              label="Save supplier"
              checked={saveSupplier}
              onChange={setSaveSupplier}
            />
            <Checkbox
              label="Save quantities"
              checked={saveQuantities}
              onChange={setSaveQuantities}
            />
            <Checkbox
              label="Save pricing"
              checked={savePricing}
              onChange={setSavePricing}
            />
          </FormLayout>
          <InlineStack gap="200" align="end">
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button submit variant="primary" loading={busy}>
              {replaceId ? "Replace template" : "Save template"}
            </Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Card>
  );
}
