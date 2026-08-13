import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  FormLayout,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getMerchantContext } from "../lib/merchant.server";
import {
  inviteTeammate,
  loadTeamPage,
  resendInvite,
  revokeInvite,
} from "../lib/team.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const team = await loadTeamPage(merchant.workspace.id);
  return {
    workspaceName: team.workspaceName,
    members: team.members,
    invites: team.invites,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await getMerchantContext(request, { sync: false });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "invite");

  try {
    if (intent === "invite") {
      const email = String(formData.get("email") ?? "");
      const result = await inviteTeammate({
        workspaceId: merchant.workspace.id,
        email,
        invitedByLabel: merchant.workspace.name,
      });
      return {
        ok: true as const,
        intent: "invite" as const,
        emailSent: result.emailSent,
        emailError: result.emailError,
        error: null as string | null,
      };
    }

    if (intent === "revoke") {
      await revokeInvite({
        workspaceId: merchant.workspace.id,
        inviteId: String(formData.get("invite_id") ?? ""),
      });
      return {
        ok: true as const,
        intent: "revoke" as const,
        emailSent: false,
        emailError: null as string | null,
        error: null as string | null,
      };
    }

    if (intent === "resend") {
      const result = await resendInvite({
        workspaceId: merchant.workspace.id,
        inviteId: String(formData.get("invite_id") ?? ""),
        invitedByLabel: merchant.workspace.name,
      });
      return {
        ok: true as const,
        intent: "resend" as const,
        emailSent: result.emailSent,
        emailError: result.emailError,
        error: null as string | null,
      };
    }

    return {
      ok: false as const,
      intent,
      emailSent: false,
      emailError: null as string | null,
      error: "Unknown action",
    };
  } catch (err) {
    return {
      ok: false as const,
      intent,
      emailSent: false,
      emailError: null as string | null,
      error: err instanceof Error ? err.message : "Something went wrong",
    };
  }
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function TeamSettingsPage() {
  const { workspaceName, members, invites } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [email, setEmail] = useState("");
  const inviting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "invite";

  const pendingInvites = invites.filter((i) => i.status === "pending");

  return (
    <Page title="Team" subtitle={workspaceName}>
      <TitleBar title="Team" />
      <BlockStack gap="500">
        {actionData?.error ? (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}
        {actionData?.ok && actionData.intent === "invite" ? (
          actionData.emailSent ? (
            <Banner tone="success">
              <p>Invite sent. They’ll join when they sign in with that email.</p>
            </Banner>
          ) : (
            <Banner tone="warning">
              <p>
                Invite saved, but the email didn’t send
                {actionData.emailError ? `: ${actionData.emailError}` : ""}.
                You can resend from the pending list.
              </p>
            </Banner>
          )
        ) : null}
        {actionData?.ok && actionData.intent === "resend" ? (
          actionData.emailSent ? (
            <Banner tone="success">
              <p>Invite email resent.</p>
            </Banner>
          ) : (
            <Banner tone="warning">
              <p>
                Resend failed
                {actionData.emailError ? `: ${actionData.emailError}` : ""}.
              </p>
            </Banner>
          )
        ) : null}
        {actionData?.ok && actionData.intent === "revoke" ? (
          <Banner tone="success">
            <p>Invite revoked.</p>
          </Banner>
        ) : null}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Invite teammate
                </Text>
                <Text as="p" tone="subdued" variant="bodyMd">
                  They get an email with a link. On first login with that
                  address, they join this workspace as a member (same access as
                  you for now).
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="invite" />
                  <input type="hidden" name="email" value={email} />
                  <FormLayout>
                    <TextField
                      label="Email"
                      type="email"
                      value={email}
                      onChange={setEmail}
                      autoComplete="email"
                      placeholder="teammate@company.com"
                    />
                    <Button submit variant="primary" loading={inviting}>
                      Send invite
                    </Button>
                  </FormLayout>
                </Form>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="300">
                <Box paddingInline="400" paddingBlockStart="400">
                  <Text as="h2" variant="headingMd">
                    Members
                  </Text>
                </Box>
                {members.length === 0 ? (
                  <Box padding="400">
                    <Text as="p" tone="subdued" variant="bodyMd">
                      No joined members yet. Invites below become members after
                      they accept.
                    </Text>
                  </Box>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "member", plural: "members" }}
                    itemCount={members.length}
                    headings={[
                      { title: "Name" },
                      { title: "Email" },
                      { title: "Role" },
                      { title: "Joined" },
                    ]}
                    selectable={false}
                  >
                    {members.map((row, index) => (
                      <IndexTable.Row id={row.id} key={row.id} position={index}>
                        <IndexTable.Cell>
                          {row.fullName || "—"}
                        </IndexTable.Cell>
                        <IndexTable.Cell>{row.email || "—"}</IndexTable.Cell>
                        <IndexTable.Cell>{row.role}</IndexTable.Cell>
                        <IndexTable.Cell>
                          {formatWhen(row.joinedAt)}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="300">
                <Box paddingInline="400" paddingBlockStart="400">
                  <Text as="h2" variant="headingMd">
                    Pending invites
                  </Text>
                </Box>
                {pendingInvites.length === 0 ? (
                  <Box padding="400">
                    <Text as="p" tone="subdued" variant="bodyMd">
                      No pending invites.
                    </Text>
                  </Box>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "invite", plural: "invites" }}
                    itemCount={pendingInvites.length}
                    headings={[
                      { title: "Email" },
                      { title: "Invited" },
                      { title: "Actions" },
                    ]}
                    selectable={false}
                  >
                    {pendingInvites.map((row, index) => (
                      <IndexTable.Row id={row.id} key={row.id} position={index}>
                        <IndexTable.Cell>{row.email}</IndexTable.Cell>
                        <IndexTable.Cell>
                          {formatWhen(row.invitedAt)}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="200">
                            <Form method="post">
                              <input type="hidden" name="intent" value="resend" />
                              <input
                                type="hidden"
                                name="invite_id"
                                value={row.id}
                              />
                              <Button submit size="slim">
                                Resend
                              </Button>
                            </Form>
                            <Form method="post">
                              <input type="hidden" name="intent" value="revoke" />
                              <input
                                type="hidden"
                                name="invite_id"
                                value={row.id}
                              />
                              <Button submit size="slim" tone="critical">
                                Revoke
                              </Button>
                            </Form>
                          </InlineStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
