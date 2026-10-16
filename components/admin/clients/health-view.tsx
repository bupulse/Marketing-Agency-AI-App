import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui";
import type { ClientRow } from "@/lib/admin/client-health";
import { FLAG_LABEL, mailtoLink, whatsappLink, type HealthFlag } from "@/lib/admin/client-health-shared";
import { num } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import { Empty, HowCalculated, Panel, Stat, TableWrap, Td, Th } from "../ui";

const FLAGS: HealthFlag[] = ["past_due", "trial_ending", "inactive", "low_usage", "waiting_demo", "suspended"];
const RISK_TONE = { high: "danger", medium: "violet", ok: "success" } as const;

function lastSeen(iso: string | null, now: number): string {
  if (!iso) return "Never";
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

function opener(row: ClientRow): string {
  if (row.flags.includes("past_due")) return `Hello from BuPulse! Your ${row.name} subscription payment did not go through. Can I help you renew it?`;
  if (row.flags.includes("trial_ending")) return `Hello from BuPulse! Your free trial for ${row.name} ends soon. Do you have any questions before choosing a plan?`;
  return `Hello from BuPulse! How is ${row.name} getting on with BuPulse? Can I help with anything?`;
}

/** One-click WhatsApp and email, prefilled for the client's situation. */
export function ContactLinks({ row }: { row: ClientRow }) {
  const wa = whatsappLink(row.phone, opener(row));
  const mail = mailtoLink(row.email, `BuPulse: ${row.name}`);
  return (
    <span className="flex gap-1.5">
      {wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${row.name}`} className="inline-flex size-11 items-center justify-center rounded-full bg-success-bg text-success">
          <MessageCircle aria-hidden className="size-4" />
        </a>
      ) : (
        <span title="No phone number on file" className="inline-flex size-11 items-center justify-center rounded-full bg-soft text-muted opacity-50" aria-hidden>
          <MessageCircle className="size-4" />
        </span>
      )}
      {mail && (
        <a href={mail} aria-label={`Email ${row.name}`} className="inline-flex size-11 items-center justify-center rounded-full bg-ok-bg text-ok">
          <Mail aria-hidden className="size-4" />
        </a>
      )}
    </span>
  );
}

export function ClientHealthView({ rows, flag, now }: { rows: ClientRow[]; flag: HealthFlag | "all" | null; now: number }) {
  const count = (f: HealthFlag) => rows.filter((r) => r.flags.includes(f)).length;
  const live = rows.filter((r) => r.status === "ACTIVE" || r.status === "TRIALING" || r.status === "PAST_DUE");
  const active7 = live.filter((r) => !r.flags.includes("inactive")).length;
  const shown = flag === "all" ? rows : flag ? rows.filter((r) => r.flags.includes(flag)) : rows.filter((r) => r.score > 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Active in the last 7 days" value={`${num(active7)} of ${num(live.length)}`} source="Paying, trial or past due" />
        <Stat label="Inactive 7 days" value={num(count("inactive"))} href="/admin/client-health?flag=inactive" source="Show them" tone={count("inactive") ? "danger" : undefined} />
        <Stat label="Trial ends in 3 days" value={num(count("trial_ending"))} href="/admin/client-health?flag=trial_ending" source="Show them" />
        <Stat label="Past due" value={num(count("past_due"))} href="/admin/client-health?flag=past_due" source="Show them" tone={count("past_due") ? "danger" : undefined} />
        <Stat label="Low usage" value={num(count("low_usage"))} href="/admin/client-health?flag=low_usage" source="Show them" />
      </div>

      <nav aria-label="Filter clients" className="flex flex-wrap gap-2">
        <Link href="/admin/client-health" aria-current={!flag ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium no-underline", !flag && "bg-soft")}>Needs attention</Link>
        {FLAGS.map((f) => (
          <Link key={f} href={`/admin/client-health?flag=${f}`} aria-current={flag === f ? "page" : undefined} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium no-underline", flag === f && "bg-soft")}>
            {FLAG_LABEL[f]} <span className="tabular-nums text-muted">{count(f)}</span>
          </Link>
        ))}
        <Link href="/admin/client-health?flag=all" aria-current={flag === "all" ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium no-underline", flag === "all" && "bg-soft")}>Everyone <span className="ml-2 tabular-nums text-muted">{rows.length}</span></Link>
      </nav>

      <Panel title={flag === "all" ? "Every company" : flag ? FLAG_LABEL[flag] : "Clients who need attention"} description="Riskiest first. WhatsApp opens with a message that fits the situation; check it before sending.">
        {shown.length === 0 ? (
          <Empty>{rows.length === 0 ? "No companies yet." : "Nobody here. Every client looks healthy."}</Empty>
        ) : (
          <TableWrap caption="Client health" tall>
            <thead><tr><Th>Company</Th><Th>Plan</Th><Th>Risk</Th><Th>Why</Th><Th>Last active</Th><Th right>Busiest limit</Th><Th>Contact</Th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.businessId}>
                  <Td className="max-w-[14rem]">
                    <Link href={`/admin/companies/${r.businessId}`} className="block truncate font-medium underline">{r.name}</Link>
                    {r.email && <span className="block truncate text-xs text-muted">{r.email}</span>}
                  </Td>
                  <Td>{r.plan ?? "none"}<span className="block text-xs text-muted">{r.status?.toLowerCase().replace("_", " ") ?? ""}</span></Td>
                  <Td><Badge tone={RISK_TONE[r.risk]}>{r.risk}</Badge></Td>
                  <Td><span className="flex flex-wrap gap-1">{r.flags.length ? r.flags.map((f) => <Badge key={f} tone="neutral">{FLAG_LABEL[f]}</Badge>) : <span className="text-muted">Healthy</span>}</span></Td>
                  <Td className="whitespace-nowrap">{lastSeen(r.lastActiveAt, now)}</Td>
                  <Td right>{r.usageShare === null ? <span className="text-muted">n/a</span> : `${Math.round(r.usageShare * 100)}%`}</Td>
                  <Td><ContactLinks row={r} /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <HowCalculated>
        <ul>
          <li>Last active: the latest of an AI call, a product event, a post created, or a sign-in by anyone in the company.</li>
          <li>Inactive 7 days: paying, on trial or past due, and nothing in the last 7 days. Trial ends soon: the trial ends within 3 days.</li>
          <li>Low usage: paying for a week or more of the current period and under 10% of every monthly limit (the busiest limit is shown).</li>
          <li>Risk: past due and suspended weigh 3, trial ending and inactive 2, low usage and waiting for a demo 1; 3 or more is high.</li>
        </ul>
      </HowCalculated>
    </>
  );
}
