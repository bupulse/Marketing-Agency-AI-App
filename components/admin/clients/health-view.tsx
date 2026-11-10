import { Activity, AlarmClock, BatteryLow, CreditCard, HeartPulse, Moon } from "lucide-react";
import { DataList, EmptyState, FilterChips, StatGrid, StatTile, StatusPill, type PillTone } from "@/components/admin/kit";
import { ContactCircles, daysAgo } from "@/components/admin/business/shared";
import type { ClientRow } from "@/lib/admin/client-health";
import { FLAG_LABEL, mailtoLink, whatsappLink, type HealthFlag } from "@/lib/admin/client-health-shared";
import { num } from "@/lib/admin/format";
import { HowCalculated, Panel } from "../ui";

const FLAGS: HealthFlag[] = ["past_due", "trial_ending", "inactive", "low_usage", "waiting_demo", "suspended"];
const RISK: Record<ClientRow["risk"], { label: string; tone: PillTone }> = { high: { label: "High risk", tone: "bad" }, medium: { label: "Watch", tone: "warn" }, ok: { label: "Healthy", tone: "good" } };

function opener(row: ClientRow): string {
  if (row.flags.includes("past_due")) return `Hello from BuPulse! Your ${row.name} subscription payment did not go through. Can I help you renew it?`;
  if (row.flags.includes("trial_ending")) return `Hello from BuPulse! Your free trial for ${row.name} ends soon. Do you have any questions before choosing a plan?`;
  return `Hello from BuPulse! How is ${row.name} getting on with BuPulse? Can I help with anything?`;
}

/** One-click WhatsApp and email, prefilled for the client's situation. */
export function ContactLinks({ row }: { row: ClientRow }) {
  return <ContactCircles name={row.name} wa={whatsappLink(row.phone, opener(row))} mail={mailtoLink(row.email, `BuPulse: ${row.name}`)} />;
}

export function ClientHealthView({ rows, flag, now, base = "/admin/client-health" }: { rows: ClientRow[]; flag: HealthFlag | "all" | null; now: number; base?: string }) {
  const count = (f: HealthFlag) => rows.filter((r) => r.flags.includes(f)).length;
  const live = rows.filter((r) => r.status === "ACTIVE" || r.status === "TRIALING" || r.status === "PAST_DUE");
  const active7 = live.filter((r) => !r.flags.includes("inactive")).length;
  const shown = flag === "all" ? rows : flag ? rows.filter((r) => r.flags.includes(flag)) : rows.filter((r) => r.score > 0);
  const tile = (f: HealthFlag) => `${base}?flag=${f}`;
  return (
    <>
      <StatGrid cols={5}>
        <StatTile className="max-lg:col-span-2" icon={Activity} tone="blue" label="Active this week" value={`${num(active7)} of ${num(live.length)}`} hint="Paying, on trial or late, and used BuPulse in the last 7 days." />
        <StatTile icon={Moon} tone="blue" label="Quiet for 7 days" value={num(count("inactive"))} alert={count("inactive") > 0} hint="Did nothing for a week. A call helps." href={tile("inactive")} />
        <StatTile icon={AlarmClock} tone="blue" label="Trial ends in 3 days" value={num(count("trial_ending"))} hint="Help them pick a plan before it ends." href={tile("trial_ending")} />
        <StatTile icon={CreditCard} tone="blue" label="Payment late" value={num(count("past_due"))} alert={count("past_due") > 0} hint="Their payment did not go through." href={tile("past_due")} />
        <StatTile icon={BatteryLow} tone="blue" label="Low usage" value={num(count("low_usage"))} hint="Paying but using under 10% of their plan." href={tile("low_usage")} />
      </StatGrid>

      <FilterChips
        label="Show clients"
        param="flag"
        base={base}
        current={flag ?? ""}
        options={[{ value: "", label: "Needs attention" }, ...FLAGS.map((f) => ({ value: f, label: FLAG_LABEL[f], count: count(f) })), { value: "all", label: "Everyone", count: rows.length }]}
      />

      <Panel icon={HeartPulse} tone="blue" title={flag === "all" ? "Every company" : flag ? FLAG_LABEL[flag] : "Clients who need attention"} description="Riskiest first. WhatsApp opens with a message that fits the situation; check it before sending.">
        <DataList<ClientRow>
          caption="Client health"
          rows={shown}
          rowKey={(r) => r.businessId}
          rowHref={(r) => `/admin/companies/${r.businessId}`}
          columns={[
            { key: "name", header: "Company", primary: true, className: "max-w-[14rem]", cell: (r) => <><span className="block truncate">{r.name}</span>{r.email && <span className="block truncate text-xs font-normal text-muted">{r.email}</span>}</> },
            { key: "risk", header: "Risk", cell: (r) => <StatusPill tone={RISK[r.risk].tone} dot>{RISK[r.risk].label}</StatusPill> },
            { key: "plan", header: "Plan", cell: (r) => <>{r.plan ?? "none"}<span className="block text-xs text-muted">{r.status?.toLowerCase().replace("_", " ") ?? ""}</span></>, hideOnPhone: true },
            { key: "why", header: "Why", cell: (r) => <span className="flex flex-wrap gap-1">{r.flags.length ? r.flags.map((f) => <StatusPill key={f} tone="muted">{FLAG_LABEL[f]}</StatusPill>) : <span className="text-muted">Healthy</span>}</span> },
            { key: "seen", header: "Last active", cell: (r) => <span className="whitespace-nowrap">{daysAgo(r.lastActiveAt, now)}</span> },
            { key: "use", header: "Busiest limit", align: "right", cell: (r) => (r.usageShare === null ? <span className="text-muted">n/a</span> : `${Math.round(r.usageShare * 100)}%`), hideOnPhone: true },
            { key: "contact", header: "Contact", cell: (r) => <ContactLinks row={r} /> },
          ]}
          empty={<EmptyState icon={HeartPulse} tone={rows.length ? "good" : "calm"} title={rows.length === 0 ? "No companies yet." : "Nobody here. Every client looks healthy."} />}
        />
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
