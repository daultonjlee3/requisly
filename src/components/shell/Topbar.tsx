import type { ReactNode } from "react";

type TopbarProps = {
  title: string;
  subline?: string;
  actions?: ReactNode;
};

export function Topbar({ title, subline, actions }: TopbarProps) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        {subline ? <div className="subline">{subline}</div> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}
