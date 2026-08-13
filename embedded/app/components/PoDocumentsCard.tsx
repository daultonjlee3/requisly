import { Form, useFetcher, useNavigation } from "@remix-run/react";
import { useCallback, useState } from "react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  DropZone,
  Icon,
  InlineStack,
  Select,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import { NoteIcon } from "@shopify/polaris-icons";
import type { PoDocumentRow } from "../lib/documents.server";

const KIND_OPTIONS = [
  { label: "General upload", value: "upload" },
  { label: "Invoice", value: "invoice" },
  { label: "Packing slip", value: "packing_slip" },
  { label: "Other", value: "other" },
];

export function PoDocumentsCard({
  documents,
}: {
  documents: PoDocumentRow[];
}) {
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const generating =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "generate_pdf";
  const uploading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "upload_document";

  const [kind, setKind] = useState("upload");
  const [fileName, setFileName] = useState<string | null>(null);

  const handleDrop = useCallback(
    (_drop: File[], accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      setFileName(file.name);
      const body = new FormData();
      body.set("intent", "upload_document");
      body.set("kind", kind);
      body.set("file", file);
      fetcher.submit(body, { method: "post", encType: "multipart/form-data" });
    },
    [fetcher, kind],
  );

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={NoteIcon} tone="base" />
            <Text as="h2" variant="headingMd">
              Documents
            </Text>
          </InlineStack>
          <Form method="post">
            <input type="hidden" name="intent" value="generate_pdf" />
            <Button submit loading={generating}>
              {documents.some((d) => d.kind === "po_pdf")
                ? "Regenerate PDF"
                : "Generate PDF"}
            </Button>
          </Form>
        </InlineStack>

        {documents.length === 0 ? (
          <Text as="p" tone="subdued" variant="bodySm">
            Generate a professional PO PDF before sending, or upload invoices
            and packing slips.
          </Text>
        ) : (
          <BlockStack gap="300">
            {documents.map((doc) => (
              <InlineStack
                key={doc.id}
                align="space-between"
                blockAlign="center"
                gap="300"
                wrap
              >
                <InlineStack gap="300" blockAlign="center">
                  <Thumbnail source={NoteIcon} alt="" size="small" />
                  <BlockStack gap="050">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {doc.fileName}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {doc.createdLabel}
                    </Text>
                  </BlockStack>
                  <Badge>{doc.kindLabel}</Badge>
                </InlineStack>
                {doc.downloadUrl ? (
                  <Button url={doc.downloadUrl} target="_blank">
                    Download
                  </Button>
                ) : null}
              </InlineStack>
            ))}
          </BlockStack>
        )}

        <BlockStack gap="300">
          <Select
            label="Document type"
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
          />
          <DropZone
            allowMultiple={false}
            onDrop={handleDrop}
            variableHeight
            label="Upload file"
            disabled={uploading}
          >
            <DropZone.FileUpload
              actionHint={
                uploading
                  ? `Uploading ${fileName ?? "file"}…`
                  : "PDF, image, or document"
              }
            />
          </DropZone>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
