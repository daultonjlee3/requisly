"use server";

import { redirect } from "next/navigation";
import { redeemOneClickToken } from "@/lib/supplier-one-click.server";

export async function confirmOneClickAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) {
    redirect("/");
  }
  const result = await redeemOneClickToken(token);
  if (result.ok) {
    redirect(`/a/${token}?done=1`);
  }
  redirect(`/a/${token}?err=${encodeURIComponent(result.error)}`);
}
