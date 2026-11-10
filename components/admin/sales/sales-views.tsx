import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import { NO_RWF, sumRwf } from "@/lib/money/revenue-shared";
import type { ReactNode } from "react";
import { ArrowRightLeft, Coins, Contact as ContactIcon, Crown, Hash, Link2, Medal, Share2, Trophy, UserRound, Users } from "lucide-react";
import { CARD, DataList, EmptyState, ExpandCard, FilterChips, IconBadge, StatGrid, StatTile, StatusPill } from "@/components/admin/kit";
import { ContactCircles, daysAgo } from "@/components/admin/business/shared";
import { Button, Input, Select } from "@/components/ui";
import { CopyButton } from "@/components/studio/copy-button";
import { mailtoLink, whatsappLink } from "@/lib/admin/client-health-shared";
import { dateTime, num } from "@/lib/admin/format";
import type { LeaderRow } from "@/lib/sales/attribution";
import type { Reassignment, SalesClient, TeamMember } from "@/lib/sales/clients";
import { REASON_MAX, REASON_MIN } from "@/lib/sales/assign-rules";
import { cn } from "@/lib/cn";
import { Empty, HowCalculated, Panel, Section } from "../ui";

// Admin -> Sales: My clients, Sales team and Leaderboard. Plain data in, no database: tests render them directly.

const DAY = 86_400_000;
const STATUS_LABEL: Record<string, string> = { PENDING_DEMO: "Waiting for demo", TRIALING: "On trial", ACTIVE: "Paying", PAST_DUE: "Payment late", CANCELED: "Cancelled", EXPIRED: "Expired" };
const STATUS_TONE: Record<string, "muted" | "info" | "new" | "good" | "bad"> = { PENDING_DEMO: "new", TRIALING: "info", ACTIVE: "good", PAST_DUE: "bad", CANCELED: "muted", EXPIRED: "muted" };

export const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function trialLeft(c: SalesClient, now: number): string {
  if (c.status !== "TRIALING" || !c.trialEndsAt) return "-";
  const days = Math.ceil((Date.parse(c.trialEndsAt) - now) / DAY);
  return days <= 0 ? "Ends today" : days === 1 ? "1 day" : `${days} days`;
}

function Contact({ c }: { c: SalesClient }) {
  const wa = whatsappLink(c.phone, `Hello${c.contactName ? ` ${c.contactName}` : ""}, this is BuPulse. How is ${c.name} getting on? Can I help with anything?`);
  const mail = mailtoLink(c.email, `BuPulse: ${c.name}`);
  return (
    <span className="flex flex-col gap-1">
      <ContactCircles name={c.name} wa={wa} mail={mail} />
      {c.phone && <span className="text-xs text-muted tabular-nums">{c.phone}</span>}
      {c.email && <span className="break-all text-xs text-muted">{c.email}</span>}
    </span>
  );
}

function Payment({ c, fx }: { c: SalesClient; fx: MoneyFmt }) {
  return (
    <span className="flex flex-col gap-1">
      {c.status ? <StatusPill tone={STATUS_TONE[c.status] ?? "muted"} dot className="w-fit">{STATUS_LABEL[c.status] ?? c.status}</StatusPill> : <span className="text-muted">No plan</span>}
      <span className="text-xs text-muted">{c.lastPayment ? `Last paid ${fx.amount(c.lastPayment.usdCents, c.lastPayment.currency === "RWF" && c.lastPayment.localMinor !== null ? { rwfMinor: c.lastPayment.localMinor, rwfUsdCents: c.lastPayment.usdCents } : null)}, ${dateTime(c.lastPayment.at)}` : "No payment yet"}</span>
    </span>
  );
}

/** The company name (the list links it to its admin page only for staff who may see all clients) and the contact. */
function ClientName({ c }: { c: SalesClient }) {
  return (
    <span className="flex flex-col">
      <span>{c.name}</span>
      {c.contactName && <span className="text-xs font-normal text-muted">{c.contactName}</span>}
    </span>
  );
}

