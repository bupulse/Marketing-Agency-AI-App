import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import { CURRENCY_NAME } from "@/lib/money/display";
import Link from "next/link";
import {
  BadgeCheck,
  CalendarCheck,
  CircleAlert,
  Clapperboard,
  Coins,
  Cpu,
  FileText,
  Inbox,
  MessageSquarePlus,
  PhoneCall,
  Receipt,
  Smartphone,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { num } from "@/lib/admin/format";
import { Gauge } from "./charts";
import { ExpandCard } from "./kit/expand-card";
import { StatGrid, StatTile } from "./kit/stat-tile";
import type { TodoItem } from "./kit/todo-list";
import type { HubFigure } from "./kit/hub-view";
import { SectionCard, SectionGrid } from "./kit/section-card";
import { groupHref, type AdminNavGroup } from "./nav";
import { Section, Stat } from "./ui";
import type { InboxKey } from "@/lib/admin/inbox";
import type { AttentionItem } from "@/lib/admin/attention";

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

const GENERIC = new Set(["admin", "office", "info", "hello", "support", "team", "contact", "owner", "sales"]);

/**
 * "Good morning, Aline": the part of the day in Kigali, and a first name from the email when it looks like one
 * (office@ or admin@ get no name).
 */
export function greeting(now: Date, email?: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Africa/Kigali" }).format(now));
  const part = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const local = (email ?? "").split("@")[0]?.split(/[.+_-]/)[0]?.toLowerCase() ?? "";
  if (!local || GENERIC.has(local) || !/^[a-z]{2,20}$/.test(local)) return part;
  return `${part}, ${local[0].toUpperCase()}${local.slice(1)}`;
}

/** "Tuesday 10 November" in Kigali. */
export const kigaliDayLabel = (now: Date) => now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Kigali" });

const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

/** The to-do lists the Overview turns into "Needs you" lines: only the ones this person may act on (filtered by the page). */
const TODO: { key: InboxKey; href: string; icon: LucideIcon; tone: TodoItem["tone"]; text: (n: number) => string; sub: string }[] = [
  { key: "quotes", href: "/admin/quotes", icon: PhoneCall, tone: "bad", text: (n) => plural(n, "quote request to call", "quote requests to call"), sub: "They asked for a free quote on the website and expect a call." },
  { key: "payments", href: "/admin/payments", icon: Smartphone, tone: "bad", text: (n) => plural(n, "Mobile Money payment to check", "Mobile Money payments to check"), sub: "Check the money arrived, then approve or reject." },
  { key: "approvals", href: "/admin/approvals", icon: BadgeCheck, tone: "bad", text: (n) => plural(n, "money request waiting for your OK", "money requests waiting for your OK"), sub: "Refunds and plan changes: nothing happens until you approve." },
  { key: "demos", href: "/admin/demos", icon: CalendarCheck, tone: "warn", text: (n) => plural(n, "demo coming up or not marked", "demos coming up or not marked"), sub: "Booked in the next 48 hours, or past ones to mark done or no-show." },
  { key: "requests", href: "/admin/requests", icon: MessageSquarePlus, tone: "warn", text: (n) => plural(n, "new custom plan request", "new custom plan requests"), sub: "Reply with an offer or mark them contacted." },
  { key: "invoices", href: "/admin/invoices", icon: FileText, tone: "warn", text: (n) => plural(n, "invoice to check", "invoices to check"), sub: "A payment did not match, or the due date has passed." },
  { key: "offers", href: "/admin/offers?status=accepted", icon: Sparkles, tone: "warn", text: (n) => plural(n, "accepted offer waiting for payment", "accepted offers waiting for payment"), sub: "Call the client, or withdraw the offer." },
  { key: "contests", href: "/admin/inbox", icon: Sparkles, tone: "warn", text: (n) => plural(n, "contest post to confirm", "contest posts to confirm"), sub: "Open the inbox to see which." },
  { key: "reports", href: "/admin/creators", icon: Clapperboard, tone: "warn", text: (n) => plural(n, "open creator marketplace report", "open creator marketplace reports"), sub: "Hide, block or resolve them." },
  { key: "errors", href: "/admin/errors", icon: TriangleAlert, tone: "info", text: (n) => plural(n, "server error in the last 24 hours", "server errors in the last 24 hours"), sub: "Worth a look if the number keeps growing." },
];

/** Attention lines already covered by a to-do count above (same thing, said once). */
const COVERED = new Set(["payments", "approvals", "offers"]);

/**
 * "Needs you", worst first: the to-do counts this person may act on (`counts` holds only those), then the warnings and
 * problems from the health checks they may open (`attention`, already filtered). Payments use the larger of the badge
 * count and the list shown (`paymentsWaiting`).
 */
export function needsYouItems({ counts, attention, paymentsWaiting }: { counts: Partial<Record<InboxKey, number>>; attention: AttentionItem[]; paymentsWaiting?: number }): TodoItem[] {
  const todos: TodoItem[] = [];
  for (const t of TODO) {
    const n = t.key === "payments" && paymentsWaiting != null && counts.payments != null ? Math.max(paymentsWaiting, counts.payments) : counts[t.key];
    if (n && n > 0) todos.push({ key: t.key, href: t.href, icon: t.icon, tone: t.tone, text: t.text(n), sub: t.sub, count: n });
  }
  const checks: TodoItem[] = attention
    .filter((a) => !COVERED.has(a.key))
    .slice(0, 8)
    .map((a) => ({ key: `a:${a.key}`, href: a.href, icon: a.level === "problem" ? TriangleAlert : CircleAlert, tone: a.level === "problem" ? "bad" : "warn", text: a.text }));
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  // Problems first, then waiting items; the order inside each kind stays as listed.
  return [...todos, ...checks].map((t, i) => ({ t, i })).sort((a, b) => rank[a.t.tone ?? "warn"] - rank[b.t.tone ?? "warn"] || a.i - b.i).map((x) => x.t);
}

/** The "Today" tiles: what is waiting right now, each with a plain line and a link to where it is done. */
export function OverviewToday({ d }: { d: OverviewData }) {
  return (
    <StatGrid cols={4}>
      <StatTile icon={Inbox} tone="blue" label="In your inbox" value={num(d.todo.inbox)} hint="Everything waiting for you, in one list." href="/admin/inbox" alert={d.todo.inbox > 0} />
      <StatTile icon={Smartphone} tone="green" label="Payments to confirm" value={num(d.todo.payments)} hint="Mobile Money payments clients say they made." href="/admin/payments" alert={d.todo.payments > 0} />
      <StatTile icon={CalendarCheck} tone="violet" label="Demos today" value={num(d.todo.demosToday)} hint={d.todo.nextDemo ? `Next: ${d.todo.nextDemo}.` : "No demo booked for today."} href="/admin/demos" />
      <StatTile icon={TriangleAlert} tone="slate" label="Errors, 24 hours" value={num(d.todo.errors24h)} hint={d.todo.errors24h ? "Server errors since yesterday. Open to see which." : "No server errors since yesterday."} href="/admin/errors" />
    </StatGrid>
  );
}

/** Money this month: the three numbers that matter as tiles, the rest one tap (or hover) away. */
export function OverviewMoney({ d, fx = BOOKS_FMT }: { d: OverviewData; fx?: MoneyFmt }) {
  return (
    <Section
      title={`Money, ${d.monthLabel}`}
      description={`${CURRENCY_NAME[fx.display.currency]}. Revenue is card, Mobile Money and invoices; profit subtracts every cost, estimated or billed.`}
      action={<Link href="/admin/revenue" className="text-sm font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">Revenue and profit</Link>}
    >
      <StatGrid cols={3} className="grid-cols-1 sm:grid-cols-2">
        <StatTile icon={Coins} tone="green" label="Revenue this month" value={fx.amount(d.revenue.monthCents, d.rwf?.month)} title={fx.amountTitle(d.revenue.monthCents, d.rwf?.month)} delta={{ now: d.revenue.monthCents, before: d.revenue.prevCents, against: `vs ${d.prevMonthLabel}` }} spark={d.revenue.spark} hint="Money that came in since the 1st." href="/admin/revenue" />
        <StatTile icon={TrendingUp} tone="blue" label="Profit this month" value={fx.amount(d.profit.monthCents, d.rwf?.month)} title={fx.amountTitle(d.profit.monthCents, d.rwf?.month)} delta={{ now: d.profit.monthCents, before: d.profit.prevCents, against: `vs ${d.prevMonthLabel}` }} spark={d.profit.spark} alert={d.profit.monthCents < 0} hint="Revenue minus all costs." href="/admin/revenue#profit" />
        <StatTile icon={Wallet} tone="violet" label="MRR" value={fx.amount(d.mrrCents, d.rwf?.mrr)} title={fx.amountTitle(d.mrrCents, d.rwf?.mrr)} hint={d.arpuCents == null ? "No paying clients yet." : `What subscriptions bring each month. ARPU ${fx.amount(d.arpuCents, d.rwf?.arpu)} a month.`} href="/admin/revenue#mrr" className="sm:col-span-2 lg:col-span-1" />
      </StatGrid>
      <ExpandCard icon={Receipt} tone="slate" title="Costs and lifetime revenue" summary={`Costs ${fx.text(d.profit.costCents)} this month · lifetime ${fx.amount(d.revenue.lifetimeCents, d.rwf?.lifetime)}`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stat label="Costs this month" value={fx.text(d.profit.costCents)} title={fx.title(d.profit.costCents)} invert source={d.profit.estimateCents > 0 ? `${fx.text(d.profit.estimateCents)} still an estimate` : "All billed amounts"} href="/admin/costs" />
          <Stat label="Lifetime revenue" value={fx.amount(d.revenue.lifetimeCents, d.rwf?.lifetime)} title={fx.amountTitle(d.revenue.lifetimeCents, d.rwf?.lifetime)} source={`${num(d.revenue.customersEver)} paying client${d.revenue.customersEver === 1 ? "" : "s"} ever`} href="/admin/revenue#clients" />
        </div>
      </ExpandCard>
    </Section>
  );
}

/** Clients by subscription state, as one card that opens to the four numbers. */
export function OverviewClients({ d }: { d: OverviewData }) {
  return (
    <ExpandCard
      icon={Users}
      tone="blue"
      title="Clients"
      summary={`${num(d.clients.active)} paying · ${num(d.clients.trial)} on trial${d.clients.pastDue ? ` · ${num(d.clients.pastDue)} past due` : ""}`}
      aside={d.clients.pastDue ? <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[12px] font-bold text-danger">{num(d.clients.pastDue)} late</span> : undefined}
    >
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Active, paying" value={num(d.clients.active)} href="/admin/companies?status=ACTIVE" source="See them" />
        <Stat label="On trial" value={num(d.clients.trial)} href="/admin/companies?status=TRIALING" source="See them" />
        <Stat label="Past due" value={num(d.clients.pastDue)} tone={d.clients.pastDue ? "danger" : undefined} href="/admin/companies?status=PAST_DUE" source="See them" />
        <Stat label="Waiting for a demo" value={num(d.clients.waitingDemo)} href="/admin/demos" source="Demos" />
      </div>
      <p className="pt-3 text-[13px]">
        <Link href="/admin/client-health" className="font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">Client health: who needs a call</Link>
      </p>
    </ExpandCard>
  );
}

/** AI spend against the monthly cap; a reached cap shows on the card itself, not only inside. */
export function OverviewAi({ d, fx = BOOKS_FMT }: { d: OverviewData; fx?: MoneyFmt }) {
  const paused = d.ai?.paused ?? false;
  return (
    <ExpandCard
      icon={Cpu}
      tone="violet"
      title="AI this month"
      summary={d.ai ? (paused ? "The cap is reached: AI features are paused." : `${fx.text(d.ai.spentCents)} of the ${fx.text(d.ai.capCents)} monthly cap`) : "The AI ledger could not be read just now."}
      aside={d.ai ? <span className={paused ? "rounded-full bg-danger-bg px-2 py-0.5 text-[12px] font-bold text-danger" : "text-[15px] font-bold tabular-nums"}>{Math.round(d.ai.pct)}%</span> : undefined}
      defaultOpen={paused}
    >
      <div className="flex flex-col gap-3">
        {d.ai ? (
          <>
            <Gauge value={d.ai.spentCents} max={d.ai.capCents} label="AI spend vs budget" text={`${fx.text(d.ai.spentCents)} of ${fx.text(d.ai.capCents)} (${Math.round(d.ai.pct)}%)`} />
            {paused ? (
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
        <Link href="/admin/ai" className="text-[13px] font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">AI calls and spend</Link>
      </div>
    </ExpandCard>
  );
}

/** The to-do lists whose counts show as a red bubble on an area card. */
const AREA_TODOS: Record<string, InboxKey[]> = { sales: ["quotes"], clients: ["requests", "reports"], money: ["payments", "invoices"], ai: ["approvals"] };

/**
 * Each area card's key number (from what the Overview already loaded) and its waiting to-dos (from `counts`, which
 * holds only the lists this person may act on). `see` says which numbers the person may see.
 */
export function areaFigures({ counts, d, fx = BOOKS_FMT, see }: { counts: Partial<Record<InboxKey, number>>; d: OverviewData; fx?: MoneyFmt; see: { money: boolean; clients: boolean; ai: boolean; system: boolean } }): Record<string, HubFigure> {
  const out: Record<string, HubFigure> = {};
  for (const [id, keys] of Object.entries(AREA_TODOS)) {
    const n = keys.reduce((s, k) => s + (counts[k] ?? 0), 0);
    if (n > 0) out[id] = { count: n, countLabel: `${num(n)} waiting` };
  }
  const add = (id: string, f: HubFigure) => (out[id] = { ...out[id], ...f });
  if (counts.quotes != null) add("sales", { value: num(counts.quotes), valueLabel: counts.quotes === 1 ? "quote request to call" : "quote requests to call" });
  if (see.clients) add("clients", { value: num(d.clients.active), valueLabel: d.clients.active === 1 ? "paying client" : "paying clients" });
  if (see.money) add("money", { value: fx.amount(d.revenue.monthCents, d.rwf?.month), valueLabel: "revenue this month" });
  else if (counts.payments != null) add("money", { value: num(counts.payments), valueLabel: "payments to confirm" });
  if (see.ai && d.ai) add("ai", { value: `${Math.round(d.ai.pct)}%`, valueLabel: d.ai.paused ? "cap reached: AI paused" : "of the monthly AI cap" });
  if (see.system) add("system", { value: num(d.todo.errors24h), valueLabel: d.todo.errors24h === 1 ? "error in 24 hours" : "errors in 24 hours" });
  return out;
}

/**
 * One card per area the person may open (pass navFor's groups): icon, name, one-line hint, and the area's key number
 * and waiting to-dos from `figures` (by group id). Each opens the area's hub, or its only page.
 */
export function AreaCards({ groups, figures = {} }: { groups: AdminNavGroup[]; figures?: Record<string, HubFigure> }) {
  return (
    <SectionGrid cols={4} className="grid-cols-2 gap-2.5 sm:gap-3">
      {groups
        .filter((g) => g.title && g.icon)
        .map((g) => {
          const f = figures[g.id] ?? {};
          return (
            <SectionCard
              key={g.id}
              href={groupHref(g)}
              icon={g.icon!}
              tone={g.tone}
              title={g.title!}
              hint={g.items.length === 1 ? g.items[0].description : g.hint}
              value={f.value}
              valueLabel={f.valueLabel}
              count={f.count}
              countTone={f.countTone}
              countLabel={f.countLabel}
            />
          );
        })}
    </SectionGrid>
  );
}

/** The Overview's numbers: today's to-dos, money this month, clients and AI. Every number links to its page. */
export function OverviewDashboard({ d, show = { money: true, clients: true, ai: true }, fx = BOOKS_FMT, today = true }: { d: OverviewData; show?: { money: boolean; clients: boolean; ai: boolean }; /** Money in the admin's display currency. */ fx?: MoneyFmt; /** Include the Today tiles (the Overview page places them itself). */ today?: boolean }) {
  const side: ReactNode[] = [];
  if (show.clients) side.push(<OverviewClients key="c" d={d} />);
  if (show.ai) side.push(<OverviewAi key="a" d={d} fx={fx} />);
  return (
    <>
      {today && (
        <Section title="Today" description="What is waiting for you right now.">
          <OverviewToday d={d} />
        </Section>
      )}
      {show.money && <OverviewMoney d={d} fx={fx} />}
      {side.length > 0 && (
        <Section title="Clients and AI" description="Hover or tap a card for the details.">
          <div className="grid items-start gap-3 lg:grid-cols-2">{side}</div>
        </Section>
      )}
    </>
  );
}
