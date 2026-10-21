"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Link2, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/creator", label: "Campaigns", icon: House },
  { href: "/creator/earnings", label: "Earnings", icon: Wallet },
  { href: "/creator/connections", label: "Connections", icon: Link2 },
];

const activeFor = (pathname: string, href: string) => (href === "/creator" ? pathname === href || pathname.startsWith("/creator/campaigns") || pathname.startsWith("/creator/tasks") : pathname.startsWith(href));

/** The portal's three tabs: a bottom bar on phones, a row of pills above the page from sm up. */
export function CreatorNav({ bottom }: { bottom?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Creator" className={cn("flex", bottom ? "items-end gap-1" : "gap-2")}>
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = activeFor(pathname, href);
        return bottom ? (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold no-underline", active ? "text-pulse-blue" : "text-muted")}>
            <span aria-hidden className={cn("inline-flex h-8 w-12 items-center justify-center rounded-full", active && "bg-pulse-blue/12")}>
              <Icon className="size-[22px]" />
            </span>
            {label}
          </Link>
        ) : (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold no-underline", active ? "bg-brand-gradient text-white" : "glass text-text")}>
            <Icon aria-hidden className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