function LinkPanel({ link }: { link: { url: string; code: string } }) {
  const share = `https://wa.me/?text=${encodeURIComponent(`Try BuPulse for your business: ${link.url}`)}`;
  return (
    <section aria-label="My link" className={cn("relative flex flex-col gap-4 overflow-hidden p-5 sm:p-6", CARD)}>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-brand-gradient" />
      <div className="flex items-start gap-3">
        <IconBadge icon={Link2} tone="orange" />
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold leading-snug tracking-[-0.02em]">My link</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">Share it anywhere. Anyone who signs up within 30 days of first opening it becomes your client. Add it to any page, for example /pricing?ref=CODE.</p>
        </div>
      </div>
      <p className="break-all rounded-2xl bg-soft px-4 py-3 font-mono text-[15px]">{link.url}</p>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={link.url} label="Copy link" variant="outline" />
        <a href={share} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-success-bg px-4 text-sm font-semibold text-success focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30">
          <Share2 aria-hidden className="size-4" />
          Share on WhatsApp
        </a>
        <span className="text-[13px] text-muted">
          Code <span className="font-mono font-semibold text-text">{link.code}</span>
        </span>
      </div>
    </section>
  );
}

function ClientsList({ clients, now, link, agentOf, reassign, fx }: { clients: SalesClient[]; now: number; link: boolean; fx: MoneyFmt; agentOf?: (c: SalesClient) => string; reassign?: (c: SalesClient) => ReactNode }) {
  return (
    <DataList<SalesClient>
      caption="Clients"
      rows={clients}
      rowKey={(c) => c.businessId}
      rowHref={link ? (c) => `/admin/companies/${encodeURIComponent(c.businessId)}` : undefined}
      columns={[
        { key: "name", header: "Company", primary: true, cell: (c) => <ClientName c={c} /> },
        { key: "contact", header: "Contact", cell: (c) => <Contact c={c} /> },
        { key: "plan", header: "Plan", cell: (c) => c.plan ?? "-", hideOnPhone: true },
        { key: "trial", header: "Trial left", cell: (c) => trialLeft(c, now) },
        { key: "seen", header: "Last sign-in", cell: (c) => daysAgo(c.lastSignInAt, now) },
        { key: "posts", header: "Posts", align: "right", cell: (c) => num(c.posts), hideOnPhone: true },
        { key: "pay", header: "Payment", cell: (c) => <Payment c={c} fx={fx} /> },
        ...(agentOf
          ? [
              {
                key: "agent",
                header: "Agent",
                cell: (c: SalesClient) => (
                  <span className="flex flex-col gap-1">
                    <span>{agentOf(c)}</span>
                    {reassign?.(c)}
                  </span>
                ),
              },
            ]
          : []),
      ]}
      empty={<EmptyState icon={Users} title="No clients yet." />}
    />
  );
}

function Numbers({ row, rank, of, month, fx }: { row: LeaderRow | null; rank: number | null; of: number; month: string; fx: MoneyFmt }) {
  return (
    <Section title={`My numbers, ${monthName(month)}`} description="USD, net of refunds. Performance only.">
      <StatGrid cols={4}>
        <StatTile icon={Coins} tone="orange" label="Own sales" value={fx.amount(row?.ownCents ?? 0, row?.ownRwf)} title={fx.amountTitle(row?.ownCents ?? 0, row?.ownRwf)} hint="Payments of your clients." />
        <StatTile icon={Users} tone="orange" label="Team share" value={fx.amount(row?.teamShareCents ?? 0, row?.teamShareRwf)} title={fx.amountTitle(row?.teamShareCents ?? 0, row?.teamShareRwf)} hint="Unassigned clients, split equally." />
        <StatTile icon={Trophy} tone="orange" label="Total" value={fx.amount(row?.totalCents ?? 0, row?.totalRwf)} title={fx.amountTitle(row?.totalCents ?? 0, row?.totalRwf)} hint="Own sales plus team share." />
        <StatTile icon={Medal} tone="orange" label="Rank" value={rank ? `${rank} of ${of}` : "-"} hint="Where you stand on the leaderboard." href="/admin/sales/leaderboard" />
      </StatGrid>
    </Section>
  );
}

