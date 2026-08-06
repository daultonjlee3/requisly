import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { createSupplier } from "@/lib/actions/suppliers";

export default function NewSupplierPage() {
  return (
    <>
      <Topbar
        title="Add supplier"
        subline="Name and email required — everything else later"
        actions={
          <Link href="/suppliers" className="btn btn-secondary">
            Cancel
          </Link>
        }
      />
      <div className="content" style={{ maxWidth: 560 }}>
        <form action={createSupplier} className="card">
          <div className="card-body stack" style={{ gap: 14 }}>
            <div>
              <label className="field-label" htmlFor="name">
                Name
              </label>
              <input id="name" name="name" className="field" required />
            </div>
            <div>
              <label className="field-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="field"
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="contact_name">
                Contact name <span className="muted">(optional)</span>
              </label>
              <input id="contact_name" name="contact_name" className="field" />
            </div>
            <div>
              <label className="field-label" htmlFor="phone">
                Phone <span className="muted">(optional)</span>
              </label>
              <input id="phone" name="phone" className="field" />
            </div>
            <div>
              <label className="field-label" htmlFor="payment_terms">
                Payment terms <span className="muted">(optional)</span>
              </label>
              <input
                id="payment_terms"
                name="payment_terms"
                className="field"
                placeholder="e.g. Net 30"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="notes">
                Notes <span className="muted">(optional)</span>
              </label>
              <textarea id="notes" name="notes" className="field" rows={3} />
            </div>
            <button type="submit" className="btn btn-primary">
              Save supplier
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
