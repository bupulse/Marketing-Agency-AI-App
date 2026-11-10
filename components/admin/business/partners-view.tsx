// Admin -> Sales -> Partners: outside partners who refer businesses. Numbers on top, new applications to decide, and one
// card per partner that opens their link, companies, commission and payout form. Plain data in, so the page and the dev
// preview render the same.
import { Building2, CircleDollarSign, Handshake, Inbox, Network, UserCheck, UserX } from "lucide-react";
import { DataList, EmptyState, ExpandCard, PageHeader, StatGrid, StatTile, StatusPill, type PillTone, type SearchParamsLike } from "@/components/admin/kit";
import { HowCalculated, Panel } from "@/components/admin/ui";
import { Button, Input } from "@/components/ui";
import { EARN_MONTHS, HOLD_DAYS, QUALIFY_DAYS, TIERS } from "@/lib/partners/commission";
import type { PartnerRow } from "@/lib/partners/service";
import { PARTNER_KIND_LABEL, PARTNER_STATUS_LABEL } from "@/lib/partners/shared";
import { formatPhone } from "@/lib/phone";
import { formatMinor } from "@/lib/region-format";
import { Fact, Notices } from "./shared";

const rwf = (n: number) => formatMinor(n, "RWF");
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Kigali" }) : "Not yet");
const TONE: Record<string, PillTone> = { applied: "new", approved: "good", rejected: "muted", paused: "muted" };

type Act = (f: FormData) => Promise<void>;

export function PartnersView({ rows, canDecide, canPay, sp, actions }: { rows: PartnerRow[]; canDecide: boolean; canPay: boolean; sp: SearchParamsLike; actions: { approve: Act; reject: Act; pause: Act; payout: Act } }) {
  const applications = rows.filter((r) => r.status === "applied");
  const partners = rows.filter((r) => r.status === "approved" || r.status === "paused");
  const closed = rows.filter((r) => r.status === "rejected");
  const total = (f: (r: PartnerRow) => number) => partners.reduce((a, r) => a + f(r), 0);
  const owed = total((r) => Math.max(0, r.summary?.owedRwf ?? 0));
  return (
    <>
      <PageHeader icon={Network} tone="orange" title="Partners" description="Outside partners who refer businesses: applications, their links, the companies they brought and the commission owed and paid." />
      <Notices sp={sp} />

      <StatGrid cols={4}>
        <StatTile icon={Inbox} tone="orange" label="New applications" value={String(applications.length)} alert={applications.length > 0} hint="People waiting for your call or answer." />
        <StatTile icon={UserCheck} tone="orange" label="Active partners" value={String(partners.filter((p) => p.status === "approved").length)} hint="Approved, with a working link." />
        <StatTile icon={Building2} tone="orange" label="Paying companies referred" value={String(total((r) => r.summary?.payingClients ?? 0))} hint="Companies partners brought that pay." />
        <StatTile className="max-lg:col-span-2" icon={CircleDollarSign} tone="green" label="Commission owed now" value={rwf(owed)} hint={`${rwf(total((r) => r.summary?.onHoldRwf ?? 0))} on hold, ${rwf(total((r) => r.summary?.paidRwf ?? 0))} paid.`} />
      </StatGrid>

      <HowCalculated>
        <p>Commission is counted only on money that arrived: Mobile Money confirmed in Payments, card payments Paddle completed and paid invoices, after refunds (the same payments as Revenue).</p>
        <ul>
          <li>A company counts when its first payment comes within {QUALIFY_DAYS} days of signing up with the partner&apos;s link; the partner then earns on its payments for {EARN_MONTHS} months.</li>
          <li>Rate at each payment, by the partner&apos;s paying companies so far: {TIERS.map((t) => `${t.pct}% from ${t.from}`).join(", ")}.</li>
          <li>Amounts in RWF: what the client paid in RWF, else the card payment&apos;s net USD at the Settings rate.</li>
          <li>Payments of the last {HOLD_DAYS} days are on hold (refunds). Owed = earned and past the hold, minus payouts.</li>
        </ul>
      </HowCalculated>

      <Panel icon={Inbox} tone="orange" title="New applications" description="From bupulse.com/partners. Nobody is emailed: call or message the person, then approve and send them their link and page.">
        <DataList<PartnerRow>
          caption="New partner applications"
          rows={applications}
          rowKey={(a) => a.id}
          columns={[
            { key: "who", header: "Who", primary: true, cell: (a) => <Who r={a} /> },
            { key: "kind", header: "Kind", cell: (a) => `${PARTNER_KIND_LABEL[a.kind] ?? a.kind}${a.city ? `, ${a.city}` : ""}` },
            { key: "how", header: "How they will find clients", cell: (a) => <span className="block max-w-80 whitespace-pre-line text-[13px]">{a.message ?? "Not said"}</span> },
            { key: "at", header: "Applied", cell: (a) => day(a.createdAt) },
            {
              key: "act",
              header: "Decide",
              cell: (a) =>
                canDecide ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <form action={actions.approve}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button type="submit" size="sm">Approve</Button>
                    </form>
                    <details className="text-[13px]">
                      <summary className="inline-flex min-h-9 cursor-pointer items-center font-semibold text-muted underline">Turn down</summary>
                      <form action={actions.reject} className="mt-2 flex min-w-56 flex-col gap-2">
                        <input type="hidden" name="id" value={a.id} />
                        <label className="flex flex-col gap-1">
                          <span>Reason (only you see it)</span>
                          <Input name="reason" required minLength={3} maxLength={300} />
                        </label>
                        <Button type="submit" size="sm" variant="outline">Turn down</Button>
                      </form>
                    </details>
                  </div>
                ) : null,
            },
          ]}
          empty={<EmptyState icon={Inbox} tone="good" title="No new applications." />}
        />
      </Panel>

      <section aria-label="Partners" className="flex flex-col gap-3">
        <div className="px-1">
          <h2 className="text-[17px] font-bold tracking-[-0.02em]">Partners</h2>
          <p className="text-[13px] text-muted">Tap a partner for their link, the companies they brought and their commission. Send each partner their link and page yourself (WhatsApp or email).</p>
        </div>
        {partners.length === 0 ? (
          <EmptyState icon={Handshake} title="No partners yet." hint="Approve an application to give it a link." />
        ) : (
          <div className="kit-rise grid items-start gap-3 lg:grid-cols-2">
            {partners.map((p) => (
              <PartnerCard key={p.id} p={p} canDecide={canDecide} canPay={canPay} actions={actions} />
            ))}
          </div>
        )}
      </section>

      {closed.length > 0 && (
        <ExpandCard icon={UserX} tone="slate" title="Turned down" summary={`${closed.length} ${closed.length === 1 ? "application" : "applications"} not accepted, with the reason.`}>
          <ul className="flex flex-col gap-2 text-[14px]">
            {closed.map((r) => (
              <li key={r.id}>
                <strong>{r.organisation ?? r.name}</strong> ({r.email}), {day(r.createdAt)}: {r.rejectReason}
              </li>
            ))}
          </ul>
        </ExpandCard>
      )}
    </>
  );
}