export type MyClientsData = {
  /** False for an owner signed in from ADMIN_EMAILS: no staff record, no clients or link. */
  isStaff: boolean;
  clients: SalesClient[];
  link: { url: string; code: string } | null;
  month: string;
  board: LeaderRow[];
  staffId: string | null;
  /** May open /admin/companies (clients.view). */
  canViewClients: boolean;
  now: number;
};

export function MyClientsView({ d, fx = BOOKS_FMT }: { d: MyClientsData; /** Money in the admin's display currency. */ fx?: MoneyFmt }) {
  if (!d.isStaff) {
    return <Empty>This page is for sales staff: it shows the clients assigned to the signed-in staff member. Add yourself as staff with a sales role to get a link and clients, or open Sales team to see every agent.</Empty>;
  }
  const i = d.board.findIndex((r) => r.staffId === d.staffId);
  return (
    <>
      {d.link && <LinkPanel link={d.link} />}
      <Numbers row={i >= 0 ? d.board[i] : null} rank={i >= 0 ? i + 1 : null} of={d.board.length} month={d.month} fx={fx} />
      <Panel icon={ContactIcon} tone="orange" title="My clients" description="Companies assigned to you: how to reach them and how they stand. Nothing of their content or settings.">
        {d.clients.length === 0 ? <Empty>No clients yet. Share your link: a company that signs up through it is yours.</Empty> : <ClientsList clients={d.clients} now={d.now} link={d.canViewClients} fx={fx} />}
      </Panel>
    </>
  );
}

export type TeamData = {
  members: TeamMember[];
  board: LeaderRow[];
  clients: SalesClient[];
  reassignments: Reassignment[];
  month: string;
  canViewClients: boolean;
  canReassign: boolean;
  now: number;
};

