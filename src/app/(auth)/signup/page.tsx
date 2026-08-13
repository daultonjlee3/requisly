"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const safeNext =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/";
  const [fullName, setFullName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          workspace_name: workspaceName || "My Workspace",
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // If email confirmation is disabled, session is present immediately.
    if (data.session) {
      router.push(safeNext);
      router.refresh();
      return;
    }

    setMessage("Check your email to confirm your account, then sign in.");
  }

  return (
    <div className="card" style={{ width: "100%", maxWidth: 420, boxShadow: "var(--shadow-lg)" }}>
      <div className="card-header">
        <div className="row">
          <div className="brand-mark" style={{ width: 28, height: 28 }}>
            R
          </div>
          <h3>Create your workspace</h3>
        </div>
      </div>
      <div className="card-body">
        <form onSubmit={onSubmit} className="stack" style={{ gap: 14 }}>
          <div>
            <label className="field-label" htmlFor="fullName">
              Your name
            </label>
            <input
              id="fullName"
              className="field"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="workspaceName">
              Workspace name
            </label>
            <input
              id="workspaceName"
              className="field"
              placeholder="e.g. Salt & Fern Goods"
              required
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="field"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="field"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p className="small" style={{ color: "var(--status-alert)", margin: 0 }}>
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="small" style={{ color: "var(--status-confirmed)", margin: 0 }}>
              {message}
            </p>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create workspace"}
          </button>
        </form>
        <p className="small muted" style={{ margin: "16px 0 0" }}>
          Already have an account?{" "}
          <Link
            href={
              safeNext !== "/"
                ? `/login?next=${encodeURIComponent(safeNext)}`
                : "/login"
            }
            style={{ color: "var(--accent)", fontWeight: 600 }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