function Who({ r }: { r: PartnerRow }) {
  return (
    <span className="flex flex-col">
      <span>{r.organisation ?? r.name}</span>
      <span className="text-xs font-normal text-muted">{r.organisation ? `${r.name}, ` : ""}{r.email}</span>
      <span className="text-xs font-normal text-muted">{formatPhone(r.phone)}</span>
    </span>
  );
}

function PartnerCard({ p, canDecide, canPay, actions }: { p: PartnerRow; canDecide: boolean; canPay: boolean; actions: { pause: Act; payout: Act } }) {
  const s = p.summary;
  return (
    <ExpandCard
      icon={Handshake}
      tone="orange"
      title={p.organisation ?? p.name}
      summary={[p.refCode ? `Code ${p.refCode}` : null, s ? `${s.payingClients} paying (rate ${s.currentPct}%)` : null, s ? `owed ${rwf(s.owedRwf)}` : null].filter(Boolean).join(" · ")}
      aside={<StatusPill tone={TONE[p.status] ?? "muted"} dot className="max-sm:hidden">{PARTNER_STATUS_LABEL[p.status]}</StatusPill>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Who r={p} />
          {canDecide && (
            <form action={actions.pause}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="paused" value={p.status === "approved" ? "1" : "0"} />
              <Button type="submit" size="sm" variant="outline">{p.status === "approved" ? "Pause" : "Resume"}</Button>
            </form>
          )}
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Link to send"><span className="break-all font-mono text-[13px]">{p.link}</span></Fact>
          <Fact label="Their page"><span className="break-all font-mono text-[13px]">{p.page}</span></Fact>
        </dl>
        {s && (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Paying companies", `${s.payingClients} (rate ${s.currentPct}%)`],
              ["Earned", rwf(s.earnedRwf)],
              ["On hold", rwf(s.onHoldRwf)],
              ["Paid", rwf(s.paidRwf)],
              ["Owed now", rwf(s.owedRwf)],
            ].map(([k, v], i) => (
              <div key={k} className={`flex flex-col gap-0.5 rounded-2xl bg-soft/60 p-3 ${i === 4 ? "col-span-2 sm:col-span-1" : ""}`}>
                <dt className="text-[11.5px] text-muted">{k}</dt>
                <dd className={`text-[14px] tabular-nums ${i === 4 ? "font-bold" : "font-semibold"}`}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {p.companies.length > 0 && (
          <DataList
            caption={`Companies referred by ${p.organisation ?? p.name}`}
            rows={p.companies}
            rowKey={(c) => c.businessId}
            mode="cards"
            columns={[
              { key: "name", header: "Company", primary: true, cell: (c) => c.name },
              { key: "signed", header: "Signed up", cell: (c) => day(c.signedUpAt) },
              { key: "paid", header: "First payment", cell: (c) => (c.firstPaidAt ? `${day(c.firstPaidAt)}${c.qualified ? "" : " (after 90 days: no commission)"}` : "Not yet") },
              { key: "plan", header: "Plan now", cell: (c) => c.plan ?? "Not paying" },
              { key: "earned", header: "Commission", align: "right", cell: (c) => rwf(c.earnedRwf) },
            ]}
          />
        )}
        {p.payouts.length > 0 && <p className="text-[13px] text-muted">Payouts: {p.payouts.map((x) => `${day(x.paidAt)} ${rwf(x.amountRwf)} (${x.reference})`).join(" · ")}</p>}
        {canPay && s && s.owedRwf > 0 && (
          <details className="text-[13px]">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">Mark as paid</summary>
            <form action={actions.payout} className="mt-2 grid max-w-xl gap-2 sm:grid-cols-2">
              <input type="hidden" name="id" value={p.id} />
              <label className="flex flex-col gap-1">
                <span>Amount sent (RWF, at most {rwf(s.owedRwf)})</span>
                <Input name="amount" inputMode="numeric" required defaultValue={String(s.owedRwf)} />
              </label>
              <label className="flex flex-col gap-1">
                <span>Mobile Money transaction id</span>
                <Input name="reference" required minLength={4} maxLength={40} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span>Note (optional)</span>
                <Input name="note" maxLength={300} placeholder={`Sent to ${formatPhone(p.phone)}`} />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm">Record payout</Button>
              </div>
            </form>
          </details>
        )}
      </div>
    </ExpandCard>
  );
}
