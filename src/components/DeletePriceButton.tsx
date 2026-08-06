"use client";

import { useTransition } from "react";
import { deleteSupplierProductPrice } from "@/lib/actions/products";

export function DeletePriceButton({
  priceId,
  label,
}: {
  priceId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      disabled={pending}
      aria-label={`Delete price ${label}`}
      onClick={() => {
        if (
          confirm(
            `Delete this price entry (${label})? Current unit cost will update from the remaining schedule.`,
          )
        ) {
          startTransition(() => {
            void deleteSupplierProductPrice(priceId);
          });
        }
      }}
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}
