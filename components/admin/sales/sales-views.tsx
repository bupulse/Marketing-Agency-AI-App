import Link from "next/link";
import type { ReactNode } from "react";
import { Mail, MessageCircle, Share2 } from "lucide-react";
import { Badge, Button, Input, Select } from "@/components/ui";
import { CopyButton } from "@/components/studio/copy-button";
import { mailtoLink, whatsappLink } from "@/lib/admin/client-health-shared";
import { dateTime, money, num } from "@/lib/admin/format";
import type { LeaderRow } from "@/lib/sales/attribution";
import type { Reassignment, SalesClient, TeamMember } from "@/lib/sales/clients";
import { REASON_MAX, REASON_MIN } from "@/lib/sales/assign-rules";
import { Empty, HowCalculated, Panel, Section, Stat, TableWrap, Td, Th } from "../ui";

// Admin -> Sales: My clients, Sales team and Leaderboard. Plain data in, no database: tests render them directly.

const DAY = 86_400_000;
const STATUS_LABEL: Record<string, string> = { PENDING_DEMO: "Waiting for demo", TRIALING: "On trial", ACTIVE: "Paying", PAST_DUE: "Payment late", CANCELED: "Cancelled", EXPIRED: "Expired" };
const STATUS_TONE: Record<string, "neutral" | "blue" | "violet" | "success" | "danger"> = { PENDING_DEMO: "violet", TRIALING: "blue", ACTIVE: "success", PAST_DUE: "danger", CANCELED: "neutral", EXPIRED: "neutral" };

export const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function daysAgo(iso: string | null, now: number): string {
  if (!iso) return "Never";
  const days = Math.floor((now - Date.parse(iso)) / DAY);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

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
      <span className="flex gap-1.5">
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${c.name}`} className="inline-flex size-11 items-center justify-center rounded-full bg-success-bg text-success">
            <MessageCircle aria-hidden className="size-4" />
          </a>
        ) : (
          <span title="No phone number on file" className="inline-flex size-11 items-center justify-center rounded-full bg-soft text-muted opacity-50" aria-hidden>
            <MessageCircle className="size-4" />
          </span>
        )}
        {mail && (
          <a href={mail} aria-label={`Email ${c.name}`} className="inline-flex size-11 items-center justify-center rounded-full bg-ok-bg text-ok">
            <Mail aria-hidden className="size-4" />
          </a>
        )}
      </span>
      {c.phone && <span className="text-xs text-muted tabular-nums">{c.phone}</span>}
      {c.email && <span className="break-all text-xs text-muted">{c.email}</span>}
    </span>
  );
}

function Payment({ c }: { c: SalesClient }) {
  return (
    <span className="flex flex-col gap-1">
      {c.status ? <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{STATUS_LABEL[c.status] ?? c.status}</Badge> : <span className="text-muted">No plan</span>}
      <span className="text-xs text-muted">{c.lastPayment ? `Last paid ${money(c.lastPayment.usdCents)}, ${dateTime(c.lastPayment.at)}` : "No payment yet"}</span>
    </span>
  );
}

/** The company name, linked to its admin page only for staff who may see all clients. */
function ClientName({ c, link }: { c: SalesClient; link: boolean }) {
  return (
    <span className="flex flex-col">
      {link ? (
        <Link href={`/admin/companies/${encodeURIComponent(c.businessId)}`} className="font-medium underline">
          {c.name}
        </Link>
      ) : (
        <span className="font-medium">{c.name}</span>
      )}
      {c.contactName && <span className="text-xs text-muted">{c.contactName}</span>}
    </span>
  );
}

function LinkPanel({ link }: { link: { url: string; code: string } }) {
  const share = `https://wa.me/?text=${encodeURIComponent(`Try BuPulse for your business: ${link.url}`)}`;
  return (
    <Panel title="My link" description="Share it anywhere. Anyone who signs up within 30 days of first opening it becomes your client. Add it to any page, for example /pricing?ref=CODE.">
      <div className="flex flex-col gap-3">
        <p className="break-all rounded-2xl bg-soft px-4 py-3 font-mono text-[15px]">{link.url}</p>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={link.url} label="Copy link" variant="outline" />
          <a href={share} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-success-bg px-4 text-sm font-medium text-success">
            <Share2 aria-hidden className="size-4" />
            Share on WhatsApp
          </a>
          <span className="text-[13px] text-muted">
            Code <span className="font-mono font-semibold text-text">{link.code}</span>
          </span>
        </div>
      </div>
    </Panel>
  );
}

