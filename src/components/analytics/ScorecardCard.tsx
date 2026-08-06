import Link from "next/link";
import {
  SCORECARD_MIN_COMPLETED_POS,
  daysLabel,
  hasEnoughScorecardHistory,
  pctLabel,
  type SupplierScorecard,
} from "@/lib/analytics";
import { supplierInitials } from "@/lib/format";

type TrendPoint = {
  month: string;
  label: string;
  onTimePct: number | null;
  completed: number;
};

export function ScorecardCard({
  supplierId,
  supplierName,
  scorecard,
  trend,
}: {
  supplierId: string;
  supplierName: string;
  scorecard: SupplierScorecard | null;
  trend: TrendPoint[];
}) {
  const completed = scorecard?.completed_pos ?? 0;
  const enough = hasEnoughScorecardHistory(completed);

  return (
    <div className="card scorecard-card">
      <div className="card-header">
        <div className="row" style={{ gap: 10 }}>
          <div className="supplier-avatar">{supplierInitials(supplierName)}</div>
          <div>
            <h3 style={{ margin: 0 }}>
              <Link href={`/suppliers/${supplierId}`}>{supplierName}</Link>
            </h3>
            <div className="small muted">
              {completed} closed PO{completed === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </div>
      <div className="card-body">
        {!enough ? (
          <div className="analytics-insufficient">
            <strong>Not enough history yet</strong>
            <p>
              Scorecards need at least {SCORECARD_MIN_COMPLETED_POS} completed
              purchase orders. This supplier has {completed}.
            </p>
          </div>
        ) : (
          <>
            <div className="scorecard-metrics">
              <Metric
                label="On-time"
                value={pctLabel(scorecard?.on_time_pct)}
                tone={metricTone(scorecard?.on_time_pct, 0.8, 0.6)}
              />
              <Metric
                label="Fill rate"
                value={pctLabel(scorecard?.fill_rate)}
                tone={metricTone(scorecard?.fill_rate, 0.95, 0.85)}
              />
              <Metric
                label="Avg confirm"
                value={daysLabel(scorecard?.avg_confirmation_days)}
              />
              <Metric
                label="Lead variance"
                value={daysLabel(scorecard?.avg_lead_time_variance_days)}
              />
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="field-label" style={{ marginBottom: 8 }}>
                On-time trend
              </div>
              {trend.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>
                  No monthly points yet.
                </p>
              ) : (
                <div className="analytics-bars">
                  {trend.map((point) => (
                    <div key={point.month} className="analytics-bar-row">
                      <div className="analytics-bar-label mono">{point.label}</div>
                      <div className="analytics-bar-track">
                        <div
                          className="analytics-bar-fill"
                          style={{
                            width: `${Math.round((point.onTimePct ?? 0) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="analytics-bar-value mono">
                        {pctLabel(point.onTimePct)}
                        <span className="muted" style={{ marginLeft: 6 }}>
                          n={point.completed}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="stat-mini" style={{ textAlign: "left", padding: "8px 0" }}>
      <div
        className="num"
        style={{
          fontSize: 20,
          color:
            tone === "good"
              ? "var(--status-received)"
              : tone === "bad"
                ? "var(--status-alert)"
                : tone === "warn"
                  ? "var(--status-transit)"
                  : undefined,
        }}
      >
        {value}
      </div>
      <div className="label">{label}</div>
    </div>
  );
}

function metricTone(
  value: number | null | undefined,
  goodAt: number,
  warnAt: number,
): "good" | "warn" | "bad" | undefined {
  if (value == null) return undefined;
  if (value >= goodAt) return "good";
  if (value >= warnAt) return "warn";
  return "bad";
}
