"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

type Line = {
  id: string;
  description: string;
  sku: string | null;
  qty: number;
};

type Payload = {
  error?: string;
  quote_request?: {
    title: string;
    notes: string | null;
    needed_by: string | null;
    workspace_name: string;
    status: string;
  };
  supplier?: { name: string };
  lines?: Line[];
  responses?: Array<{
    quote_request_line_id: string;
    unit_cost: number;
    lead_time_days: number | null;
  }>;
  can_respond?: boolean;
};

export function QuoteRequestLinkClient({ token }: { token: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [leads, setLeads] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    supabase
      .rpc("quote_request_link_get", { p_token: token })
      .then(({ data: payload, error: err }) => {
        if (err) {
          setError(err.message);
          return;
        }
        const parsed = payload as Payload;
        if (parsed.error) {
          setError(parsed.error);
          return;
        }
        setData(parsed);
        const nextCosts: Record<string, string> = {};
        const nextLeads: Record<string, string> = {};
        for (const r of parsed.responses ?? []) {
          nextCosts[r.quote_request_line_id] = String(r.unit_cost);
          if (r.lead_time_days != null) {
            nextLeads[r.quote_request_line_id] = String(r.lead_time_days);
          }
        }
        setCosts(nextCosts);
        setLeads(nextLeads);
      });
  }, [token]);

  function submit() {
    startTransition(async () => {
      setSaved(false);
      setError(null);
      const responses = (data?.lines ?? [])
        .map((line) => {
          const unit = Number(costs[line.id]);
          if (!Number.isFinite(unit) || unit < 0) return null;
          const leadRaw = leads[line.id]?.trim();
          return {
            quote_request_line_id: line.id,
            unit_cost: unit,
            lead_time_days: leadRaw ? Number(leadRaw) : null,
            notes: null,
          };
        })
        .filter(Boolean);

      const supabase = createClient();
      const { data: result, error: err } = await supabase.rpc(
        "quote_request_link_submit",
        { p_token: token, p_responses: responses },
      );
      if (err) {
        setError(err.message);
        return;
      }
      const ok = (result as { ok?: boolean; error?: string })?.ok;
      if (!ok) {
        setError((result as { error?: string })?.error ?? "Submit failed");
        return;
      }
      setSaved(true);
    });
  }

  if (error && !data) {
    return (
      <main className="supplier-link">
        <div className="card">
          <h1>Quote link unavailable</h1>
          <p className="muted">{error}</p>
        </div>
      </main>
    );
  }

  if (!data?.quote_request) {
    return (
      <main className="supplier-link">
        <div className="card">
          <p className="muted">Loading quote request…</p>
        </div>
      </main>
    );
  }

  const qr = data.quote_request;

  return (
    <main className="supplier-link">
      <div className="card">
        <p className="eyebrow">{qr.workspace_name}</p>
        <h1>Quote request</h1>
        <p className="lede">
          Hi {data.supplier?.name}, please enter unit price and lead time for
          each line.
        </p>
        <h2>{qr.title}</h2>
        {qr.needed_by ? (
          <p className="muted">Needed by {qr.needed_by}</p>
        ) : null}
        {qr.notes ? <p className="muted">{qr.notes}</p> : null}

        {saved ? (
          <p className="status-confirmed">Thanks — your quote was saved.</p>
        ) : null}
        {error ? <p className="status-alert">{error}</p> : null}

        <table className="lines">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Lead days</th>
            </tr>
          </thead>
          <tbody>
            {(data.lines ?? []).map((line) => (
              <tr key={line.id}>
                <td>
                  {line.description}
                  {line.sku ? (
                    <span className="muted"> · {line.sku}</span>
                  ) : null}
                </td>
                <td className="mono">{line.qty}</td>
                <td>
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    step="0.01"
                    value={costs[line.id] ?? ""}
                    disabled={!data.can_respond || pending}
                    onChange={(e) =>
                      setCosts((prev) => ({
                        ...prev,
                        [line.id]: e.target.value,
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    step={1}
                    value={leads[line.id] ?? ""}
                    disabled={!data.can_respond || pending}
                    onChange={(e) =>
                      setLeads((prev) => ({
                        ...prev,
                        [line.id]: e.target.value,
                      }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {data.can_respond ? (
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={submit}
          >
            {pending ? "Saving…" : "Submit quote"}
          </button>
        ) : (
          <p className="muted">This quote request is closed for responses.</p>
        )}
      </div>
    </main>
  );
}
