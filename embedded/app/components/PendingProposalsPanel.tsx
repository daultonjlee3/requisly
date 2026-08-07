import { Form, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { money } from "../lib/format";

export type PendingProposal = {
  id: string;
  lineItemId: string;
  lineDescription: string;
  currentQty: number;
  currentUnitCost: number;
  proposedQty: number | null;
  proposedUnitCost: number | null;
  note: string | null;
};

export function PendingProposalsPanel({
  proposals,
}: {
  proposals: PendingProposal[];
}) {
  const navigation = useNavigation();
  if (!proposals.length) return null;

  const busy =
    navigation.state !== "idle" &&
    (navigation.formData?.get("intent") === "accept_proposal" ||
      navigation.formData?.get("intent") === "reject_proposal");

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Pending proposals
          </Text>
          <Badge tone="info">
            {`${proposals.length} awaiting review`}
          </Badge>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          Accepting a proposal updates that line&apos;s quantity/cost and
          recalculates the PO total. The supplier&apos;s note is the only
          message — there is no chat thread.
        </Text>
        {proposals.map((proposal) => (
          <Banner key={proposal.id} tone="info" title={proposal.lineDescription}>
            <BlockStack gap="300">
              <Text as="p" variant="bodySm">
                Current: × {proposal.currentQty} @{" "}
                {money(proposal.currentUnitCost)}
              </Text>
              <InlineStack gap="400">
                {proposal.proposedQty != null ? (
                  <Text as="p" variant="bodySm">
                    Proposed qty:{" "}
                    <Text as="span" fontWeight="semibold">
                      {proposal.proposedQty}
                    </Text>
                  </Text>
                ) : null}
                {proposal.proposedUnitCost != null ? (
                  <Text as="p" variant="bodySm">
                    Proposed unit cost:{" "}
                    <Text as="span" fontWeight="semibold">
                      {money(proposal.proposedUnitCost)}
                    </Text>
                  </Text>
                ) : null}
              </InlineStack>
              {proposal.note ? (
                <Text as="p" variant="bodySm">
                  Supplier note: {proposal.note}
                </Text>
              ) : null}
              <InlineStack gap="200">
                <Form method="post">
                  <input type="hidden" name="intent" value="reject_proposal" />
                  <input
                    type="hidden"
                    name="proposal_id"
                    value={proposal.id}
                  />
                  <Button submit disabled={busy}>
                    Reject proposal
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="accept_proposal" />
                  <input
                    type="hidden"
                    name="proposal_id"
                    value={proposal.id}
                  />
                  <Button submit variant="primary" disabled={busy}>
                    Accept proposal
                  </Button>
                </Form>
              </InlineStack>
            </BlockStack>
          </Banner>
        ))}
      </BlockStack>
    </Card>
  );
}
