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
                "inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-semibold no-underline transition-colors",
                tab.id === current ? "bg-brand-gradient text-white shadow-glow" : "text-muted hover:bg-soft hover:text-text",
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
