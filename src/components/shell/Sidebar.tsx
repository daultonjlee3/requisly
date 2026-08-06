"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bell,
  Calendar,
  ChartColumn,
  LayoutGrid,
  Package,
  Plus,
  ShoppingBag,
  Users,
} from "lucide-react";
import { Suspense } from "react";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import type { WorkspaceMembership } from "@/lib/workspace";

type SidebarProps = {
  fullName: string;
  workspaceName: string;
  activeWorkspaceId: string;
  initials: string;
  memberships: WorkspaceMembership[];
};

const primaryNav = [
  { href: "/", label: "Today's Work", icon: LayoutGrid },
  { href: "/purchase-orders", label: "Purchase Orders", icon: ShoppingBag },
  { href: "/purchase-orders/new", label: "New PO", icon: Plus },
];

const workspaceNav = [
  { href: "/analytics", label: "Analytics", icon: ChartColumn },
  {
    href: "/purchase-orders?view=calendar",
    label: "Calendar",
    icon: Calendar,
    calendar: true,
  },
  { href: "/suppliers", label: "Suppliers", icon: Users },
  { href: "/products", label: "Products", icon: Package },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
];

function NavItems() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const poView = searchParams.get("view");

  function isPrimaryActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/purchase-orders/new") {
      return pathname.startsWith("/purchase-orders/new");
    }
    if (href === "/purchase-orders") {
      if (pathname.startsWith("/purchase-orders/new")) return false;
      if (pathname === "/purchase-orders" && poView === "calendar") return false;
      return (
        pathname === "/purchase-orders" ||
        pathname.startsWith("/purchase-orders/")
      );
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function isWorkspaceActive(href: string, calendar?: boolean) {
    if (calendar) {
      return pathname === "/purchase-orders" && poView === "calendar";
    }
    const base = href.split("?")[0]!;
    return pathname === base || pathname.startsWith(`${base}/`);
  }

  return (
    <>
      <div className="nav-group">
        {primaryNav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-item${isPrimaryActive(href) ? " active" : ""}`}
          >
            <Icon className="icon" size={16} strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </div>

      <div className="nav-group">
        <div className="nav-label">Workspace</div>
        {workspaceNav.map((item) => {
          const { href, label, icon: Icon } = item;
          const calendar = "calendar" in item && item.calendar;
          return (
            <Link
              key={href}
              href={href}
              className={`nav-item${isWorkspaceActive(href, calendar) ? " active" : ""}`}
            >
              <Icon className="icon" size={16} strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </div>
    </>
  );
}

export function Sidebar({
  fullName,
  workspaceName,
  activeWorkspaceId,
  initials,
  memberships,
}: SidebarProps) {
  return (
    <nav className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div className="brand-name">Requisly</div>
      </div>

      <Suspense
        fallback={
          <div className="nav-group">
            {primaryNav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="nav-item">
                <Icon className="icon" size={16} strokeWidth={1.75} />
                {label}
              </Link>
            ))}
          </div>
        }
      >
        <NavItems />
      </Suspense>

      <div className="sidebar-footer">
        <div className="avatar">{initials}</div>
        <div className="sidebar-footer-meta">
          <div className="who">{fullName}</div>
          <WorkspaceSwitcher
            activeWorkspaceId={activeWorkspaceId}
            memberships={
              memberships.length
                ? memberships
                : [
                    {
                      workspace_id: activeWorkspaceId,
                      role: "owner",
                      name: workspaceName,
                      is_demo: false,
                    },
                  ]
            }
          />
        </div>
      </div>
    </nav>
  );
}
