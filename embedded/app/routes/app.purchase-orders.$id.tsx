import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  DescriptionList,
  FormLayout,
  Icon,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  CashDollarIcon,
  OrderIcon,
  PackageIcon,
  PersonIcon,
  ProductIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { PendingProposalsPanel } from "../components/PendingProposalsPanel";
import { PoDocumentsCard } from "../components/PoDocumentsCard";
import { PoShipmentsCard } from "../components/PoShipmentsCard";
import { SaveAsTemplateCard } from "../components/SaveAsTemplateCard";
import {
  generateAndStorePoPdf,
  listPoDocuments,
  uploadPoDocument,
  type PoDocumentKind,
} from "../lib/documents.server";
import { getMerchantContext } from "../lib/merchant.server";
import {
  getOnboardingState,
  markFirstPoCelebrated,
} from "../lib/onboarding.server";
import {
  listPoTemplates,
  savePurchaseOrderAsTemplate,
} from "../lib/po-templates.server";
import {
  duplicatePurchaseOrder,
  cancelPurchaseOrder,
  getPurchaseOrderDetail,
  resolveProposal,
  sendPurchaseOrder,
  updatePoArrivalDate,
  updatePoCommercialFields,
} from "../lib/purchase-orders.server";
import { closePurchaseOrder } from "../lib/receiving.server";
import { listSupplierContacts } from "../lib/suppliers.server";
import {
  addMerchantShipment,
  listPoShipments,
} from "../lib/shipments.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const poId = params.id ?? "";
  const url = new URL(request.url);
  const po = await getPurchaseOrderDetail(merchant.workspace.id, poId);
  if (!po) {
    throw new Response("Purchase order not found", { status: 404 });
  }
  const documents = await listPoDocuments(merchant.workspace.id, poId);
  const shipments = await listPoShipments(merchant.workspace.id, poId);
  const templates = await listPoTemplates(merchant.workspace.id, {
    status: "active",
    sort: "name",
  });
  const contacts = await listSupplierContacts(
    merchant.workspace.id,
    po.supplier.id,
  );
  return {
    po,
    documents,
    shipments,
    contacts,
    workspaceName: merchant.workspace.name,
    existingTemplates: templates.rows.map((t) => ({ id: t.id, name: t.name })),
    justEdited: url.searchParams.get("edited") === "1",
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const poId = params.id ?? "";

  try {
    if (intent === "close") {
      await closePurchaseOrder({
        workspaceId: merchant.workspace.id,
        poId,
      });
      return merchant.redirect(`/app/purchase-orders/${poId}`);
    }
    if (intent === "cancel") {
      await cancelPurchaseOrder({
        workspaceId: merchant.workspace.id,
        poId,
        note: String(formData.get("note") ?? "").trim() || null,
      });
      return merchant.redirect(`/app/purchase-orders/${poId}`);
    }
    if (intent === "duplicate") {
      const copy = await duplicatePurchaseOrder({
        workspaceId: merchant.workspace.id,
        poId,
      });
      return merchant.redirect(`/app/purchase-orders/${copy.id}`);
    }
    if (intent === "save_as_template") {
      const created = await savePurchaseOrderAsTemplate({
        workspaceId: merchant.workspace.id,
        poId,
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        replaceTemplateId:
          String(formData.get("replace_template_id") ?? "") || null,
        saveSupplier: String(formData.get("save_supplier") ?? "") === "true",
        saveQuantities:
          String(formData.get("save_quantities") ?? "") === "true",
        savePricing: String(formData.get("save_pricing") ?? "") === "true",
        createdByLabel: merchant.shopName,
      });
      return merchant.redirect(`/app/templates/${created.id}`);
    }
    if (intent === "add_shipment") {
      await addMerchantShipment({
        workspaceId: merchant.workspace.id,
        poId,
        trackingNumber: String(formData.get("tracking_number") ?? ""),
        carrier: String(formData.get("carrier") ?? ""),
        estimatedArrivalDate:
          String(formData.get("estimated_arrival_date") ?? "").trim() || null,
        note: String(formData.get("note") ?? ""),
        lines: JSON.parse(String(formData.get("lines_json") ?? "[]")),
      });
      return merchant.redirect(`/app/purchase-orders/${poId}`);
    }
    if (intent === "accept_proposal" || intent === "reject_proposal") {
      await resolveProposal({
        workspaceId: merchant.workspace.id,
        proposalId: String(formData.get("proposal_id") ?? ""),
        accept: intent === "accept_proposal",
      });
      return merchant.redirect(`/app/purchase-orders/${poId}`);
    }
    if (intent === "generate_pdf") {
      await generateAndStorePoPdf({
        workspaceId: merchant.workspace.id,
        poId,
        workspaceName: merchant.workspace.name,
      });
      return merchant.redirect(`/app/purchase-orders/${poId}`);
    }
    if (intent === "upload_document") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        throw new Error("Choose a file to upload");
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      await uploadPoDocument({
        workspaceId: merchant.workspace.id,
        poId,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        kind: String(formData.get("kind") ?? "upload") as PoDocumentKind,
        bytes,
      });
      return merchant.redirect(`/app/purchase-orders/${poId}`);
    }
    if (intent === "send") {
      const onboarding = await getOnboardingState(merchant.workspace.id);
      const wasFirstSend = onboarding.sentPoCount === 0;
      const result = await sendPurchaseOrder({
        workspaceId: merchant.workspace.id,
        poId,
        workspaceName: merchant.workspace.name,
        toEmail: String(formData.get("to_email") ?? "").trim() || null,
      });
      if (wasFirstSend && !onboarding.flags.first_po_celebrated_at) {
        await markFirstPoCelebrated(merchant.workspace.id);
        return merchant.redirect("/app?activated=1");
      }
      return {
        error: null as string | null,
        sendUrl: result.url,
        sendToken: result.token,
        pdfUrl: result.pdfUrl,
        pdfFileName: result.pdfFileName,
        emailSent: result.emailSent,
        emailError: result.emailError,
        emailTo: result.emailTo,
      };
    }
    if (intent === "arrival") {
      const estimatedArrivalDate =
        String(formData.get("estimated_arrival_date") ?? "").trim() || null;
      await updatePoArrivalDate({
        workspaceId: merchant.workspace.id,
        poId,
        estimatedArrivalDate,
      });
      return merchant.redirect(`/app/purchase-orders/${poId}`);
    }
    if (intent === "commercial") {
      await updatePoCommercialFields({
        workspaceId: merchant.workspace.id,
        poId,
        paymentTerms:
          String(formData.get("payment_terms") ?? "").trim() || null,
        referenceNumber:
          String(formData.get("reference_number") ?? "").trim() || null,
        taxAmount: Number(formData.get("tax_amount") ?? 0) || 0,
        shippingAmount: Number(formData.get("shipping_amount") ?? 0) || 0,
        adjustmentAmount: Number(formData.get("adjustment_amount") ?? 0) || 0,
      });
      return merchant.redirect(`/app/purchase-orders/${poId}`);
    }
    return {
      error: "Unknown action",
      sendUrl: null,
      sendToken: null,
      emailSent: false,
      emailError: null as string | null,
      emailTo: null as string | null,
      pdfUrl: null,
      pdfFileName: null,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Action failed",
      sendUrl: null as string | null,
      sendToken: null as string | null,
      emailSent: false,
      emailError: null as string | null,
      emailTo: null as string | null,
      pdfUrl: null as string | null,
      pdfFileName: null as string | null,
    };
  }
};

