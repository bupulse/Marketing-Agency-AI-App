import Link from "next/link";
import { BadgeDollarSign, CalendarCheck, CircleX, MessageSquarePlus, Rocket, UserPlus } from "lucide-react";
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
    <Panel title="Today's payments" description="Confirmed since midnight (Kigali time)." action={<span className="text-xl font-semibold tabular-nums text-success" title={fx.amountTitle(total, rwf)}>{fx.amount(total, rwf)}</span>}>
      {payments.length === 0 ? (
        <Empty>No payments yet today.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <li key={p.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-4 py-3", p.usdCents < 0 ? "bg-danger-bg" : "bg-success-bg")}>
              <span className="min-w-0 flex-1">
                {p.href ? <Link href={p.href} className="font-semibold underline">{p.company}</Link> : <span className="font-semibold">{p.company}</span>}
                {p.person && <span className="block text-[13px] text-muted">{p.person}</span>}
              </span>
              <span className="text-lg font-semibold tabular-nums">{p.amount}</span>
              <span className="text-[13px] text-muted">
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

/** What happened today, newest first, one plain sentence each. */
export function TodayTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <Panel title="What happened today" description="Sign-ups, demos, trials, payments, cancellations and plan requests, newest first.">
      {items.length === 0 ? (
        <Empty>Nothing yet today.</Empty>
      ) : (
        <ol className="flex flex-col">
          {items.slice(0, 30).map((i) => {
            const Icon = ICON[i.kind];
            return (
              <li key={i.id} className="flex items-start gap-3 border-t border-line py-2.5 first:border-t-0">
                <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", i.kind === "payment" ? "text-success" : i.kind === "cancel" ? "text-danger" : "text-pulse-blue")} />
                <span className="w-12 shrink-0 text-[13px] tabular-nums text-muted">{kigaliTime(i.at)}</span>
                <span className="min-w-0 flex-1 text-[15px]">{i.href ? <Link href={i.href} className="hover:underline">{i.text}</Link> : i.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
