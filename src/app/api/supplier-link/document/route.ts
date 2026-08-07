import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "po-documents";

/**
 * Signed download for a PO document, gated by a valid Supplier Link token.
 * Query: ?token=…&documentId=…
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() ?? "";
  const documentId = searchParams.get("documentId")?.trim() ?? "";

  if (!token || !documentId) {
    return NextResponse.json(
      { error: "token and documentId are required" },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();

    const { data: link, error: linkError } = await admin
      .from("supplier_link_tokens")
      .select("po_id")
      .eq("token", token)
      .maybeSingle();

    if (linkError || !link?.po_id) {
      return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    }

    const { data: doc, error: docError } = await admin
      .from("po_documents")
      .select("id, file_path, file_name")
      .eq("id", documentId)
      .eq("po_id", link.po_id)
      .maybeSingle();

    if (docError || !doc?.file_path) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const { data: signed, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(doc.file_path, 60 * 60);

    if (signError || !signed?.signedUrl) {
      return NextResponse.json(
        { error: signError?.message ?? "Could not sign download" },
        { status: 500 },
      );
    }

    return NextResponse.redirect(signed.signedUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
