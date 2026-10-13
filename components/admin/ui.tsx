import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { change } from "@/lib/admin/format";
import { Spark } from "./charts";
import { cn } from "@/lib/cn";

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
}: {
  label: string;
  value: string;
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
    <GlassCard padding="sm" className={cn("flex min-w-0 flex-col gap-1", tone === "danger" && "ring-1 ring-danger/40")}>
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <span className={cn("text-2xl font-semibold tabular-nums tracking-[-0.02em]", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{value}</span>
      {spark && spark.length > 1 && <Spark values={spark} label={`${label}, recent trend`} />}
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
        {delta != null && (
          <span className={cn("inline-flex items-center gap-0.5 font-semibold", good ? "text-success" : "text-danger")}>
            {delta >= 0 ? <ArrowUpRight aria-hidden className="size-3.5" /> : <ArrowDownRight aria-hidden className="size-3.5" />}
            {Math.abs(Math.round(delta))}%<span className="sr-only"> versus {previous?.label ?? "the period before"}</span>
            {previous?.label && <span aria-hidden className="font-normal text-muted"> vs {previous.label}</span>}
          </span>
        )}
        {href ? (
          <Link href={href} className="underline">
            {source ?? "Open"}
          </Link>
        ) : (
          source && <span>{source}</span>
        )}
      </div>
      {note && <span className="text-xs text-muted">{note}</span>}
    </GlassCard>
  );
}

/** A titled block of stat cards or panels inside a page, with a one-line explanation. */
export function Section({ id, title, description, action, children }: { id?: string; title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  const hid = `h-${id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={hid} className="flex flex-col gap-3" id={id}>
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2 id={hid} className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
          {description && <p className="text-[13px] text-muted">{description}</p>}
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
    <details className="rounded-2xl bg-soft px-4 py-3 text-[13px] text-muted [&_li]:ml-4 [&_li]:list-disc">
      <summary className="min-h-6 cursor-pointer font-medium text-text">{title}</summary>
      <div className="mt-2 flex flex-col gap-1.5">{children}</div>
    </details>
  );
}

export function Panel({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <GlassCard className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </GlassCard>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-2xl bg-soft px-4 py-6 text-center text-[15px] text-muted">{children}</p>;
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
  <th scope="col" className={cn("sticky top-0 z-[1] bg-surface/95 pb-2 pr-3 pt-1 text-[13px] font-medium text-muted backdrop-blur", right && "text-right")}>
    {children}
  </th>
);
export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={cn("border-t border-line py-2.5 pr-3 align-top", right && "text-right tabular-nums", className)}>{children}</td>
);

export const notice = {
  ok: "rounded-2xl bg-success-bg px-4 py-3 text-sm font-medium text-success",
  bad: "rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger",
};

/** Range switcher that links to ?range=. */
export function RangeTabs({ current, base, extra }: { current: string; base: string; extra?: Record<string, string> }) {
  const qs = (r: string) => `${base}?${new URLSearchParams({ ...(extra ?? {}), range: r })}`;
  return (
    <nav aria-label="Time range" className="flex gap-1 rounded-full bg-soft p-1">
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
            "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium no-underline",
            current === k ? "bg-surface text-text shadow-glass" : "text-muted",
          )}
        >
          {l}
        </Link>
      ))}
    </nav>
  );
}
