import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  { key: "library", href: "/admin/training-lab", label: "Library" },
  { key: "team", href: "/admin/training-lab/team", label: "Team" },
  { key: "editor", href: "/admin/training-lab/editor", label: "Editor" },
] as const;

/** Library | Team | Editor, at the top of both Training Lab pages. */
export function LabTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Training Lab" className="flex w-fit max-w-full gap-1 rounded-full bg-soft p-1">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} aria-current={current === t.key ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium no-underline", current === t.key ? "bg-surface text-text shadow-glass" : "text-muted")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
