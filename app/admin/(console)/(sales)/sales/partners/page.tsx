import { PageHeader } from "@/components/app";
import { Empty, HowCalculated, Panel, Stat, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, Input } from "@/components/ui";
import { can, requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { EARN_MONTHS, HOLD_DAYS, QUALIFY_DAYS, TIERS } from "@/lib/partners/commission";
import { loadPartners, type PartnerRow } from "@/lib/partners/service";
import { PARTNER_KIND_LABEL, PARTNER_STATUS_LABEL } from "@/lib/partners/shared";
import { formatPhone } from "@/lib/phone";
import { formatMinor } from "@/lib/region-format";
import { approvePartnerAction, pausePartnerAction, recordPayoutAction, rejectPartnerAction } from "./actions";

export const metadata = { title: "Partners" };

const rwf = (n: number) => formatMinor(n, "RWF");
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Kigali" }) : "Not yet");
const TONE = { applied: "violet", approved: "success", rejected: "neutral", paused: "neutral" } as const;

export default async function PartnersPage({ searchParams }: PageProps<"/admin/sales/partners">) {
  const identity = await requirePermission(["sales.team", "money.revenue"]); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const rows = await loadPartners();
  const canDecide = can(identity, "sales.team");
  const canPay = can(identity, "payments.approve");
  const applications = rows.filter((r) => r.status === "applied");
  const partners = rows.filter((r) => r.status === "approved" || r.status === "paused");
  const closed = rows.filter((r) => r.status === "rejected");
  const total = (f: (r: PartnerRow) => number) => partners.reduce((a, r) => a + f(r), 0);
  return (
    <>
      <PageHeader title="Partners" description="Outside partners who refer businesses: applications, their links, the companies they brought and the commission owed and paid." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="New applications" value={String(applications.length)} />
        <Stat label="Active partners" value={String(partners.filter((p) => p.status === "approved").length)} />
        <Stat label="Paying companies referred" value={String(total((r) => r.summary?.payingClients ?? 0))} />
        <Stat label="Commission owed now" value={rwf(total((r) => Math.max(0, r.summary?.owedRwf ?? 0)))} note={`${rwf(total((r) => r.summary?.onHoldRwf ?? 0))} on hold, ${rwf(total((r) => r.summary?.paidRwf ?? 0))} paid`} />
      </div>

      <HowCalculated>
        <p>Commission is counted only on money that arrived: Mobile Money confirmed in Payments, card payments Paddle completed and paid invoices, after refunds (the same payments as Revenue).</p>
        <ul>
          <li>A company counts when its first payment comes within {QUALIFY_DAYS} days of signing up with the partner&apos;s link; the partner then earns on its payments for {EARN_MONTHS} months.</li>
          <li>Rate at each payment, by the partner&apos;s paying companies so far: {TIERS.map((t) => `${t.pct}% from ${t.from}`).join(", ")}.</li>
          <li>Amounts in RWF: what the client paid in RWF, else the card payment&apos;s net USD at the Settings rate.</li>
          <li>Payments of the last {HOLD_DAYS} days are on hold (refunds). Owed = earned and past the hold, minus payouts.</li>
        </ul>
      </HowCalculated>

      <Panel title="New applications" description="From bupulse.com/partners. Nobody is emailed: call or message the person, then approve and send them their link and page.">
        {applications.length === 0 ? (
          <Empty>No new applications.</Empty>
        ) : (
          <TableWrap caption="New partner applications">
            <thead>
              <tr>
                <Th>Who</Th>
                <Th>Kind</Th>
                <Th>How they will find clients</Th>
                <Th>Applied</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id}>
                  <Td><Who r={a} /></Td>
                  <Td>{PARTNER_KIND_LABEL[a.kind] ?? a.kind}{a.city ? `, ${a.city}` : ""}</Td>
                  <Td className="max-w-80 whitespace-pre-line text-[13px]">{a.message ?? "Not said"}</Td>
                  <Td>{day(a.createdAt)}</Td>
                  <Td>
                    {canDecide && (
                      <div className="flex flex-col gap-2">
                        <form action={approvePartnerAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <Button type="submit" size="sm">Approve</Button>
                        </form>
                        <details className="text-[13px]">
                          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium underline">Turn down</summary>
                          <form action={rejectPartnerAction} className="mt-2 flex min-w-56 flex-col gap-2">
                            <input type="hidden" name="id" value={a.id} />
                            <label className="flex flex-col gap-1">
                              <span>Reason (only you see it)</span>
                              <Input name="reason" required minLength={3} maxLength={300} />
                            </label>
                            <Button type="submit" size="sm" variant="outline">Turn down</Button>
                          </form>
                        </details>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Partners" description="Their code and link, the companies they brought, and their commission. Send each partner their link and their page yourself (WhatsApp or email).">
        {partners.length === 0 ? (
          <Empty>No partners yet. Approve an application to give it a link.</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            {partners.map((p) => (
              <PartnerCard key={p.id} p={p} canDecide={canDecide} canPay={canPay} />
            ))}
          </div>
        )}
      </Panel>

      {closed.length > 0 && (
        <Panel title="Turned down" description="Applications that were not accepted, with the reason.">
          <ul className="flex flex-col gap-2 text-[14px]">
            {closed.map((r) => (
              <li key={r.id}>
                <strong>{r.organisation ?? r.name}</strong> ({r.email}), {day(r.createdAt)}: {r.rejectReason}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Who({ r }: { r: PartnerRow }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium">{r.organisation ?? r.name}</span>
      <span className="text-xs text-muted">{r.organisation ? `${r.name}, ` : ""}{r.email}</span>
      <span className="text-xs text-muted">{formatPhone(r.phone)}</span>
    </span>
  );
}

function PartnerCard({ p, canDecide, canPay }: { p: PartnerRow; canDecide: boolean; canPay: boolean }) {
  const s = p.summary;
  return (
    <section aria-label={p.organisation ?? p.name} className="flex flex-col gap-3 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Who r={p} />
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[p.status]}>{PARTNER_STATUS_LABEL[p.status]}</Badge>
          <span className="font-mono text-sm">{p.refCode}</span>
          {canDecide && (
            <form action={pausePartnerAction}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="paused" value={p.status === "approved" ? "1" : "0"} />
              <Button type="submit" size="sm" variant="outline">{p.status === "approved" ? "Pause" : "Resume"}</Button>
            </form>
          )}
        </span>
      </div>
      <dl className="grid gap-1 text-[13px] sm:grid-cols-[auto_1fr] sm:gap-x-3">
        <dt className="text-muted">Link to send</dt>
        <dd className="break-all font-mono">{p.link}</dd>
        <dt className="text-muted">Their page</dt>
        <dd className="break-all font-mono">{p.page}</dd>
      </dl>
      {s && (
        <div className="grid gap-2 text-[14px] sm:grid-cols-5">
          <span><span className="block text-xs text-muted">Paying companies</span>{s.payingClients} (rate {s.currentPct}%)</span>
          <span><span className="block text-xs text-muted">Earned</span>{rwf(s.earnedRwf)}</span>
          <span><span className="block text-xs text-muted">On hold</span>{rwf(s.onHoldRwf)}</span>
          <span><span className="block text-xs text-muted">Paid</span>{rwf(s.paidRwf)}</span>
          <span><span className="block text-xs text-muted">Owed now</span><strong>{rwf(s.owedRwf)}</strong></span>
        </div>
      )}
      {p.companies.length > 0 && (
        <TableWrap caption={`Companies referred by ${p.organisation ?? p.name}`}>
          <thead>
            <tr>
              <Th>Company</Th>
              <Th>Signed up</Th>
              <Th>First payment</Th>
              <Th>Plan now</Th>
              <Th right>Commission</Th>
            </tr>
          </thead>
          <tbody>
            {p.companies.map((c) => (
              <tr key={c.businessId}>
                <Td>{c.name}</Td>
                <Td>{day(c.signedUpAt)}</Td>
                <Td>{c.firstPaidAt ? `${day(c.firstPaidAt)}${c.qualified ? "" : " (after 90 days: no commission)"}` : "Not yet"}</Td>
                <Td>{c.plan ?? "Not paying"}</Td>
                <Td right>{rwf(c.earnedRwf)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {p.payouts.length > 0 && (
        <p className="text-[13px] text-muted">
          Payouts: {p.payouts.map((x) => `${day(x.paidAt)} ${rwf(x.amountRwf)} (${x.reference})`).join(" · ")}
        </p>
      )}
      {canPay && s && s.owedRwf > 0 && (
        <details className="text-[13px]">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium underline">Mark as paid</summary>
          <form action={recordPayoutAction} className="mt-2 grid max-w-xl gap-2 sm:grid-cols-2">
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
    </section>
  );
}
