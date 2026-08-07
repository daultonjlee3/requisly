import { Form, useNavigation } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  FormLayout,
  IndexTable,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import type { SupplierContact } from "../lib/suppliers.server";

type Props = {
  contacts: SupplierContact[];
};

export function SupplierContactsPanel({ contacts }: Props) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const intent = String(navigation.formData?.get("intent") ?? "");

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addPrimary, setAddPrimary] = useState(false);

  const editing = contacts.find((c) => c.id === editingId) ?? null;
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editPrimary, setEditPrimary] = useState(false);

  function startEdit(contact: SupplierContact) {
    setShowAdd(false);
    setEditingId(contact.id);
    setEditName(contact.name);
    setEditEmail(contact.email);
    setEditPhone(contact.phone ?? "");
    setEditTitle(contact.title ?? "");
    setEditPrimary(contact.isPrimary);
  }

  function resetAdd() {
    setAddName("");
    setAddEmail("");
    setAddPhone("");
    setAddTitle("");
    setAddPrimary(false);
    setShowAdd(false);
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Contacts
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Primary contact is used for Supplier Link and PO emails.
            </Text>
          </BlockStack>
          {!showAdd && !editingId ? (
            <Button
              onClick={() => {
                setEditingId(null);
                setShowAdd(true);
              }}
            >
              Add contact
            </Button>
          ) : null}
        </InlineStack>

        {contacts.length === 0 ? (
          <Text as="p" tone="subdued">
            No contacts yet.
          </Text>
        ) : (
          <IndexTable
            resourceName={{ singular: "contact", plural: "contacts" }}
            itemCount={contacts.length}
            headings={[
              { title: "Name" },
              { title: "Email" },
              { title: "Phone" },
              { title: "Role" },
              { title: "Actions" },
            ]}
            selectable={false}
          >
            {contacts.map((contact, index) => (
              <IndexTable.Row
                id={contact.id}
                key={contact.id}
                position={index}
              >
                <IndexTable.Cell>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold">
                      {contact.name}
                    </Text>
                    {contact.isPrimary ? (
                      <Badge tone="info">Primary</Badge>
                    ) : null}
                  </InlineStack>
                </IndexTable.Cell>
                <IndexTable.Cell>{contact.email}</IndexTable.Cell>
                <IndexTable.Cell>{contact.phone || "—"}</IndexTable.Cell>
                <IndexTable.Cell>{contact.title || "—"}</IndexTable.Cell>
                <IndexTable.Cell>
                  <ButtonGroup>
                    <Button
                      size="slim"
                      onClick={() => startEdit(contact)}
                      disabled={busy}
                    >
                      Edit
                    </Button>
                    {!contact.isPrimary ? (
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="set_primary_contact"
                        />
                        <input
                          type="hidden"
                          name="contact_id"
                          value={contact.id}
                        />
                        <Button
                          submit
                          size="slim"
                          loading={
                            busy &&
                            intent === "set_primary_contact" &&
                            navigation.formData?.get("contact_id") ===
                              contact.id
                          }
                        >
                          Make primary
                        </Button>
                      </Form>
                    ) : null}
                    {contacts.length > 1 ? (
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="delete_contact"
                        />
                        <input
                          type="hidden"
                          name="contact_id"
                          value={contact.id}
                        />
                        <Button
                          submit
                          size="slim"
                          tone="critical"
                          loading={
                            busy &&
                            intent === "delete_contact" &&
                            navigation.formData?.get("contact_id") ===
                              contact.id
                          }
                        >
                          Remove
                        </Button>
                      </Form>
                    ) : null}
                  </ButtonGroup>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}

        {showAdd ? (
          <Card background="bg-surface-secondary">
            <Form
              method="post"
              onSubmit={() => {
                // Reset after successful navigation via key remount; keep simple.
              }}
            >
              <input type="hidden" name="intent" value="add_contact" />
              <input type="hidden" name="name" value={addName} />
              <input type="hidden" name="email" value={addEmail} />
              <input type="hidden" name="phone" value={addPhone} />
              <input type="hidden" name="title" value={addTitle} />
              <input
                type="hidden"
                name="is_primary"
                value={addPrimary ? "true" : "false"}
              />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  New contact
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Name"
                      value={addName}
                      onChange={setAddName}
                      autoComplete="name"
                      requiredIndicator
                    />
                    <TextField
                      label="Email"
                      type="email"
                      value={addEmail}
                      onChange={setAddEmail}
                      autoComplete="email"
                      requiredIndicator
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Phone"
                      value={addPhone}
                      onChange={setAddPhone}
                      autoComplete="tel"
                    />
                    <TextField
                      label="Role / title"
                      value={addTitle}
                      onChange={setAddTitle}
                      autoComplete="organization-title"
                      placeholder="e.g. Accounts payable"
                    />
                  </FormLayout.Group>
                  <Checkbox
                    label="Set as primary contact"
                    checked={addPrimary}
                    onChange={setAddPrimary}
                  />
                </FormLayout>
                <InlineStack gap="200" align="end">
                  <Button onClick={resetAdd} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    submit
                    variant="primary"
                    loading={busy && intent === "add_contact"}
                  >
                    Save contact
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        ) : null}

        {editing ? (
          <Card background="bg-surface-secondary">
            <Form method="post">
              <input type="hidden" name="intent" value="update_contact" />
              <input type="hidden" name="contact_id" value={editing.id} />
              <input type="hidden" name="name" value={editName} />
              <input type="hidden" name="email" value={editEmail} />
              <input type="hidden" name="phone" value={editPhone} />
              <input type="hidden" name="title" value={editTitle} />
              <input
                type="hidden"
                name="is_primary"
                value={editPrimary || editing.isPrimary ? "true" : "false"}
              />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Edit contact
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Name"
                      value={editName}
                      onChange={setEditName}
                      autoComplete="name"
                      requiredIndicator
                    />
                    <TextField
                      label="Email"
                      type="email"
                      value={editEmail}
                      onChange={setEditEmail}
                      autoComplete="email"
                      requiredIndicator
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Phone"
                      value={editPhone}
                      onChange={setEditPhone}
                      autoComplete="tel"
                    />
                    <TextField
                      label="Role / title"
                      value={editTitle}
                      onChange={setEditTitle}
                      autoComplete="organization-title"
                    />
                  </FormLayout.Group>
                  {!editing.isPrimary ? (
                    <Checkbox
                      label="Set as primary contact"
                      checked={editPrimary}
                      onChange={setEditPrimary}
                    />
                  ) : (
                    <Text as="p" tone="subdued" variant="bodySm">
                      This is the primary contact.
                    </Text>
                  )}
                </FormLayout>
                <InlineStack gap="200" align="end">
                  <Button onClick={() => setEditingId(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    submit
                    variant="primary"
                    loading={busy && intent === "update_contact"}
                  >
                    Save changes
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        ) : null}
      </BlockStack>
    </Card>
  );
}
