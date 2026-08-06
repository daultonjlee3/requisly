"use client";

import { useTransition } from "react";
import { closePurchaseOrder } from "@/lib/actions/purchase-orders";

export function ClosePoButton({ poId }: { poId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={pending}
      onClick={() => {
        if (
          confirm(
            "Close this PO for a permanent shortfall? Remaining units will not be expected.",
          )
        ) {
          startTransition(() => {
            void closePurchaseOrder(poId);
          });
        }
      }}
    >
      {pending ? "Closing…" : "Close PO"}
    </button>
  );
}
