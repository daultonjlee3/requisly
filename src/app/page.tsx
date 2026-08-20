import type { ReactNode } from "react";
import Link from "next/link";
import {
  INSTALL_HREF,
  pageMetadata,
  SITE_URL,
  SUPPORT_EMAIL,
} from "@/lib/site";

const HEADLINE =
  "The procurement platform for Shopify brands — POs your suppliers actually confirm.";

const PITCH =
  "Requisly lets a supplier confirm a purchase order from a link, without creating an account.";

export const metadata = pageMetadata({
  title: "Requisly — The procurement platform for Shopify brands",
  description: `${PITCH} $149/month, 14-day free trial.`,
  path: "/",
});

const FAQ = [
  {
    question: "Does my supplier need to create an account?",
    answer:
      "No. Supplier Link lets a supplier view, confirm, propose changes to, or update the status of a purchase order via a unique link, without creating an account. You are responsible for the contact information you provide for your suppliers.",
  },
  {
    question: "What does it cost?",
    answer:
      "Requisly is $149/month, with a 14-day free trial. The app is billed through the Shopify Billing API.",
  },
  {
    question: "Does it work with QuickBooks?",
    answer:
      "Yes. You can optionally connect QuickBooks Online. Your use of QuickBooks is governed by its own terms; we are not responsible for the availability, accuracy, or performance of third-party services.",
  },
  {
    question: "Are AI features extra?",
    answer:
      "No. AI insights are included. The app uses AI (including Anthropic's Claude) to generate summaries, insights, and suggestions from your store's data. It does not automatically send purchase orders, execute payments, or take other binding actions without your review and confirmation.",
  },
] as const;

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Requisly",
      url: SITE_URL,
      description: `${HEADLINE} ${PITCH}`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "149",
        priceCurrency: "USD",
        description: "$149/month, 14-day free trial, billed through Shopify Billing.",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ],
};

export default function MarketingHomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f7f5f2",
        color: "#1a1a1a",
        padding: "48px 24px 80px",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article style={{ maxWidth: 720, margin: "0 auto" }}>
        <p style={{ margin: 0, fontSize: 14, color: "#5c5c5c" }}>Requisly</p>
        <h1
          style={{
            margin: "16px 0 0",
            fontSize: "clamp(1.75rem, 4vw, 2.25rem)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.25,
          }}
        >
          {HEADLINE}
        </h1>
        <p
          style={{
            margin: "16px 0 0",
            fontSize: 15,
            lineHeight: 1.6,
            color: "#2c2c2c",
          }}
        >
          {PITCH} Merchants create, send, and track purchase orders inside
          Shopify Admin. Suppliers confirm and ship from that link.
        </p>

        <a
          href={INSTALL_HREF}
          style={{
            display: "inline-block",
            marginTop: 28,
            padding: "12px 18px",
            background: "#1a1a1a",
            color: "#f7f5f2",
            textDecoration: "none",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Install from the Shopify App Store
        </a>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#5c5c5c" }}>
          Listing is not live yet. Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#5c5c5c" }}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>

        <Section title="What you get">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              <strong>Supplier Link.</strong> Suppliers view, confirm, propose
              changes to, or update PO status from a unique link, without
              creating an account.
            </li>
            <li>
              <strong>Real pricing catalog.</strong> Manage supplier
              relationships and pricing.
            </li>
            <li>
              <strong>AI insights included.</strong> Summaries, insights, and
              suggestions from your store&apos;s data.
            </li>
            <li>
              <strong>QuickBooks integration.</strong> Optionally connect
              QuickBooks Online.
            </li>
            <li>
              <strong>Report builder.</strong> Report Builder can show revenue /
              sell-through against procurement spend when you grant optional
              Orders access.
            </li>
          </ul>
        </Section>

        <Section title="Pricing">
          <p style={{ margin: 0 }}>$149/month, 14-day free trial.</p>
        </Section>

        <Section title="FAQ">
          {FAQ.map((item) => (
            <div key={item.question} style={{ marginTop: 20 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: "1rem",
                  fontWeight: 600,
                }}
              >
                {item.question}
              </h3>
              <p style={{ margin: "8px 0 0" }}>{item.answer}</p>
            </div>
          ))}
        </Section>

        <p style={{ marginTop: 40, fontSize: 14, color: "#5c5c5c" }}>
          <Link href="/privacy">Privacy Policy</Link>
          {" · "}
          <Link href="/terms">Terms of Service</Link>
          {" · "}
          <Link href="/login">Staff invite sign-in</Link>
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
