import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { change } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import { Spark } from "../charts";
import { IconBadge } from "./icon-badge";
import { CARD, FOCUS, LIFT, type KitTone } from "./tones";

export type TileDelta = {
  now: number;
  before: number;
  /** "vs September". */
  against: string;
  /** False when a rise is bad news (costs, errors). */
  upIsGood?: boolean;
};

/** "Up 12%" or "Down 4%" in words with an arrow, green when the change is good news, red when bad. */
export function DeltaChip({ delta }: { delta: TileDelta }) {
  const pct = change(delta.now, delta.before);
  if (pct == null) return null;
  const v = Math.round(pct);
  const up = v > 0;
  const good = v === 0 ? null : up === (delta.upIsGood ?? true);
  const Icon = v === 0 ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-bold",
          good === null ? "bg-soft text-muted" : good ? "bg-success-bg text-success" : "bg-danger-bg text-danger",
        )}
      >
        <Icon aria-hidden className="size-3.5" strokeWidth={2.6} />
        {v === 0 ? "Same" : `${up ? "Up" : "Down"} ${Math.abs(v)}%`}
      </span>
      <span className="text-muted">{delta.against}</span>
    </span>
  );
}

/**
 * A number with its plain meaning: icon badge, label, the big value, an optional change and trend line, and one line
 * saying what the number is. With `href` the whole tile opens the page behind the number. `alert` rings it in red
 * (something to act on).
 */
export function StatTile({
  icon,
  tone = "blue",
  label,
  value,
  hint,
  href,
  delta,
  spark,
  alert,
  title,
  footer,
  className,
}: {
  icon: LucideIcon;
  tone?: KitTone;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  delta?: TileDelta | null;
  spark?: number[];
  alert?: boolean;
  /** Tooltip of the value (the original amount of a converted money figure). */
  title?: string;
  footer?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <IconBadge icon={icon} tone={alert ? "red" : tone} size="sm" />
        <span className="min-w-0 text-[13.5px] font-semibold leading-tight">{label}</span>
      </div>
      <span className={cn("break-words text-[24px] font-bold leading-none tabular-nums tracking-[-0.02em] sm:text-[28px] lg:text-[30px]", alert && "text-danger")} title={title}>
        {value}
      </span>
      {spark && spark.length > 1 && <Spark values={spark} label={`${label}, recent trend`} />}
      {delta && <DeltaChip delta={delta} />}
      {hint && <span className="text-[12.5px] leading-snug text-muted">{hint}</span>}
      {footer}
    </>
  );
  const cls = cn("flex min-w-0 flex-col gap-2 p-4 text-text sm:p-5", CARD, alert && "ring-1 ring-danger/35", className);
  return href ? (
    <Link href={href} className={cn(cls, LIFT, FOCUS, "no-underline")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Two tiles a row on a phone, up to `cols` on a computer. */
export function StatGrid({ children, cols = 4, className }: { children: ReactNode; cols?: 2 | 3 | 4 | 5; className?: string }) {
  return (
    <div className={cn("kit-rise grid grid-cols-2 gap-3", cols >= 3 && "lg:grid-cols-3", cols === 4 && "xl:grid-cols-4", cols === 5 && "xl:grid-cols-5", className)}>
      {children}
    </div>
  );
}
