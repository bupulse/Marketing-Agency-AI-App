import Link from "next/link";
import { BadgeDollarSign, CalendarCheck, CircleX, Clock, MessageSquarePlus, Rocket, UserPlus } from "lucide-react";
import type { TimelineItem, TodayPayment } from "@/lib/admin/today";
import { BOOKS_FMT, type MoneyFmt } from "./money";
import { cn } from "@/lib/cn";
import { Empty, Panel } from "./ui";

const kigaliTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });

/** Today's confirmed payments, highlighted: who, how much, how, when and which agent brought them in. */
export function TodayPayments({ payments, fx = BOOKS_FMT }: { payments: TodayPayment[]; /** Money in the admin's display currency. */ fx?: MoneyFmt }) {
  const total = payments.reduce((s, p) => s + p.usdCents, 0);
  // RWF payments add up exactly in RWF; only other money is converted.
  const rwf = payments.reduce((s, p) => (p.currency === "RWF" && p.localMinor !== null ? { rwfMinor: s.rwfMinor + p.localMinor, rwfUsdCents: s.rwfUsdCents + p.usdCents } : s), { rwfMinor: 0, rwfUsdCents: 0 });
  return (
    <Panel
      icon={BadgeDollarSign}
      tone="green"
      title="Today's payments"
      description="Confirmed since midnight (Kigali time)."
      action={<span className="rounded-full bg-success-bg px-3 py-1 text-[17px] font-bold tabular-nums text-success" title={fx.amountTitle(total, rwf)}>{fx.amount(total, rwf)}</span>}
    >
      {payments.length === 0 ? (
        <Empty>No payments yet today.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <li key={p.id} className={cn("relative flex flex-wrap items-center gap-x-4 gap-y-1 overflow-hidden rounded-2xl border px-4 py-3", p.usdCents < 0 ? "border-danger/25 bg-danger-bg" : "border-success/20 bg-success-bg/70")}>
              <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", p.usdCents < 0 ? "bg-danger" : "bg-success")} />
              <span className="min-w-0 flex-1">
                {p.href ? <Link href={p.href} className="font-semibold underline-offset-2 hover:underline">{p.company}</Link> : <span className="font-semibold">{p.company}</span>}
                {p.person && <span className="block text-[13px] text-muted">{p.person}</span>}
              </span>
              <span className="text-lg font-bold tabular-nums">{p.amount}</span>
              <span className="inline-flex items-center gap-1 text-[13px] text-muted">
                <Clock aria-hidden className="size-3.5" />
                {p.method} · {kigaliTime(p.at)} · {p.agent ? `by ${p.agent}` : "team"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const ICON = { signup: UserPlus, demo: CalendarCheck, trial: Rocket, payment: BadgeDollarSign, cancel: CircleX, request: MessageSquarePlus } as const;
const CHIP = {
  signup: "bg-ok-bg text-ok",
  demo: "bg-new-bg text-new",
  trial: "bg-ok-bg text-ok",
  payment: "bg-success-bg text-success",
  cancel: "bg-danger-bg text-danger",
  request: "bg-new-bg text-new",
} as const;

/** How many lines show before "Show the rest". */
const FIRST = 6;

function Line({ i }: { i: TimelineItem }) {
  const Icon = ICON[i.kind];
  return (
    <li className="relative flex items-start gap-3 py-2">
      <span aria-hidden className={cn("relative z-[1] inline-flex size-8 shrink-0 items-center justify-center rounded-full", CHIP[i.kind])}>
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col pt-1">
        <span className="text-[14.5px] leading-snug">{i.href ? <Link href={i.href} className="underline-offset-2 hover:underline">{i.text}</Link> : i.text}</span>
        <span className="text-[12px] tabular-nums text-muted">{kigaliTime(i.at)}</span>
      </span>
    </li>
  );
}

/** What happened today, newest first, one plain sentence each (the first few, the rest one tap away). */
export function TodayTimeline({ items }: { items: TimelineItem[] }) {
  const shown = items.slice(0, 30);
  return (
    <Panel icon={Clock} tone="violet" title="What happened today" description="Sign-ups, demos, trials, payments, cancellations and plan requests, newest first.">
      {shown.length === 0 ? (
        <Empty>Nothing yet today.</Empty>
      ) : (
        <div className="relative">
          <span aria-hidden className="absolute bottom-3 left-4 top-3 w-px bg-line" />
          <ol className="flex flex-col">
            {shown.slice(0, FIRST).map((i) => (
              <Line key={i.id} i={i} />
            ))}
          </ol>
          {shown.length > FIRST && (
            <details className="group/more">
              <summary className="ml-11 mt-1 inline-flex min-h-9 cursor-pointer list-none items-center rounded-full px-3 text-[13px] font-semibold text-pulse-blue hover:bg-soft dark:text-[#8db0ff] [&::-webkit-details-marker]:hidden">
                <span className="group-open/more:hidden">Show {shown.length - FIRST} more</span>
                <span className="hidden group-open/more:inline">Show fewer</span>
              </summary>
              <ol className="flex flex-col">
                {shown.slice(FIRST).map((i) => (
                  <Line key={i.id} i={i} />
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}
