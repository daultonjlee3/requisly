import Link from "next/link";
import { startShopifyOAuth } from "@/lib/actions/shopify";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { workspace } = await getSessionContext();
  const supabase = await createClient();

  const { data: ws } = await supabase
    .from("workspaces")
    .select("id, name, shopify_domain, shopify_synced_at")
    .eq("id", workspace!.id)
    .maybeSingle();

  const connected = Boolean(ws?.shopify_domain);

  return (
    <div className="onboard-card">
      <div className="onboard-brand">
        <div className="brand-mark">R</div>
        <div
          className="brand-name"
          style={{
            color: "var(--ink)",
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 16,
          }}
        >
          Requisly
        </div>
      </div>

      <h2
        style={{
          fontFamily: "var(--font-display)",
          textAlign: "center",
          fontSize: 19,
          margin: "0 0 6px",
        }}
      >
        {connected ? "Shopify connected" : "Connect your Shopify store"}
      </h2>
      <p
        className="small muted"
        style={{ textAlign: "center", margin: "0 0 8px" }}
      >
        Connecting to workspace{" "}
        <strong style={{ color: "var(--ink)" }}>{ws?.name}</strong>
        {" — "}
        switch workspaces in the sidebar first if this isn’t Salt &amp; Fern.
      </p>
      <p
        className="small muted"
        style={{ textAlign: "center", margin: "0 0 24px" }}
      >
        Requisly syncs products, variants, locations, and inventory so you can
        build purchase orders from your real catalog — no CSV imports.
      </p>

      {error ? (
        <div
          className="chip chip-alert"
          style={{
            display: "flex",
            width: "100%",
            marginBottom: 16,
            whiteSpace: "normal",
            height: "auto",
            padding: "10px 12px",
          }}
        >
          {error}
        </div>
      ) : null}

      {connected ? (
        <div className="stack" style={{ gap: 14 }}>
          <div className="connect-row">
            <div className="shopify-mark">S</div>
            <div style={{ flex: 1 }}>
              <div className="field-label" style={{ marginBottom: 2 }}>
                Connected store
              </div>
              <div className="mono" style={{ fontSize: 13.5 }}>
                {ws!.shopify_domain}
              </div>
              {ws?.shopify_synced_at ? (
                <div className="small muted" style={{ marginTop: 4 }}>
                  Last synced{" "}
                  {new Date(ws.shopify_synced_at).toLocaleString("en-US")}
                </div>
              ) : null}
            </div>
          </div>
          <Link
            href="/products"
            className="btn btn-primary"
            style={{ width: "100%", justifyContent: "center", padding: 11 }}
          >
            Go to Products →
          </Link>
          <Link
            href="/products"
            className="btn btn-secondary"
            style={{ width: "100%", justifyContent: "center" }}
          >
            Resync from Products
          </Link>
        </div>
      ) : (
        <form action={startShopifyOAuth}>
          <div className="connect-row">
            <div className="shopify-mark">S</div>
            <div style={{ flex: 1 }}>
              <label
                className="field-label"
                htmlFor="shop"
                style={{ marginBottom: 5 }}
              >
                Your store&apos;s .myshopify.com domain
              </label>
              <input
                id="shop"
                name="shop"
                className="field"
                required
                placeholder="salt-and-fern.myshopify.com"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="permission-list">
            <div className="permission-item">
              <span className="check">✓</span> Read products, variants &amp;
              inventory levels
            </div>
            <div className="permission-item">
              <span className="check">✓</span> Write inventory adjustments on
              receiving
            </div>
            <div className="permission-item">
              <span className="check">✓</span> Read locations
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", justifyContent: "center", padding: 11 }}
          >
            Connect with Shopify →
          </button>
        </form>
      )}

      <div className="step-dots">
        <div className="step-dot active" />
        <div className="step-dot" />
        <div className="step-dot" />
      </div>

      <p
        className="small muted"
        style={{ textAlign: "center", margin: "18px 0 0" }}
      >
        <Link href="/" style={{ textDecoration: "underline" }}>
          Back to Today&apos;s Work
        </Link>
      </p>
    </div>
  );
}
