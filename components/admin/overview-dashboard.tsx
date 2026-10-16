import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import { CURRENCY_NAME } from "@/lib/money/display";
import Link from "next/link";
import { ArrowRight, CalendarCheck, CircleAlert, Inbox, Smartphone, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { GlassCard } from "@/components/ui";
import { num } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import { Gauge } from "./charts";
import { Section, Stat } from "./ui";

type Part = { rwfMinor: number; rwfUsdCents: number };
export type OverviewData = {
  /** The parts of the figures received in RWF (exact in RWF; lib/money/revenue-shared.ts RwfPart). */
  rwf?: { month: Part; lifetime: Part; mrr: Part; arpu: Part | null };
  monthLabel: string;
  prevMonthLabel: string;
  revenue: { monthCents: number; prevCents: number; lifetimeCents: number; customersEver: number; spark: number[] };
  mrrCents: number;
  arpuCents: number | null;
  profit: { monthCents: number; prevCents: number; costCents: number; estimateCents: number; spark: number[] };
  clients: { active: number; trial: number; pastDue: number; waitingDemo: number };
  todo: { inbox: number; payments: number; demosToday: number; nextDemo: string | null; errors24h: number };
  ai: { spentCents: number; capCents: number; pct: number; paused: boolean } | null;
};

function Shortcut({ href, icon, label, value, tone }: { href: string; icon: ReactNode; label: string; value: string; tone?: "danger" | "violet" }) {
  return (
    <Link href={href} className="no-underline">
      <GlassCard padding="sm" interactive className="flex min-h-[84px] items-center gap-3">
        <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-soft", tone === "danger" && "bg-danger-bg text-danger", tone === "violet" && "bg-new-bg text-new")}>{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xl font-semibold tabular-nums">{value}</span>
          <span className="truncate text-[13px] text-muted">{label}</span>
        </span>
        <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
      </GlassCard>
    </Link>
  );
}

/** The Overview's numbers: what needs doing today, money this month, clients and AI. Every card links to its folder. */
export function OverviewDashboard({ d, show = { money: true, clients: true, ai: true }, fx = BOOKS_FMT }: { d: OverviewData; show?: { money: boolean; clients: boolean; ai: boolean }; /** Money in the admin's display currency. */ fx?: MoneyFmt }) {
  return (
    <>
      <Section title="Today" description="What is waiting for you right now.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Shortcut href="/admin/inbox" icon={<Inbox aria-hidden className="size-5" />} label="Items in your inbox" value={num(d.todo.inbox)} tone={d.todo.inbox ? "danger" : undefined} />
          <Shortcut href="/admin/payments" icon={<Smartphone aria-hidden className="size-5" />} label="Payments waiting to confirm" value={num(d.todo.payments)} tone={d.todo.payments ? "danger" : undefined} />
          <Shortcut href="/admin/demos" icon={<CalendarCheck aria-hidden className="size-5" />} label={d.todo.nextDemo ? `Demos today · next ${d.todo.nextDemo}` : "Demos today"} value={num(d.todo.demosToday)} tone={d.todo.demosToday ? "violet" : undefined} />
          <Shortcut href="/admin/errors" icon={<TriangleAlert aria-hidden className="size-5" />} label="Errors in the last 24 hours" value={num(d.todo.errors24h)} tone={d.todo.errors24h ? "danger" : undefined} />
        </div>
      </Section>

      {show.money && (
      <Section title={`Money, ${d.monthLabel}`} description={`${CURRENCY_NAME[fx.display.currency]}. Revenue is card, Mobile Money and invoices; profit subtracts every cost, estimated or billed.`} action={<Link href="/admin/revenue" className="text-sm font-medium underline">Revenue and profit</Link>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <Stat label="MRR" value={fx.amount(d.mrrCents, d.rwf?.mrr)} title={fx.amountTitle(d.mrrCents, d.rwf?.mrr)} source={d.arpuCents == null ? "No paying clients yet" : `ARPU ${fx.amount(d.arpuCents, d.rwf?.arpu)} a month`} href="/admin/revenue#mrr" />
          <Stat label="Revenue this month" value={fx.amount(d.revenue.monthCents, d.rwf?.month)} title={fx.amountTitle(d.revenue.monthCents, d.rwf?.month)} previous={{ now: d.revenue.monthCents, before: d.revenue.prevCents, label: d.prevMonthLabel }} spark={d.revenue.spark} href="/admin/revenue" source="By month" />
          <Stat label="Lifetime revenue" value={fx.amount(d.revenue.lifetimeCents, d.rwf?.lifetime)} title={fx.amountTitle(d.revenue.lifetimeCents, d.rwf?.lifetime)} source={`${num(d.revenue.customersEver)} paying client${d.revenue.customersEver === 1 ? "" : "s"} ever`} href="/admin/revenue#clients" />
          <Stat label="Costs this month" value={fx.text(d.profit.costCents)} title={fx.title(d.profit.costCents)} invert source={d.profit.estimateCents > 0 ? `${fx.text(d.profit.estimateCents)} still an estimate` : "All billed amounts"} href="/admin/costs" />
          <Stat label="Profit this month" value={fx.amount(d.profit.monthCents, d.rwf?.month)} title={fx.amountTitle(d.profit.monthCents, d.rwf?.month)} previous={{ now: d.profit.monthCents, before: d.profit.prevCents, label: d.prevMonthLabel }} spark={d.profit.spark} tone={d.profit.monthCents < 0 ? "danger" : undefined} href="/admin/revenue#profit" source="Revenue minus all costs" />
        </div>
      </Section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {show.clients && (
        <Section title="Clients" description="Companies by subscription state." action={<Link href="/admin/client-health" className="text-sm font-medium underline">Client health</Link>}>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Active, paying" value={num(d.clients.active)} href="/admin/companies?status=ACTIVE" source="See them" />
            <Stat label="On trial" value={num(d.clients.trial)} href="/admin/companies?status=TRIALING" source="See them" />
            <Stat label="Past due" value={num(d.clients.pastDue)} tone={d.clients.pastDue ? "danger" : undefined} href="/admin/companies?status=PAST_DUE" source="See them" />
            <Stat label="Waiting for a demo" value={num(d.clients.waitingDemo)} href="/admin/demos" source="Demos" />
          </div>
        </Section>
        )}
        {show.ai && (
        <Section title="AI this month" description="Spend against the monthly safety cap." action={<Link href="/admin/ai" className="text-sm font-medium underline">AI calls and spend</Link>}>
          <GlassCard padding="md" className="flex flex-col gap-4">
            {d.ai ? (
              <>
                <Gauge value={d.ai.spentCents} max={d.ai.capCents} label="AI spend vs budget" text={`${fx.text(d.ai.spentCents)} of ${fx.text(d.ai.capCents)} (${Math.round(d.ai.pct)}%)`} />
                {d.ai.paused ? (
                  <p role="alert" className="flex items-center gap-2 rounded-2xl bg-danger-bg px-3 py-2 text-sm font-medium text-danger">
                    <CircleAlert aria-hidden className="size-4" /> The cap is reached: AI features are paused.
                  </p>
                ) : (
                  <p className="text-[13px] text-muted">From the cost ledger, an estimate until Google&apos;s bill for the month is entered in Costs.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">The AI ledger could not be read just now.</p>
            )}
          </GlassCard>
        </Section>
        )}
      </div>
    </>
  );
}
