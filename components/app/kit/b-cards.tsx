import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { IconBadge } from "@/components/admin/kit/icon-badge";
import { CARD, FOCUS, LIFT, type KitTone } from "@/components/admin/kit/tones";
import { cn } from "@/lib/cn";

/**
 * The client dashboard's card pieces (the admin kit's look, components/admin/kit/README.md). Server components: no
 * script. Import from "@/components/app/kit/b-cards".
 */

/**
 * A card that opens a page and shows how far along it is: icon badge, title, a short hint, a status pill (`badge`) and
 * a thin progress bar when `percent` is a number. Without `href` it is a quiet, non-clickable card ("Coming soon").
 * On a phone it is a slim row (icon, title, bar, arrow) so a list of them stays short.
 */
export function BProgressCard({
  href,
  icon,
  tone = "blue",
  title,
  hint,
  percent,
  badge,
  foot,
  label,
}: {
  href?: string;
  icon: LucideIcon;
  tone?: KitTone;
  title: string;
  hint?: ReactNode;
  percent?: number | null;
  badge?: ReactNode;
  /** One short line at the bottom (what is missing). */
  foot?: ReactNode;
  /** The link's accessible name when the card's text is not enough. */
  label?: string;
}) {
  const pct = typeof percent === "number" ? Math.min(100, Math.max(0, Math.round(percent))) : null;
  const bar =
    pct === null ? null : (
      <span role="progressbar" aria-label={`${title} complete`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="block h-1.5 w-full overflow-hidden rounded-full bg-line">
        <span className={cn("bp-meter-fill block h-full rounded-full", pct >= 100 ? "bg-success" : "bg-brand-gradient")} style={{ width: `${pct}%` }} />
      </span>
    );
  const body = (
    <>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-brand-gradient opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
      {/* Phone: a slim row. */}
      <span className="flex items-center gap-3 sm:hidden">
        <IconBadge icon={icon} tone={href ? tone : "slate"} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-[15px] font-bold leading-snug">{title}</span>
            {badge && <span className="shrink-0">{badge}</span>}
          </span>
          {foot && <span className="line-clamp-1 text-[12.5px] leading-snug text-muted">{foot}</span>}
          {bar}
        </span>
        {href && <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />}
      </span>
      {/* Tablet and computer: a card. */}
      <span className="hidden min-w-0 flex-1 flex-col gap-3 sm:flex">
        <span className="flex items-start justify-between gap-2">
          <IconBadge icon={icon} tone={href ? tone : "slate"} />
          {badge}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[16px] font-bold leading-snug tracking-[-0.01em]">{title}</span>
          {hint && <span className="line-clamp-2 text-[13px] leading-snug text-muted">{hint}</span>}
        </span>
        <span className="mt-auto flex flex-col gap-3 pt-1">
          {bar}
          <span className="flex items-center justify-between gap-2 text-[13px]">
            <span className="line-clamp-1 min-w-0 text-muted">{foot}</span>
            {href && (
              <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-soft text-muted transition-[transform,background-color,color] duration-200 group-hover:translate-x-0.5 group-hover:bg-pulse-blue group-hover:text-white motion-reduce:transform-none">
                <ArrowRight className="size-4" />
              </span>
            )}
          </span>
        </span>
      </span>
    </>
  );
  const cls = cn("group relative flex h-full min-w-0 flex-col gap-3 overflow-hidden p-3.5 text-text no-underline sm:p-5", CARD);
  if (!href) return <div className={cn(cls, "opacity-80")}>{body}</div>;
  return (
    <Link href={href} aria-label={label} className={cn(cls, LIFT, FOCUS)}>
      {body}
    </Link>
  );
}

/** A titled card for a block of content (a form, a list): icon badge, title, one plain line, then the content. */
export function BPanel({
  id,
  icon,
  tone = "blue",
  title,
  hint,
  aside,
  children,
  className,
  danger = false,
}: {
  id?: string;
  icon?: LucideIcon;
  tone?: KitTone;
  title: ReactNode;
  hint?: ReactNode;
  /** Something small on the right of the title (a status pill, a button). */
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
  danger?: boolean;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn(CARD, "flex min-w-0 flex-col gap-5 p-4 sm:p-6", danger && "border-danger/35", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {icon && <IconBadge icon={icon} tone={danger ? "red" : tone} />}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={headingId} className={cn("text-[17px] font-bold leading-snug tracking-[-0.01em]", danger && "text-danger")}>
              {title}
            </h2>
            {hint && <p className="text-[14px] leading-snug text-muted">{hint}</p>}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A small heading over a group of cards, with one plain line. */
export function BGroupTitle({ id, title, hint }: { id?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <h2 id={id} className="text-[17px] font-bold tracking-[-0.01em]">
        {title}
      </h2>
      {hint && <p className="text-[14px] text-muted">{hint}</p>}
    </div>
  );
}

/** The grid the progress cards sit in (rise-in animation from KitStyles). */
export function BGrid({ children, cols = 3, className }: { children: ReactNode; cols?: 2 | 3; className?: string }) {
  return <div className={cn("kit-rise grid grid-cols-1 gap-3 sm:grid-cols-2", cols === 3 && "xl:grid-cols-3", className)}>{children}</div>;
}
