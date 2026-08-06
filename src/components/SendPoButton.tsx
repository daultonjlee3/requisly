"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendPurchaseOrder } from "@/lib/actions/purchase-orders";

export function SendPoButton({ poId }: { poId: string }) {
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSend() {
    setLoading(true);
    setError(null);
    try {
      const token = await sendPurchaseOrder(poId);
      const url = `${window.location.origin}/s/${token}`;
      setLink(url);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onSend}
        disabled={loading}
      >
        {loading ? "Sending…" : link ? "Refresh Supplier Link" : "Send to supplier"}
      </button>
      {error ? (
        <p className="small" style={{ color: "var(--status-alert)", margin: 0 }}>
          {error}
        </p>
      ) : null}
      {link ? (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Email not wired yet — open this Supplier Link as the supplier (incognito):
          </div>
          <div className="copy-box">
            <a href={link} target="_blank" rel="noreferrer" style={{ flex: 1, color: "var(--accent)" }}>
              {link}
            </a>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigator.clipboard.writeText(link)}
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
