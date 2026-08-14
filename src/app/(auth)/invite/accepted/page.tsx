import Link from "next/link";

export default function InviteAcceptedPage() {
  return (
    <div
      className="card"
      style={{ width: "100%", maxWidth: 440, boxShadow: "var(--shadow-lg)" }}
    >
      <div className="card-header">
        <h3 style={{ margin: 0 }}>You’re in</h3>
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        <p style={{ margin: 0 }}>
          Your workspace invite is accepted. Open the merchant app from Shopify
          Admin to continue.
        </p>
        <a
          className="btn btn-primary"
          href="https://app.requisly.com"
          style={{ textDecoration: "none", textAlign: "center" }}
        >
          Open Requisly in Shopify
        </a>
        <p className="small muted" style={{ margin: 0 }}>
          <Link href="/">Back to requisly.com</Link>
        </p>
      </div>
    </div>
  );
}
