import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Requisly",
  description:
    "How Requisly processes merchant and order data for Shopify procurement and inventory reporting.",
};

const updated = "August 14, 2026";

export default function PrivacyPolicyPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f7f5f2",
        color: "#1a1a1a",
        padding: "48px 24px 80px",
      }}
    >
      <article style={{ maxWidth: 720, margin: "0 auto" }}>
        <p style={{ margin: 0, fontSize: 14, color: "#5c5c5c" }}>
          <Link href="/" style={{ color: "#1a1a1a" }}>
            Requisly
          </Link>
        </p>
        <h1
          style={{
            margin: "16px 0 0",
            fontSize: "clamp(1.75rem, 4vw, 2.25rem)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Privacy Policy
        </h1>
        <p style={{ margin: "8px 0 0", color: "#5c5c5c", fontSize: 14 }}>
          Last updated {updated}
        </p>

        <Section title="Who we are">
          <p>
            Requisly (“we”, “us”) provides a Shopify embedded app for merchant
            procurement: purchase orders, supplier collaboration, inventory
            reporting, and related workflows. This policy explains what data we
            process when a merchant installs and uses Requisly.
          </p>
          <p>
            Contact:{" "}
            <a href="mailto:daultonjlee3@gmail.com">daultonjlee3@gmail.com</a>{" "}
            (API / privacy contact registered with Shopify for this app).
          </p>
        </Section>

        <Section title="Roles">
          <p>
            For storefront customer data obtained through Shopify APIs, the
            merchant is typically the controller and Requisly acts as a
            processor on the merchant’s behalf, limited to providing the app’s
            features. For account and billing data about the merchant or their
            staff, we process that information to operate the service.
          </p>
        </Section>

        <Section title="What we collect from merchants">
          <ul>
            <li>
              Shopify shop domain, install/session metadata, and OAuth access
              scopes (including optional <code>read_orders</code> when granted).
            </li>
            <li>
              Offline access and refresh tokens needed to call Shopify Admin APIs
              on the merchant’s behalf (stored server-side).
            </li>
            <li>
              Workspace data the merchant enters: suppliers, contacts, purchase
              orders, receipts, catalog mappings, notification settings, and
              similar B2B procurement records.
            </li>
            <li>
              Staff invite / auth identifiers for users who sign in to the
              merchant-facing web surfaces.
            </li>
            <li>
              Operational logs needed to run and secure the service (for example
              webhook delivery and compliance audit events).
            </li>
          </ul>
        </Section>

        <Section title="Shopify Orders data (protected customer data)">
          <p>
            When a merchant grants optional <code>read_orders</code>, we sync a
            read-only Orders cache for Report Builder and inventory / sell-through
            planning. We request <strong>Level 1</strong> protected customer data
            only — Order resources and line economics — not identifying customer
            fields.
          </p>
          <p>We store:</p>
          <ul>
            <li>Order id and order name</li>
            <li>Processed date/time</li>
            <li>Order currency and total</li>
            <li>
              Line items: title, SKU, quantity, unit price, and variant id
            </li>
            <li>
              Order tags / note when needed to exclude synthetic test orders
            </li>
          </ul>
          <p>
            We do <strong>not</strong> request or intentionally store customer
            name, email, phone, or address for this feature. Supplier and staff
            emails the merchant enters are B2B contact data for procurement, not
            storefront customer PII collected from Shopify Customers APIs.
          </p>
        </Section>

        <Section title="How we use data">
          <ul>
            <li>
              Provide procurement, receiving, supplier-link, reporting, and
              inventory planning features inside Shopify Admin and related
              surfaces.
            </li>
            <li>
              Reconcile purchase-order spend with sell-through using the Orders
              cache when <code>read_orders</code> is granted.
            </li>
            <li>
              Authenticate the app, enforce billing, deliver transactional
              notifications the merchant configures, and meet Shopify’s
              mandatory privacy webhooks.
            </li>
          </ul>
          <p>
            We do not sell personal data. We do not use storefront customer data
            for advertising or unrelated profiling. Processing is limited to the
            purposes described here and in the product UI (for example the
            optional Orders scope grant for Report Builder).
          </p>
        </Section>

        <Section title="Sharing">
          <p>
            We use infrastructure processors such as hosting, database, and
            email delivery providers to operate Requisly. They process data only
            to provide those services to us. We do not sell merchant or customer
            data to third parties.
          </p>
        </Section>

        <Section title="Retention">
          <p>
            We retain workspace and synced Orders data while the merchant uses
            Requisly and the relevant features remain enabled. We delete or
            anonymize data when it is no longer needed for those purposes, and
            we honor Shopify’s mandatory compliance webhooks:
          </p>
          <ul>
            <li>
              <code>customers/data_request</code> — compile any stored data
              tied to a customer when Shopify asks
            </li>
            <li>
              <code>customers/redact</code> — delete matching Orders-cache rows
              and related records
            </li>
            <li>
              <code>shop/redact</code> / uninstall — purge the shop’s workspace
              data after the required timeline
            </li>
          </ul>
        </Section>

        <Section title="Security">
          <p>
            Data is transmitted over HTTPS. Application data and sessions are
            stored in hosted databases with encryption at rest provided by our
            infrastructure vendors. Access tokens and service credentials are
            kept server-side and not exposed to the browser.
          </p>
        </Section>

        <Section title="Consent, sales opt-out, and automated decisions">
          <p>
            Requisly does not sell personal data and does not run customer-facing
            marketing consent flows. Automated reporting or reorder suggestions
            are tools for the merchant’s operations; they are not intended to
            produce legal or similarly significant effects on individual
            customers. Where laws give customers access, correction, or deletion
            rights, merchants (and Shopify’s compliance webhooks) are the primary
            path; we process those webhook requests as described above.
          </p>
        </Section>

        <Section title="Merchant transparency">
          <p>
            Merchants choose whether to grant optional Orders access. In-app
            copy explains that <code>read_orders</code> is used so Report Builder
            can show revenue / sell-through against procurement spend. This
            privacy policy is the written agreement describing that processing.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Requisly is a B2B Shopify app for merchants and is not directed at
            children.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update this policy as the product changes. The “Last updated”
            date at the top will change when we do. Material changes that affect
            Shopify protected customer data use will be reflected here before or
            as those features ship.
          </p>
        </Section>

        <p style={{ marginTop: 40, fontSize: 14, color: "#5c5c5c" }}>
          <Link href="/">← Back to Requisly</Link>
        </p>
      </article>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: 32 }}>
      <h2
        style={{
          margin: 0,
          fontSize: "1.125rem",
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
      <div
        style={{
          marginTop: 10,
          fontSize: 15,
          lineHeight: 1.6,
          color: "#2c2c2c",
        }}
      >
        {children}
      </div>
    </section>
  );
}
