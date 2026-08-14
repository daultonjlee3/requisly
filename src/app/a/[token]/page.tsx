import Link from "next/link";
import { getOneClickPreview } from "@/lib/supplier-one-click.server";
import { confirmOneClickAction } from "./actions";

export default async function OneClickActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; err?: string }>;
}) {
  const { token } = await params;
  const q = await searchParams;

  if (q.done === "1") {
    const preview = await getOneClickPreview(token);
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-zinc-900">Done</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {preview
            ? `${preview.actionLabel} recorded for ${preview.poNumber}.`
            : "Your action was recorded."}
        </p>
        {preview?.supplierLinkUrl ? (
          <FullLink href={preview.supplierLinkUrl} />
        ) : null}
      </Shell>
    );
  }

  const preview = await getOneClickPreview(token);
  if (!preview) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-zinc-900">Link not found</h1>
        <p className="mt-2 text-sm text-zinc-600">
          This one-click link is invalid or no longer available.
        </p>
      </Shell>
    );
  }

  if (preview.used || preview.expired) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-zinc-900">
          {preview.used ? "Already used" : "Expired"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {preview.used
            ? "This one-click link was already used."
            : "This one-click link has expired."}
        </p>
        {preview.supplierLinkUrl ? (
          <FullLink href={preview.supplierLinkUrl} />
        ) : null}
      </Shell>
    );
  }

  const errorMessage = q.err ? decodeURIComponent(q.err) : null;

  return (
    <Shell>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {preview.workspaceName}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-zinc-900">
        {preview.actionLabel}
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        {preview.poNumber}
        {preview.shipDate ? ` · ship ${preview.shipDate}` : ""}
      </p>
      <p className="mt-4 text-sm text-zinc-600">
        Confirm to apply this action. Nothing is saved until you press the
        button below.
      </p>
      {errorMessage ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMessage}
        </p>
      ) : null}
      <form action={confirmOneClickAction} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="inline-flex rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          {preview.actionLabel}
        </button>
      </form>
      {preview.supplierLinkUrl ? (
        <FullLink href={preview.supplierLinkUrl} />
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-zinc-100 px-4 py-16">
      <div className="mx-auto max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </main>
  );
}

function FullLink({ href }: { href: string }) {
  return (
    <p className="mt-8 text-xs leading-relaxed text-zinc-400">
      Need line changes, tracking, or history?{" "}
      <Link href={href} className="text-zinc-500 underline underline-offset-2">
        View full order & history →
      </Link>
    </p>
  );
}