function stepTone(
  state: "done" | "current" | "future" | "skip",
): "success" | "info" | "warning" | undefined {
  if (state === "done") return "success";
  if (state === "current") return "info";
  if (state === "skip") return "warning";
  return undefined;
}

function stepStatusLabel(state: "done" | "current" | "future" | "skip") {
  switch (state) {
    case "done":
      return "Done";
    case "current":
      return "Current";
    case "skip":
      return "Skipped";
    default:
      return "Upcoming";
  }
}

export default function PurchaseOrderDetail() {
  const { po, documents, shipments, contacts, existingTemplates, justEdited } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const defaultSendEmail =
    contacts.find((c) => c.isPrimary)?.email || po.supplier.email || "";
  const [sendChoice, setSendChoice] = useState(defaultSendEmail || "__custom");
  const [sendEmail, setSendEmail] = useState(defaultSendEmail);
  const [arrival, setArrival] = useState(po.estimatedArrivalRaw);
  const [paymentTerms, setPaymentTerms] = useState(po.paymentTerms ?? "");
  const [referenceNumber, setReferenceNumber] = useState(
    po.referenceNumber ?? "",
  );
  const [taxAmount, setTaxAmount] = useState(String(po.taxAmountRaw || ""));
  const [shippingAmount, setShippingAmount] = useState(
    String(po.shippingAmountRaw || ""),
  );
  const [adjustmentAmount, setAdjustmentAmount] = useState(
    String(po.adjustmentAmountRaw || ""),
  );

  const closing =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "close";
  const cancelling =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "cancel";
  const duplicating =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "duplicate";
  const sending =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "send";
  const savingArrival =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "arrival";
  const savingCommercial =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "commercial";

  const linkUrl = actionData?.sendUrl ?? po.supplierLinkUrl;
  const linkToken = actionData?.sendToken ?? po.supplierLinkToken;
  const pdfUrl =
    actionData?.pdfUrl ??
    documents.find((d) => d.kind === "po_pdf")?.downloadUrl ??
    null;

  const lineRows = po.lineItems.map((line) => [
    line.isFreeText ? `${line.description} (free-text)` : line.description,
    line.sku,
    line.qty,
    line.unitCost,
    line.lineTotal,
  ]);

  return (
    <Page
      title={po.poNumber}
      subtitle={`${po.supplier.name} · created ${po.createdAt}`}
      titleMetadata={<Badge tone={po.statusTone}>{po.statusLabel}</Badge>}
      backAction={{ content: "Purchase orders", url: "/app/purchase-orders" }}
      primaryAction={
        po.canReceive
          ? {
              content: "Receive",
              url: `/app/purchase-orders/${po.id}/receive`,
            }
          : undefined
      }
      secondaryActions={[
        ...(po.canEdit
          ? [
              {
                content: po.status === "draft" ? "Edit draft" : "Edit PO",
                url: `/app/purchase-orders/${po.id}/edit`,
              },
            ]
          : []),
        {
          content: "Save as template",
          url: `/app/templates/new?from=${po.id}`,
        },
      ]}
    >
      <TitleBar title={po.poNumber} />
      <BlockStack gap="500">
        {actionData?.error ? (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        {po.confirmationStale || justEdited ? (
          <Banner
            tone="warning"
            title="Supplier confirmed the previous version"
            action={
              po.canSend
                ? {
                    content: "Resend for fresh confirmation",
                    // Submit is handled via the existing Send form below —
                    // deep-link merchants to the send control with copy.
                    url: `#send-supplier-link`,
                  }
                : undefined
            }
          >
            <p>
              This PO was edited after the supplier confirmed. Their confirmation
              may be stale — resend the Supplier Link so they can confirm the
              current quantities and terms.
            </p>
          </Banner>
        ) : null}

        <InlineStack align="end" gap="200">
          <Form method="post">
            <input type="hidden" name="intent" value="duplicate" />
            <Button submit loading={duplicating}>
              Duplicate PO
            </Button>
          </Form>
          {po.canCancel ? (
            <Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <Button submit tone="critical" loading={cancelling}>
                Cancel PO
              </Button>
            </Form>
          ) : null}
          {po.canClose ? (
            <Form method="post">
              <input type="hidden" name="intent" value="close" />
              <Button submit tone="critical" loading={closing}>
                Close PO
              </Button>
            </Form>
          ) : null}
        </InlineStack>

        <PendingProposalsPanel proposals={po.pendingProposals} />

        {po.status === "rejected" ? (
          <Banner tone="critical" title="Rejected by supplier">
            <p>
              This is a terminal state — Supplier Link actions are closed for
              this PO.
            </p>
          </Banner>
        ) : null}
        {po.status === "cancelled" ? (
          <Banner tone="critical" title="Cancelled by merchant">
            <p>
              You cancelled this purchase order. It is distinct from a supplier
              rejection — Supplier Link actions are closed for this PO.
            </p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={OrderIcon} tone="base" />
                <Text as="h2" variant="headingMd">
                  Workflow
                </Text>
              </InlineStack>
              <Badge tone={po.statusTone}>{po.statusLabel}</Badge>
            </InlineStack>
            <ProgressBar progress={po.progress} size="small" />
            <BlockStack gap="200">
              {po.timelineSteps.map((step) => (
                <InlineStack
                  key={step.key}
                  align="space-between"
                  blockAlign="center"
                  gap="400"
                >
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={stepTone(step.state)} size="small">
                      {stepStatusLabel(step.state)}
                    </Badge>
                    <Text
                      as="span"
                      variant="bodyMd"
                      fontWeight={
                        step.state === "current" ? "semibold" : "regular"
                      }
                      tone={step.state === "future" ? "subdued" : undefined}
                    >
                      {step.label}
                    </Text>
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {step.dateLabel}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>

        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={ProductIcon} tone="base" />
                      <Text as="h2" variant="headingMd">
                        Line items
                      </Text>
                    </InlineStack>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {po.lineItems.length} item
                      {po.lineItems.length === 1 ? "" : "s"}
                    </Text>
                  </InlineStack>
                  {po.lineItems.length === 0 ? (
                    <Text as="p" tone="subdued">
                      No line items on this order.
                    </Text>
                  ) : (
                    <DataTable
                      columnContentTypes={[
                        "text",
                        "text",
                        "numeric",
                        "numeric",
                        "numeric",
                      ]}
                      headings={[
                        "Product",
                        "SKU",
                        "Qty",
                        "Unit cost",
                        "Total",
                      ]}
                      rows={lineRows}
                      totals={["", "", "", "Total", po.total]}
                      showTotalsInFooter
                    />
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CashDollarIcon} tone="base" />
                    <Text as="h2" variant="headingMd">
                      Cost summary
                    </Text>
                  </InlineStack>
                  <DescriptionList
                    items={[
                      { term: "Subtotal", description: po.subtotal },
                      { term: "Tax", description: po.taxAmount },
                      { term: "Shipping", description: po.shippingAmount },
                      {
                        term: "Adjustments",
                        description: po.adjustmentAmount,
                      },
                      { term: "Total", description: po.total },
                    ]}
                  />
                </BlockStack>
              </Card>

              <PoShipmentsCard
                shipments={shipments}
                lineItems={po.lineItems.map((l) => ({
                  id: l.id,
                  description: l.description,
                  qtyRaw: l.qtyRaw,
                }))}
                canAdd={
                  !["draft", "rejected", "cancelled", "closed", "received"].includes(
                    po.status,
                  )
                }
              />

              <SaveAsTemplateCard
                defaultName={`${po.supplier.name} restock`}
                existingTemplates={existingTemplates}
              />

              <PoDocumentsCard documents={documents} />

              {po.receipts.length > 0 ? (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={PackageIcon} tone="base" />
                      <Text as="h2" variant="headingMd">
                        Receipts
                      </Text>
                    </InlineStack>
                    {po.receipts.map((receipt) => (
                      <BlockStack key={receipt.id} gap="100">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {receipt.totalQty} units · {receipt.lineCount} line
                            {receipt.lineCount === 1 ? "" : "s"}
                          </Text>
                          <Button
                            url={`/app/purchase-orders/${po.id}/receipts/${receipt.id}/edit`}
                            size="slim"
                          >
                            Correct
                          </Button>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {receipt.createdLabel}
                          {receipt.note ? ` · ${receipt.note}` : ""}
                        </Text>
                      </BlockStack>
                    ))}
                  </BlockStack>
                </Card>
              ) : null}

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Activity
                  </Text>
                  {po.activity.length === 0 ? (
                    <Text as="p" tone="subdued">
                      No activity yet.
                    </Text>
                  ) : (
                    <BlockStack gap="300">
                      {po.activity.map((event) => (
                        <BlockStack key={event.id} gap="100">
                          <Text as="p" variant="bodyMd">
                            <Text as="span" fontWeight="semibold">
                              {event.eventType}
                            </Text>{" "}
                            · {event.actor}{" "}
                            <Text as="span" tone="subdued">
                              {event.dateLabel}
                            </Text>
                          </Text>
                          {event.metadata
                            ? event.metadata.split("\n").map((line, index) => (
                                <Text
                                  as="p"
                                  variant="bodySm"
                                  tone="subdued"
                                  key={`${event.id}-${index}`}
                                >
                                  {line || " "}
                                </Text>
                              ))
                            : null}
                        </BlockStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={PersonIcon} tone="base" />
                      <Text as="h2" variant="headingMd">
                        Supplier
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {po.supplier.name}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {po.supplier.email}
                    </Text>
                  </BlockStack>

                  <DescriptionList
                    items={[
                      { term: "Ship to", description: po.shipTo },
                      {
                        term: "Payment terms",
                        description: po.paymentTerms || "—",
                      },
                      {
                        term: "Reference",
                        description: po.referenceNumber || "—",
                      },
                      {
                        term: "Requested ship",
                        description: po.requestedShipDate,
                      },
                      {
                        term: "Confirmed ship",
                        description: po.confirmedShipDate,
                      },
                      {
                        term: "Est. arrival",
                        description: po.estimatedArrivalDate,
                      },
                      {
                        term: "Shipments",
                        description:
                          shipments.length > 0
                            ? `${shipments.length} logged`
                            : "None yet",
                      },
                    ]}
                  />

                  {po.notes ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {po.notes}
                    </Text>
                  ) : null}
                </BlockStack>
              </Card>

              <Card>
                <Form method="post">
                  <input type="hidden" name="intent" value="commercial" />
                  <input type="hidden" name="payment_terms" value={paymentTerms} />
                  <input
                    type="hidden"
                    name="reference_number"
                    value={referenceNumber}
                  />
                  <input type="hidden" name="tax_amount" value={taxAmount} />
                  <input
                    type="hidden"
                    name="shipping_amount"
                    value={shippingAmount}
                  />
                  <input
                    type="hidden"
                    name="adjustment_amount"
                    value={adjustmentAmount}
                  />
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Commercial terms
                    </Text>
                    <FormLayout>
                      <TextField
                        label="Payment terms"
                        value={paymentTerms}
                        onChange={setPaymentTerms}
                        autoComplete="off"
                        placeholder="Net 30"
                      />
                      <TextField
                        label="Reference #"
                        value={referenceNumber}
                        onChange={setReferenceNumber}
                        autoComplete="off"
                      />
                      <TextField
                        label="Tax"
                        type="number"
                        min={0}
                        step={0.01}
                        value={taxAmount}
                        onChange={setTaxAmount}
                        autoComplete="off"
                        prefix="$"
                      />
                      <TextField
                        label="Shipping"
                        type="number"
                        min={0}
                        step={0.01}
                        value={shippingAmount}
                        onChange={setShippingAmount}
                        autoComplete="off"
                        prefix="$"
                      />
                      <TextField
                        label="Adjustments"
                        type="number"
                        step={0.01}
                        value={adjustmentAmount}
                        onChange={setAdjustmentAmount}
                        autoComplete="off"
                        prefix="$"
                        helpText="Use negative values for credits."
                      />
                    </FormLayout>
                    <Button submit loading={savingCommercial}>
                      Save commercial terms
                    </Button>
                  </BlockStack>
                </Form>
              </Card>

              <Card>
                <Form method="post">
                  <input type="hidden" name="intent" value="arrival" />
                  <input
                    type="hidden"
                    name="estimated_arrival_date"
                    value={arrival}
                  />
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Estimated arrival
                    </Text>
                    <FormLayout>
                      <TextField
                        label="Arrival date"
                        type="date"
                        value={arrival}
                        onChange={setArrival}
                        autoComplete="off"
                        helpText="Powers arriving-soon and delayed emails."
                      />
                    </FormLayout>
                    <Button submit loading={savingArrival}>
                      Save arrival date
                    </Button>
                  </BlockStack>
                </Form>
              </Card>

              {po.canSend ? (
                <Card>
                  <div id="send-supplier-link">
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Send to supplier
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {po.confirmationStale
                        ? "Resend so the supplier can confirm the edited PO."
                        : "Emails the chosen contact (one-click confirm/ship + Reply-To), generates a PO PDF, moves draft → sent, and creates a no-login Supplier Link."}
                    </Text>
                    <Form method="post">
                      <input type="hidden" name="intent" value="send" />
                      <input type="hidden" name="to_email" value={sendEmail} />
                      <BlockStack gap="300">
                        <Select
                          label="Send to"
                          options={[
                            ...contacts
                              .filter((c) => c.email.trim())
                              .map((c) => ({
                                value: c.email,
                                label: c.isPrimary
                                  ? `${c.name} · ${c.email} (primary)`
                                  : `${c.name} · ${c.email}`,
                              })),
                            ...(po.supplier.email &&
                            !contacts.some((c) => c.email === po.supplier.email)
                              ? [
                                  {
                                    value: po.supplier.email,
                                    label: `${po.supplier.name} · ${po.supplier.email}`,
                                  },
                                ]
                              : []),
                            { value: "__custom", label: "Different email…" },
                          ]}
                          value={
                            sendChoice === "__custom" ||
                            contacts.some((c) => c.email === sendChoice) ||
                            sendChoice === po.supplier.email
                              ? sendChoice
                              : "__custom"
                          }
                          onChange={(value) => {
                            setSendChoice(value);
                            if (value !== "__custom") setSendEmail(value);
                          }}
                        />
                        {sendChoice === "__custom" ? (
                          <TextField
                            label="Email address"
                            type="email"
                            value={sendEmail}
                            onChange={setSendEmail}
                            autoComplete="email"
                            requiredIndicator
                          />
                        ) : null}
                        <Button submit variant="primary" loading={sending}>
                          {po.confirmationStale
                            ? "Resend for fresh confirmation"
                            : linkToken
                              ? "Refresh PDF & send email"
                              : "Send to supplier"}
                        </Button>
                      </BlockStack>
                    </Form>
                    {actionData?.emailSent ? (
                      <Banner tone="success" title="Email sent to supplier">
                        <p>
                          Sent to{" "}
                          {actionData.emailTo ||
                            sendEmail ||
                            po.supplier.email ||
                            "supplier"}{" "}
                          with one-click actions and Reply-To on
                          requisly.com.
                        </p>
                      </Banner>
                    ) : actionData?.emailError ? (
                      <Banner tone="warning" title="Email not sent">
                        <p>{actionData.emailError}</p>
                      </Banner>
                    ) : null}
                    {pdfUrl ? (
                      <Banner tone="success" title="PO PDF ready">
                        <p>
                          <a href={pdfUrl} target="_blank" rel="noreferrer">
                            Download{" "}
                            {actionData?.pdfFileName ??
                              documents.find((d) => d.kind === "po_pdf")
                                ?.fileName ??
                              "PO PDF"}
                          </a>
                        </p>
                      </Banner>
                    ) : null}
                    {linkUrl ? (
                      <Banner tone="success" title="Supplier Link ready">
                        <p>
                          <a href={linkUrl} target="_blank" rel="noreferrer">
                            {linkUrl}
                          </a>
                        </p>
                      </Banner>
                    ) : linkToken ? (
                      <Banner tone="warning" title="Token created">
                        <p>
                          Set <code>NEXT_PUBLIC_APP_URL</code> in{" "}
                          <code>embedded/.env</code> so the full link can be
                          shown. Token: {linkToken.slice(0, 10)}…
                        </p>
                      </Banner>
                    ) : null}
                  </BlockStack>
                  </div>
                </Card>
              ) : null}
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
