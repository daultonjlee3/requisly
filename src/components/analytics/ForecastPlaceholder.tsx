export function ForecastPlaceholder() {
  return (
    <div className="card">
      <div className="card-header">
        <h3>Demand forecasting</h3>
        <span className="chip chip-idle">
          <span className="chip-dot" />
          Not available
        </span>
      </div>
      <div className="card-body">
        <div className="analytics-insufficient" style={{ maxWidth: 520 }}>
          <strong>Coming once you have real order history</strong>
          <p>
            Forecasting is the moat — it only unlocks after lead-time and
            fill-rate history is real and can&apos;t be replicated by a fresh
            install. Seeded demo data is not used to invent forecast numbers.
          </p>
        </div>
      </div>
    </div>
  );
}
