import { redirect } from "next/navigation";

/** Calendar is a PO view lens, not a standalone module. */
export default function CalendarRedirectPage() {
  redirect("/purchase-orders?view=calendar");
}