function ClientsTable({ clients, now, link, agentOf, reassign }: { clients: SalesClient[]; now: number; link: boolean; agentOf?: (c: SalesClient) => string; reassign?: (c: SalesClient) => ReactNode }) {
  return (
    <TableWrap caption="Clients" tall>
      <thead>
        <tr>
          <Th>Company</Th>
          <Th>Contact</Th>
          <Th>Plan</Th>
          <Th>Trial left</Th>
          <Th>Last sign-in</Th>
          <Th right>Posts</Th>
          <Th>Payment</Th>
          {agentOf && <Th>Agent</Th>}
        </tr>
      </thead>
      <tbody>
        {clients.map((c) => (
          <tr key={c.businessId}>
            <Td><ClientName c={c} link={link} /></Td>
            <Td><Contact c={c} /></Td>
            <Td>{c.plan ?? "-"}</Td>
            <Td>{trialLeft(c, now)}</Td>
            <Td>{daysAgo(c.lastSignInAt, now)}</Td>
            <Td right>{num(c.posts)}</Td>
            <Td><Payment c={c} /></Td>
            {agentOf && (
              <Td>
                <span className="flex flex-col gap-1">
                  <span>{agentOf(c)}</span>
                  {reassign?.(c)}
                </span>
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

function Numbers({ row, rank, of, month }: { row: LeaderRow | null; rank: number | null; of: number; month: string }) {
  return (
    <Section title={`My numbers, ${monthName(month)}`} description="USD, net of refunds. Performance only.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Own sales" value={money(row?.ownCents ?? 0)} source="Payments of your clients" />
        <Stat label="Team share" value={money(row?.teamShareCents ?? 0)} source="Unassigned clients, split equally" />
        <Stat label="Total" value={money(row?.totalCents ?? 0)} />
        <Stat label="Rank" value={rank ? `${rank} of ${of}` : "-"} href="/admin/sales/leaderboard" source="Leaderboard" />
      </div>
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

export function MyClientsView({ d }: { d: MyClientsData }) {
  if (!d.isStaff) {
    return <Empty>This page is for sales staff: it shows the clients assigned to the signed-in staff member. Add yourself as staff with a sales role to get a link and clients, or open Sales team to see every agent.</Empty>;
  }
  const i = d.board.findIndex((r) => r.staffId === d.staffId);
  return (
    <>
      {d.link && <LinkPanel link={d.link} />}
      <Numbers row={i >= 0 ? d.board[i] : null} rank={i >= 0 ? i + 1 : null} of={d.board.length} month={d.month} />
      <Panel title="My clients" description="Companies assigned to you: how to reach them and how they stand. Nothing of their content or settings.">
        {d.clients.length === 0 ? <Empty>No clients yet. Share your link: a company that signs up through it is yours.</Empty> : <ClientsTable clients={d.clients} now={d.now} link={d.canViewClients} />}
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
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium underline">Reassign</summary>
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

export function TeamView({ d, reassignAction }: { d: TeamData; reassignAction?: (f: FormData) => Promise<void> }) {
  const rowOf = new Map(d.board.map((r) => [r.staffId, r]));
  const nameOf = new Map(d.members.map((m) => [m.staffId, m.name]));
  const clientsOf = (id: string) => d.clients.filter((c) => c.agentId === id).length;
  const unassigned = d.clients.filter((c) => !c.agentId).length;
  return (
    <>
      <Panel title="Agents" description={`Everyone with a sales role, their code and their numbers for ${monthName(d.month)} (USD).`}>
        {d.members.length === 0 ? (
          <Empty>No sales staff yet. Add a staff member with the Sales agent or Sales manager role.</Empty>
        ) : (
          <TableWrap caption="Sales agents">
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Role</Th>
                <Th>Code</Th>
                <Th right>Clients</Th>
                <Th right>Own sales</Th>
                <Th right>Team share</Th>
                <Th right>Total</Th>
              </tr>
            </thead>
            <tbody>
              {d.members.map((m) => {
                const r = rowOf.get(m.staffId);
                return (
                  <tr key={m.staffId}>
                    <Td>
                      <span className="flex flex-col">
                        <span className="font-medium">{m.name}</span>
                        <span className="text-xs text-muted">{m.status === "active" ? m.email : `${m.email}, ${m.status}`}</span>
                      </span>
                    </Td>
                    <Td>{m.roleName}</Td>
                    <Td><span className="font-mono">{m.refCode ?? "Not yet"}</span></Td>
                    <Td right>{num(clientsOf(m.staffId))}</Td>
                    <Td right>{money(r?.ownCents ?? 0)}</Td>
                    <Td right>{money(r?.teamShareCents ?? 0)}</Td>
                    <Td right>{money(r?.totalCents ?? 0)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>
      <Panel title="Clients and their agent" description={`${num(d.clients.length)} companies, ${num(unassigned)} unassigned. A reassignment counts from now on; earlier payments stay with the agent who had the client then.`}>
        {d.clients.length === 0 ? (
          <Empty>No clients yet.</Empty>
        ) : (
          <ClientsTable
            clients={d.clients}
            now={d.now}
            link={d.canViewClients}
            agentOf={(c) => (c.agentId ? (nameOf.get(c.agentId) ?? "Former staff member") : "Unassigned")}
            reassign={d.canReassign && reassignAction ? (c) => <ReassignForm c={c} members={d.members} action={reassignAction} /> : undefined}
          />
        )}
      </Panel>
      <Panel title="Recent reassignments" description="The latest changes made by a manager, with their reason.">
        {d.reassignments.length === 0 ? (
          <Empty>No reassignments yet.</Empty>
        ) : (
          <TableWrap caption="Recent reassignments">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Client</Th>
                <Th>New agent</Th>
                <Th>Reason</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {d.reassignments.map((r) => (
                <tr key={r.id}>
                  <Td>{dateTime(r.at)}</Td>
                  <Td>{r.client}</Td>
                  <Td>{r.agent ?? "Unassigned"}</Td>
                  <Td>{r.reason ?? "-"}</Td>
                  <Td><span className="text-xs text-muted">{r.by}</span></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
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
        <li>Total = own sales + team share. USD, calendar months in UTC. Performance only: no commission is worked out here.</li>
      </ul>
    </HowCalculated>
  );
}

export function LeaderboardView({ rows, month, months, me }: { rows: LeaderRow[]; month: string; months: string[]; me?: string | null }) {
  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-medium text-muted">
          Month
          <Select name="month" defaultValue={month}>
            {months.map((m) => (
              <option key={m} value={m}>{monthName(m)}</option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline">Show</Button>
      </form>
      <Panel title={`Leaderboard, ${monthName(month)}`} description="USD, net of refunds. Highest total first.">
        {rows.length === 0 ? (
          <Empty>No sales agents that month.</Empty>
        ) : (
          <TableWrap caption={`Leaderboard for ${monthName(month)}`}>
            <thead>
              <tr>
                <Th right>#</Th>
                <Th>Agent</Th>
                <Th right>Clients</Th>
                <Th right>Own sales</Th>
                <Th right>Team share</Th>
                <Th right>Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.staffId} aria-current={r.staffId === me ? "true" : undefined} className={r.staffId === me ? "bg-soft" : undefined}>
                  <Td right>{i + 1}</Td>
                  <Td><span className="font-medium">{r.name}{r.staffId === me ? " (you)" : ""}</span></Td>
                  <Td right>{num(r.clients)}</Td>
                  <Td right>{money(r.ownCents)}</Td>
                  <Td right>{money(r.teamShareCents)}</Td>
                  <Td right className="font-semibold">{money(r.totalCents)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <LeaderboardHow />
      </Panel>
    </>
  );
}
