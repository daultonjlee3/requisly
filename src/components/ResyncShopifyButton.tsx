"use client";

import { useState, useTransition } from "react";
import { resyncShopifyCatalog } from "@/lib/actions/shopify";

export function ResyncShopifyButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  return (
    <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await resyncShopifyCatalog();
            setOk(result.ok);
            setMessage(result.message);
          });
        }}
      >
        {pending ? "Syncing…" : "Resync Shopify"}
      </button>
      {message ? (
        <span
          className={`small ${ok ? "muted" : ""}`}
          style={ok === false ? { color: "var(--status-alert)" } : undefined}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
