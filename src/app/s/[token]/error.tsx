"use client";

export default function SupplierLinkError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="supplier-shell">
      <div className="supplier-header">
        <h1>Link unavailable</h1>
      </div>
      <div className="supplier-body">
        <p className="small">This purchase order could not be opened.</p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
