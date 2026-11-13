import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  { id: "apps", href: "/dashboard/connectors", label: "Apps" },
  { id: "webhooks", href: "/dashboard/connectors/webhooks", label: "Webhooks" },
  { id: "api", href: "/dashboard/connectors/api", label: "API" },
] as const;

/** The three pages of the hub: connect apps, send events out, let other tools read your data. */
export function ConnectorsSubNav({ current }: { current: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label="Connectors sections" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex w-max gap-2">
        {TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              href={tab.href}
              aria-current={tab.id === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border-2 px-4 text-[14px] font-semibold no-underline transition-[border-color,background-color] duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 motion-reduce:transition-none",
                tab.id === current ? "border-pulse-blue bg-pulse-blue/[0.08] text-text dark:bg-pulse-blue/15" : "border-line bg-surface text-muted hover:border-pulse-blue/40 hover:text-text dark:bg-white/[0.03]",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
