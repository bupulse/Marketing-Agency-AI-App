"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ADMIN_NAV } from "./nav";

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export type ShellBadges = { approvals: number; health: { status: "ok" | "warning" | "problem"; count: number } };

function Nav({ badges, onNavigate }: { badges: ShellBadges; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="flex flex-col gap-3">
      {ADMIN_NAV.map((group) => (
        <div key={group.title ?? "top"} className="flex flex-col gap-1">
          {group.title && <p className="px-3.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.title}</p>}
          {group.items.map(({ href, label, icon: Icon, badge }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-[15px] font-medium no-underline transition-colors duration-200",
                  active ? "bg-soft text-text" : "text-muted hover:bg-soft hover:text-text",
                )}
              >
                <Icon aria-hidden className={cn("size-[18px] shrink-0", active && "text-pulse-blue")} />
                <span className="flex-1">{label}</span>
                {badge === "approvals" && badges.approvals > 0 && (
                  <Badge tone="danger" aria-label={`${badges.approvals} waiting for approval`}>
                    {badges.approvals}
                  </Badge>
                )}
                {badge === "health" && badges.health.status !== "ok" && (
                  <Badge tone={badges.health.status === "problem" ? "danger" : "violet"} aria-label={`${badges.health.count} health ${badges.health.count === 1 ? "issue" : "issues"}`}>
                    {badges.health.count}
                  </Badge>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AdminShell({ email, badges, children }: { email: string; badges: ShellBadges; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex min-h-dvh w-full flex-wrap items-start gap-5 p-3 sm:p-5">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>

      <aside
        aria-label="Sidebar"
        className="glass-strong hidden w-[248px] shrink-0 flex-col gap-5 rounded-[28px] p-3.5 lg:sticky lg:top-5 lg:flex lg:max-h-[calc(100dvh-2.5rem)] lg:self-start lg:overflow-y-auto"
      >
        <div className="flex items-center gap-2 px-2 pt-1">
          <Logo height={26} />
          <Badge tone="violet">Admin</Badge>
        </div>
        <Nav badges={badges} />
      </aside>

      <div className="flex min-w-0 flex-1 basis-[min(100%,560px)] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="admin-mobile-nav"
              className="glass inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full lg:hidden"
            >
              {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
            </button>
            <span className="truncate text-sm text-muted">{email}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <Link href="/dashboard" className="hidden min-h-11 items-center px-2 text-sm font-medium text-muted underline sm:inline-flex">
              Customer view
            </Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className="glass inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium">
                <LogOut aria-hidden className="size-4" /> Sign out
              </button>
            </form>
          </div>
        </div>

        {open && (
          <div id="admin-mobile-nav" className="glass-strong rounded-[24px] p-3 lg:hidden">
            <Nav badges={badges} onNavigate={() => setOpen(false)} />
          </div>
        )}

        <main id="main" className="flex min-w-0 flex-col gap-5 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
