import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { change } from "@/lib/admin/format";
import { cn } from "@/lib/cn";

/** A number with its label and where it comes from. `source` links to the page or table behind it. */
export function Stat({
  label,
  value,
  previous,
  invert,
  source,
  href,
  note,
}: {
  label: string;
  value: string;
  /** Raw current and previous numbers, to show the change. */
  previous?: { now: number; before: number };
  /** True when going up is bad (costs). */
  invert?: boolean;
  source: string;
  href?: string;
  note?: string;
}) {
  const delta = previous ? change(previous.now, previous.before) : null;
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <GlassCard padding="sm" className="flex min-w-0 flex-col gap-1">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <span className="text-2xl font-semibold tabular-nums tracking-[-0.02em]">{value}</span>
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
        {delta != null && (
          <span className={cn("inline-flex items-center gap-0.5 font-semibold", good ? "text-success" : "text-danger")}>
            {delta >= 0 ? <ArrowUpRight aria-hidden className="size-3.5" /> : <ArrowDownRight aria-hidden className="size-3.5" />}
            {Math.abs(Math.round(delta))}%<span className="sr-only"> versus the period before</span>
          </span>
        )}
        {href ? (
          <Link href={href} className="underline">
            {source}
          </Link>
        ) : (
          <span>{source}</span>
        )}
      </div>
      {note && <span className="text-xs text-muted">{note}</span>}
    </GlassCard>
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
  return <p className="rounded-2xl bg-soft px-4 py-6 text-center text-[15px] text-muted">{children}</p>;
}

/** Scrolls sideways inside its card on a phone instead of stretching the page. */
export function TableWrap({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[520px] text-left text-[14px]">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th scope="col" className={cn("pb-2 pr-3 text-[13px] font-medium text-muted", right && "text-right")}>
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
