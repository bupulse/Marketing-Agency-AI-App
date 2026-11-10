import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Inbox, type LucideIcon } from "lucide-react";
import { change } from "@/lib/admin/format";
import { Spark } from "./charts";
import { IconBadge } from "./kit/icon-badge";
import { CARD, type KitTone } from "./kit/tones";
import { cn } from "@/lib/cn";

// The console's original building blocks, in the redesigned look (rounded white cards on the grey page, gradient
// accents, plain hints). Every export keeps its props, so all the existing pages pick up the new look as they are.
// New pages also have the richer pieces in ./kit (README there).

/**
 * A number with its label, its change against the period before, and where it comes from. `source` (or `href`) links
 * to the page or table behind it; `spark` draws the recent trend under it.
 */
export function Stat({
  label,
  value,
  previous,
  invert,
  source,
  href,
  note,
  spark,
  tone,
  title,
}: {
  label: string;
  value: string;
  /** Tooltip of the value (the original amount of a converted money figure). */
  title?: string;
  /** Raw current and previous numbers, to show the change. */
  previous?: { now: number; before: number; label?: string };
  /** True when going up is bad (costs). */
  invert?: boolean;
  source?: string;
  href?: string;
  note?: string;
  spark?: number[];
  tone?: "danger" | "success";
}) {
  const delta = previous ? change(previous.now, previous.before) : null;
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <div className={cn("relative flex min-w-0 flex-col gap-1.5 overflow-hidden p-4", CARD, tone === "danger" && "ring-1 ring-danger/40")}>
      <span aria-hidden className={cn("absolute inset-y-3 left-0 w-[3px] rounded-r-full", tone === "danger" ? "bg-danger" : tone === "success" ? "bg-success" : "bg-brand-gradient opacity-70")} />
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      <span className={cn("text-[26px] font-bold leading-tight tabular-nums tracking-[-0.02em]", tone === "danger" && "text-danger", tone === "success" && "text-success")} title={title}>{value}</span>
      {spark && spark.length > 1 && <Spark values={spark} label={`${label}, recent trend`} />}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {delta != null && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-bold", good ? "bg-success-bg text-success" : "bg-danger-bg text-danger")}>
            {delta >= 0 ? <ArrowUpRight aria-hidden className="size-3.5" /> : <ArrowDownRight aria-hidden className="size-3.5" />}
            {Math.abs(Math.round(delta))}%<span className="sr-only"> versus {previous?.label ?? "the period before"}</span>
            {previous?.label && <span aria-hidden className="font-normal"> vs {previous.label}</span>}
          </span>
        )}
        {href ? (
          <Link href={href} className="font-medium text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">
            {source ?? "Open"}
          </Link>
        ) : (
          source && <span>{source}</span>
        )}
      </div>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}

/** A titled block of stat cards or panels inside a page, with a one-line explanation. */
export function Section({ id, title, description, action, children }: { id?: string; title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  const hid = `h-${id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={hid} className="flex scroll-mt-24 flex-col gap-3" id={id}>
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className="mt-1 h-5 w-1 shrink-0 rounded-full bg-brand-gradient" />
          <div className="min-w-0">
            <h2 id={hid} className="text-[18px] font-bold tracking-[-0.02em]">{title}</h2>
            {description && <p className="text-[13px] leading-snug text-muted">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "How we calculate this": a closed details box under a number or table. */
export function HowCalculated({ children, title = "How we calculate this" }: { children: ReactNode; title?: string }) {
  return (
    <details className="group/how rounded-2xl border border-line bg-soft/60 px-4 py-3 text-[13px] text-muted [&_li]:ml-4 [&_li]:list-disc">
      <summary className="flex min-h-7 cursor-pointer list-none items-center justify-between gap-2 font-semibold text-text [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted transition-transform duration-200 group-open/how:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-2 flex flex-col gap-1.5">{children}</div>
    </details>
  );
}

/**
 * A card with a title, a one-line explanation and an action on the right. `icon` (and `tone`) add a gradient badge
 * before the title; `id` makes it a link target (#anchor).
 */
export function Panel({ title, description, action, children, icon, tone = "blue", id }: { title: string; description?: string; action?: ReactNode; children: ReactNode; icon?: LucideIcon; tone?: KitTone; id?: string }) {
  return (
    <section id={id} className={cn("flex min-w-0 scroll-mt-24 flex-col gap-4 p-5 sm:p-6", CARD)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <IconBadge icon={icon} tone={tone} />}
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold leading-snug tracking-[-0.02em]">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] leading-snug text-muted">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-soft/50 px-4 py-6 text-center text-[14px] text-muted">
      <Inbox aria-hidden className="size-5 opacity-70" />
      <span>{children}</span>
    </p>
  );
}

/** Scrolls inside its card (sideways on a phone, down past `maxHeight`) with the header row kept in view. */
export function TableWrap({ children, caption, tall }: { children: ReactNode; caption: string; tall?: boolean }) {
  return (
    <div className={cn("-mx-1 overflow-auto px-1", tall ? "max-h-[80vh]" : "max-h-[65vh]")}>
      <table className="w-full min-w-[520px] text-left text-[14px]">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th scope="col" className={cn("sticky top-0 z-[1] whitespace-nowrap bg-surface/95 pb-2 pr-3 pt-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted backdrop-blur dark:bg-[#121217]/95", right && "text-right")}>
    {children}
  </th>
);
export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={cn("border-t border-line py-3 pr-3 align-top", right && "text-right tabular-nums", className)}>{children}</td>
);

/** Message boxes (?notice= and ?error= on a page). Plain class strings: pages add their own layout classes to them. */
export const notice = {
  ok: "rounded-2xl border border-success/25 bg-success-bg px-4 py-3 text-sm font-medium text-success",
  bad: "rounded-2xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger",
  info: "rounded-2xl border border-pulse-blue/20 bg-ok-bg px-4 py-3 text-sm font-medium text-ok",
  warn: "rounded-2xl border border-[#f59e0b]/30 bg-[#fff4e0] px-4 py-3 text-sm font-medium text-[#b45309] dark:bg-[#3a2a0a] dark:text-[#ffc65c]",
};

/** Range switcher that links to ?range=. */
export function RangeTabs({ current, base, extra }: { current: string; base: string; extra?: Record<string, string> }) {
  const qs = (r: string) => `${base}?${new URLSearchParams({ ...(extra ?? {}), range: r })}`;
  return (
    <nav aria-label="Time range" className="flex gap-1 rounded-full border border-line bg-surface p-1 dark:bg-white/[0.04]">
      {[
        ["today", "Today"],
        ["7d", "7 days"],
        ["30d", "30 days"],
      ].map(([k, l]) => (
        <Link
          key={k}
          href={qs(k)}
          aria-current={current === k ? "page" : undefined}
          className={cn(
            "inline-flex min-h-10 items-center gap-1 rounded-full px-4 text-sm font-semibold no-underline transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30",
            current === k ? "bg-brand-gradient text-white shadow-[0_8px_18px_-10px_rgba(47,107,255,0.9)]" : "text-muted hover:text-text",
          )}
        >
          {current === k && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
          {l}
        </Link>
      ))}
    </nav>
  );
}