function ReassignForm({ c, members, action }: { c: SalesClient; members: TeamMember[]; action: (f: FormData) => Promise<void> }) {
  const choices = members.filter((m) => m.status !== "disabled");
  return (
    <details className="text-[13px]">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-semibold text-pulse-blue dark:text-[#8db0ff]">
        <ArrowRightLeft aria-hidden className="size-3.5" /> Reassign
      </summary>
      <form action={action} className="mt-2 flex min-w-56 flex-col gap-2">
        <input type="hidden" name="businessId" value={c.businessId} />
        <label className="flex flex-col gap-1">
          <span>New agent</span>
          <Select name="staffId" defaultValue={c.agentId ?? ""}>
            <option value="">Unassigned (team share)</option>
            {choices.map((m) => (
              <option key={m.staffId} value={m.staffId}>{m.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Reason</span>
          <Input name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} placeholder="For example: agent left, client asked" />
        </label>
        <Button type="submit" size="sm">Reassign</Button>
      </form>
    </details>
  );
}

export function TeamView({ d, reassignAction, fx = BOOKS_FMT }: { d: TeamData; reassignAction?: (f: FormData) => Promise<void>; fx?: MoneyFmt }) {
  const rowOf = new Map(d.board.map((r) => [r.staffId, r]));
  const nameOf = new Map(d.members.map((m) => [m.staffId, m.name]));
  const clientsOf = (id: string) => d.clients.filter((c) => c.agentId === id).length;
  const unassigned = d.clients.filter((c) => !c.agentId).length;
  const total = d.board.reduce((s, r) => s + r.totalCents, 0);
  const totalRwf = sumRwf(d.board.map((r) => r.totalRwf ?? NO_RWF));
  return (
    <>
      <StatGrid cols={4}>
        <StatTile icon={UserRound} tone="orange" label="Agents" value={num(d.members.filter((m) => m.status === "active").length)} hint="Active staff with a sales role." />
        <StatTile icon={Users} tone="orange" label="Clients" value={num(d.clients.length)} hint="Every company, with or without an agent." />
        <StatTile icon={Hash} tone="orange" label="Unassigned" value={num(unassigned)} hint="Their payments are the team share." />
        <StatTile className="max-lg:col-span-2" icon={Coins} tone="orange" label={`Sales, ${monthName(d.month)}`} value={fx.amount(total, totalRwf)} title={fx.amountTitle(total, totalRwf)} hint="Every agent's total this month." href="/admin/sales/leaderboard" />
      </StatGrid>
      <Panel icon={UserRound} tone="orange" title="Agents" description={`Everyone with a sales role, their code and their numbers for ${monthName(d.month)} (${fx.display.currency}).`}>
        {d.members.length === 0 ? (
          <Empty>No sales staff yet. Add a staff member with the Sales agent or Sales manager role.</Empty>
        ) : (
          <DataList<TeamMember>
            caption="Sales agents"
            rows={d.members}
            rowKey={(m) => m.staffId}
            columns={[
              { key: "agent", header: "Agent", primary: true, cell: (m) => <span className="flex flex-col"><span>{m.name}</span><span className="text-xs font-normal text-muted">{m.status === "active" ? m.email : `${m.email}, ${m.status}`}</span></span> },
              { key: "role", header: "Role", cell: (m) => m.roleName, hideOnPhone: true },
              { key: "code", header: "Code", cell: (m) => <span className="font-mono">{m.refCode ?? "Not yet"}</span> },
              { key: "clients", header: "Clients", align: "right", cell: (m) => num(clientsOf(m.staffId)) },
              { key: "own", header: "Own sales", align: "right", cell: (m) => fx.amountEl(rowOf.get(m.staffId)?.ownCents ?? 0, rowOf.get(m.staffId)?.ownRwf), hideOnPhone: true },
              { key: "share", header: "Team share", align: "right", cell: (m) => fx.amountEl(rowOf.get(m.staffId)?.teamShareCents ?? 0, rowOf.get(m.staffId)?.teamShareRwf), hideOnPhone: true },
              { key: "total", header: "Total", align: "right", cell: (m) => <span className="font-semibold">{fx.amountEl(rowOf.get(m.staffId)?.totalCents ?? 0, rowOf.get(m.staffId)?.totalRwf)}</span> },
            ]}
          />
        )}
      </Panel>
      <Panel icon={Users} tone="orange" title="Clients and their agent" description={`${num(d.clients.length)} companies, ${num(unassigned)} unassigned. A reassignment counts from now on; earlier payments stay with the agent who had the client then.`}>
        {d.clients.length === 0 ? (
          <Empty>No clients yet.</Empty>
        ) : (
          <ClientsList
            fx={fx}
            clients={d.clients}
            now={d.now}
            link={d.canViewClients}
            agentOf={(c) => (c.agentId ? (nameOf.get(c.agentId) ?? "Former staff member") : "Unassigned")}
            reassign={d.canReassign && reassignAction ? (c) => <ReassignForm c={c} members={d.members} action={reassignAction} /> : undefined}
          />
        )}
      </Panel>
      <ExpandCard icon={ArrowRightLeft} tone="orange" title="Recent reassignments" summary={d.reassignments.length === 0 ? "No reassignments yet." : `${d.reassignments.length} recent, latest ${dateTime(d.reassignments[0].at)}`}>
        <p className="pb-3 text-[13px] text-muted">The latest changes made by a manager, with their reason.</p>
        <DataList<Reassignment>
          caption="Recent reassignments"
          rows={d.reassignments}
          rowKey={(r) => r.id}
          columns={[
            { key: "client", header: "Client", primary: true, cell: (r) => r.client },
            { key: "when", header: "When", cell: (r) => dateTime(r.at) },
            { key: "agent", header: "New agent", cell: (r) => r.agent ?? "Unassigned" },
            { key: "reason", header: "Reason", cell: (r) => r.reason ?? "-" },
            { key: "by", header: "By", cell: (r) => <span className="text-xs text-muted">{r.by}</span>, hideOnPhone: true },
          ]}
          empty={<Empty>No reassignments yet.</Empty>}
        />
      </ExpandCard>
    </>
  );
}

export function LeaderboardHow() {
  return (
    <HowCalculated>
      <ul>
        <li>Own sales: every payment of a client, net of refunds, counts for the agent assigned to that client at the moment of the payment. A reassignment counts from that moment; earlier payments stay with the earlier agent.</li>
        <li>Team share: payments of clients with no agent at that moment are added up and split equally across the agents active that month.</li>
        <li>Active that month: a staff member with a sales role (Sales agent, Sales manager, or any role with My clients), added before the month ended and not disabled before it began.</li>
        <li>Total = own sales + team share. USD, calendar months in Kigali time. Performance only: no commission is worked out here.</li>
      </ul>
    </HowCalculated>
  );
}

const PODIUM = [
  { label: "1st", ring: "ring-2 ring-[#fbbf24]/60", icon: Crown },
  { label: "2nd", ring: "ring-1 ring-line", icon: Medal },
  { label: "3rd", ring: "ring-1 ring-line", icon: Medal },
] as const;

export function LeaderboardView({ rows, month, months, me, fx = BOOKS_FMT, base = "/admin/sales/leaderboard" }: { rows: LeaderRow[]; month: string; months: string[]; me?: string | null; fx?: MoneyFmt; base?: string }) {
  const top = rows.slice(0, 3).filter((r) => r.totalCents > 0);
  return (
    <>
      <FilterChips label="Month" param="month" base={base} current={month} allValue={months[0]} options={months.map((m) => ({ value: m, label: monthName(m) }))} />
      {top.length > 0 && (
        <ol aria-label={`Top agents, ${monthName(month)}`} className="kit-rise grid grid-cols-1 gap-3 sm:grid-cols-3">
          {top.map((r, i) => (
            <li key={r.staffId} className={cn("flex items-center gap-3 p-4 sm:flex-col sm:items-start sm:p-5", CARD, PODIUM[i].ring)}>
              <IconBadge icon={PODIUM[i].icon} tone={i === 0 ? "orange" : "slate"} size="lg" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">{PODIUM[i].label}</span>
                <span className="truncate text-[16px] font-bold">{r.name}{r.staffId === me ? " (you)" : ""}</span>
                <span className="text-[13px] text-muted">{num(r.clients)} {r.clients === 1 ? "client" : "clients"}</span>
              </span>
              <span className="text-[20px] font-bold tabular-nums tracking-[-0.02em] sm:text-[24px]">{fx.amountEl(r.totalCents, r.totalRwf)}</span>
            </li>
          ))}
        </ol>
      )}
      <Panel icon={Trophy} tone="orange" title={`Leaderboard, ${monthName(month)}`} description="Net of refunds. Highest total first.">
        {rows.length === 0 ? (
          <Empty>No sales agents that month.</Empty>
        ) : (
          <DataList<LeaderRow>
            caption={`Leaderboard for ${monthName(month)}`}
            rows={rows}
            rowKey={(r) => r.staffId}
            columns={[
              { key: "agent", header: "Agent", primary: true, cell: (r) => <span className="inline-flex items-center gap-2"><span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-soft text-[12px] font-bold tabular-nums">{rows.indexOf(r) + 1}</span><span className={r.staffId === me ? "text-pulse-blue dark:text-[#8db0ff]" : undefined}>{r.name}{r.staffId === me ? " (you)" : ""}</span></span> },
              { key: "clients", header: "Clients", align: "right", cell: (r) => num(r.clients) },
              { key: "own", header: "Own sales", align: "right", cell: (r) => fx.amountEl(r.ownCents, r.ownRwf) },
              { key: "share", header: "Team share", align: "right", cell: (r) => fx.amountEl(r.teamShareCents, r.teamShareRwf) },
              { key: "total", header: "Total", align: "right", cell: (r) => <span className="font-semibold">{fx.amountEl(r.totalCents, r.totalRwf)}</span> },
            ]}
          />
        )}
        <LeaderboardHow />
      </Panel>
    </>
  );
}
