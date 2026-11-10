import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { FOCUS } from "./tones";

export type KitCrumb = { label: string; href?: string };

/** Admin > Money > Invoices: a link for every step but the last (the current page). */
export function Breadcrumbs({ crumbs, className }: { crumbs: KitCrumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1 text-[13px] text-muted">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={cn("flex min-w-0 items-center gap-1", !last && "shrink-0")}>
              {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 opacity-60" />}
              {c.href && !last ? (
                <Link href={c.href} className={cn("truncate rounded-md px-1 py-0.5 no-underline hover:bg-soft hover:text-text", FOCUS)}>
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn("truncate px-1", last && "font-semibold text-text")}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** "Back to Payments": a small pill link to the page above this one. */
export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex min-h-10 w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[13px] font-semibold no-underline hover:border-pulse-blue/40 dark:bg-white/[0.04]", FOCUS, className)}>
      <ArrowLeft aria-hidden className="size-4" />
      {label}
    </Link>
  );
}
