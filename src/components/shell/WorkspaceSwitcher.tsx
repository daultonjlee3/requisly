"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronsUpDown } from "lucide-react";
import { switchWorkspace } from "@/lib/actions/workspaces";
import type { WorkspaceMembership } from "@/lib/workspace";

export function WorkspaceSwitcher({
  activeWorkspaceId,
  memberships,
}: {
  activeWorkspaceId: string;
  memberships: WorkspaceMembership[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = memberships.find((m) => m.workspace_id === activeWorkspaceId);

  if (memberships.length <= 1) {
    return (
      <div className="what" title={active?.name}>
        {active?.name ?? "Workspace"}
        {active?.is_demo ? " · Demo" : ""}
      </div>
    );
  }

  function onSelect(workspaceId: string) {
    if (workspaceId === activeWorkspaceId || pending) return;
    setOpen(false);
    startTransition(async () => {
      await switchWorkspace(workspaceId);
      router.refresh();
    });
  }

  return (
    <div className="workspace-switcher">
      <button
        type="button"
        className="workspace-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="workspace-switcher-name">
          {active?.name ?? "Workspace"}
          {active?.is_demo ? (
            <span className="workspace-switcher-demo">Demo</span>
          ) : null}
        </span>
        <ChevronsUpDown size={12} strokeWidth={1.75} />
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="workspace-switcher-backdrop"
            aria-label="Close workspace menu"
            onClick={() => setOpen(false)}
          />
          <ul className="workspace-switcher-menu" role="listbox">
            {memberships.map((m) => (
              <li key={m.workspace_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m.workspace_id === activeWorkspaceId}
                  className={`workspace-switcher-option${
                    m.workspace_id === activeWorkspaceId ? " active" : ""
                  }`}
                  disabled={pending}
                  onClick={() => onSelect(m.workspace_id)}
                >
                  <span>{m.name}</span>
                  {m.is_demo ? (
                    <span className="workspace-switcher-demo">Demo</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
