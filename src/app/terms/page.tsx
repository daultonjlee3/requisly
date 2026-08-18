import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Requisly",
  description:
    "Terms of Service for the Requisly Shopify app for purchase orders and supplier management.",
};

export default function TermsOfServicePage() {
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
          Terms of Service
        </h1>
        <p style={{ margin: "8px 0 0", color: "#5c5c5c", fontSize: 14 }}>
          Last updated: August 2026
        </p>

        <Section title="1. Agreement to Terms">
          <p>
            By installing or using Requisly ("the App," "we," "us," "our"), you
            ("Merchant," "you") agree to these Terms of Service. If you do not
            agree, do not install or use the App.
          </p>
        </Section>

        <Section title="2. The Service">
          <p>
            Requisly is a Shopify-embedded purchase order and supplier
            management application. The App enables Merchants to create, send,
            and track purchase orders; manage supplier relationships and
            pricing; receive inventory; and optionally connect third-party
            accounting services (e.g., QuickBooks Online).
          </p>
        </Section>

        <Section title="3. Account and Eligibility">
          <p>
            You must have an active Shopify store and the authority to bind that
            store's business to these Terms. You are responsible for all
            activity that occurs through your connected Shopify account.
          </p>
        </Section>

        <Section title="4. Subscription and Billing">
          <p>
            The App is offered on a subscription basis through the Shopify
            Billing API. Current pricing, trial terms, and billing cycles are
            set out in the App's Shopify App Store listing and may be updated
            from time to time; any changes will be presented to you through
            Shopify's standard billing consent flow before taking effect.
          </p>
        </Section>

        <Section title="5. Supplier Link">
          <p>
            The App includes a feature ("Supplier Link") that allows your
            suppliers to view, confirm, propose changes to, or update the status
            of purchase orders via a unique link, without creating an account.
            You are responsible for the accuracy of the contact information you
            provide for your suppliers, and for any communications sent to them
            through the App on your behalf.
          </p>
        </Section>

        <Section title="6. Third-Party Integrations">
          <p>
            The App may integrate with third-party services (including Shopify,
            QuickBooks Online, and email delivery providers) to provide its
            functionality. Your use of those third-party services is governed by
            their own terms. We are not responsible for the availability,
            accuracy, or performance of third-party services.
          </p>
        </Section>

        <Section title="7. Artificial Intelligence Features">
          <p>
            The App includes features that use AI (including Anthropic's Claude)
            to generate summaries, insights, and suggestions based on your
            store's data. These outputs are provided for informational purposes
            and are not a substitute for your own business judgment. The App
            does not use AI to automatically send purchase orders, execute
            payments, or take other binding actions on your behalf without your
            review and confirmation.
          </p>
        </Section>

        <Section title="8. Data and Privacy">
          <p>
            Our collection and use of data is described in our{" "}
            <Link href="/privacy">Privacy Policy</Link>, which is incorporated
            into these Terms by reference.
          </p>
        </Section>

        <Section title="9. Your Responsibilities">
          <p>
            You agree to use the App only for lawful business purposes, to
            provide accurate information, and not to misuse the App in any way
            that could harm Requisly, Shopify, other merchants, or your
            suppliers.
          </p>
        </Section>

        <Section title="10. Intellectual Property">
          <p>
            The App, including its design, code, and content, is owned by
            Requisly and protected by applicable intellectual property laws.
            These Terms do not grant you any rights to our intellectual property
            beyond the right to use the App as intended.
          </p>
        </Section>

        <Section title="11. Disclaimer of Warranties">
          <p>
            The App is provided "as is" and "as available," without warranties
            of any kind, express or implied. We do not warrant that the App will
            be uninterrupted, error-free, or that any data (including
            AI-generated content or third-party financial integrations) will be
            entirely accurate. You are responsible for verifying financial and
            accounting data before relying on it.
          </p>
        </Section>

        <Section title="12. Limitation of Liability">
          <p>
            To the maximum extent permitted by law, Requisly shall not be liable
            for any indirect, incidental, special, or consequential damages
            arising from your use of the App, including but not limited to lost
            profits, lost data, or business interruption.
          </p>
        </Section>

        <Section title="13. Termination">
          <p>
            You may stop using the App at any time by uninstalling it through
            Shopify. We may suspend or terminate access to the App for violation
            of these Terms or for any reason permitted under our agreement with
            Shopify.
          </p>
        </Section>

        <Section title="14. Changes to These Terms">
          <p>
            We may update these Terms from time to time. Continued use of the
            App after changes take effect constitutes acceptance of the updated
            Terms.
          </p>
        </Section>

        <Section title="15. Contact">
          <p>
            Questions about these Terms can be sent to{" "}
            <a href="mailto:support@requisly.com">support@requisly.com</a>.
          </p>
        </Section>

        <p style={{ marginTop: 40, fontSize: 14, color: "#5c5c5c" }}>
          <Link href="/privacy">Privacy Policy</Link>
          {" · "}
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
