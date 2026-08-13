import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  acceptInvite,
  loadInvitePreview,
} from "@/lib/actions/invites";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function InvitePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { error: queryError } = await searchParams;
  const { preview, error } = await loadInvitePreview(token);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  async function acceptAction() {
    "use server";
    const result = await acceptInvite(token);
    if (!result.ok) {
      redirect(`/invite/${token}?error=${encodeURIComponent(result.error)}`);
    }
    redirect("/");
  }

  return (
    <div
      className="card"
      style={{ width: "100%", maxWidth: 440, boxShadow: "var(--shadow-lg)" }}
    >
      <div className="card-header">
        <div className="row">
          <div className="brand-mark" style={{ width: 28, height: 28 }}>
            R
          </div>
          <h3>Workspace invite</h3>
        </div>
      </div>
      <div className="card-body">
        {queryError ? (
          <p
            className="small"
            style={{ color: "var(--status-alert)", margin: "0 0 12px" }}
          >
            {queryError}
          </p>
        ) : null}
        {error || !preview ? (
          <p className="small" style={{ color: "var(--status-alert)", margin: 0 }}>
            {error ?? "This invite link is invalid."}
          </p>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            <p style={{ margin: 0 }}>
              You’ve been invited to{" "}
              <strong>{preview.workspaceName}</strong>
              {preview.invitedByLabel
                ? ` by ${preview.invitedByLabel}`
                : ""}
              .
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              Use <strong>{preview.email}</strong> to accept. Role:{" "}
              {preview.role}.
            </p>

            {user ? (
              <form action={acceptAction}>
                <button className="btn btn-primary" type="submit">
                  Accept invite
                </button>
              </form>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                <Link
                  className="btn btn-primary"
                  href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                >
                  Sign in to accept
                </Link>
                <p className="small muted" style={{ margin: 0 }}>
                  New here?{" "}
                  <Link
                    href={`/signup?next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(preview.email)}`}
                    style={{ color: "var(--accent)", fontWeight: 600 }}
                  >
                    Create an account
                  </Link>{" "}
                  with that email, then accept.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
