import Link from "next/link";

export default function MarketingHomePage() {
  return (
    <main className="min-h-full">
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "48px 24px",
          background:
            "radial-gradient(1200px 600px at 10% -10%, #e8eef5 0%, transparent 55%), radial-gradient(900px 500px at 100% 0%, #f3eee6 0%, transparent 50%), #f7f5f2",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-display-loaded), Georgia, serif",
              fontSize: "clamp(2.75rem, 8vw, 4.5rem)",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              color: "#1a1a1a",
            }}
          >
            Requisly
          </p>
          <h1
            style={{
              margin: "20px 0 0",
              fontSize: "clamp(1.25rem, 3vw, 1.75rem)",
              fontWeight: 500,
              lineHeight: 1.35,
              color: "#2c2c2c",
              maxWidth: "18ch",
            }}
          >
            Purchase orders for Shopify brands
          </h1>
          <p
            style={{
              margin: "16px 0 0",
              fontSize: "1.05rem",
              lineHeight: 1.55,
              color: "#5c5c5c",
              maxWidth: "36ch",
            }}
          >
            Merchants run procurement inside Shopify Admin. Suppliers confirm
            and ship from a no-login link.
          </p>
          <div style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a
              href="https://app.requisly.com"
              className="btn btn-primary"
              style={{ textDecoration: "none" }}
            >
              Open the Shopify app
            </a>
            <Link href="/login" className="btn" style={{ textDecoration: "none" }}>
              Staff invite sign-in
            </Link>
          </div>
          <p style={{ marginTop: 40, fontSize: 13, color: "#5c5c5c" }}>
            <Link href="/privacy" style={{ color: "#5c5c5c" }}>
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
