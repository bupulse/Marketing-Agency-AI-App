import type { Metadata } from "next";
import Link from "next/link";
import { GlassCard } from "@/components/ui";
import { PayoutStatus } from "@/components/creators/portal/post-status";
import { requireCreator } from "@/lib/creators/auth";
import { amount, count, formatDay } from "@/lib/creators/describe";
import { earningsSoFar, myPayouts } from "@/lib/creators/portal";

export const metadata: Metadata = { title: "Earnings" };

const day = (d: Date) => formatDay(d.toISOString().slice(0, 10));

export default async function EarningsPage() {
  const { profile } = await requireCreator();
  const [soFar, payouts] = await Promise.all([earningsSoFar(profile.id), myPayouts(profile.id)]);
  return (
    <>
      <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Earnings</h1>
      <p className="text-[15px] text-muted">Each campaign pays per month (30 days). When a month ends, BuPulse works out your pay and the company sends it by Mobile Money.</p>

      <section aria-labelledby="now" className="flex flex-col gap-3">
        <h2 id="now" className="text-lg font-semibold tracking-tight">This month so far</h2>
        {soFar.length === 0 && <p className="text-[15px] text-muted">No campaign month running.</p>}
        {soFar.map((e) => (
          <Link key={e.campaignId} href={`/creator/campaigns/${e.campaignId}`} className="glass flex items-center justify-between gap-3 rounded-glass p-4 no-underline hover:bg-soft">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{e.name}</p>
              <p className="text-sm text-muted">Month {e.periodIndex} · {count(e.views)} views · ends {day(new Date(e.endsAt.getTime() - 1))}</p>
            </div>
            <span className="shrink-0 text-[15px] font-semibold">{amount(e.amount, e.currency)}</span>
          </Link>
        ))}
      </section>

      <section aria-labelledby="payouts" className="flex flex-col gap-3">
        <h2 id="payouts" className="text-lg font-semibold tracking-tight">Payouts</h2>
        {payouts.length === 0 && <p className="text-[15px] text-muted">No payouts yet.</p>}
        {payouts.map((p) => {
          const c = p.campaignCreator.campaign;
          return (
            <GlassCard key={p.id} padding="none" className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">{c.name}</p>
                <p className="text-sm text-muted">{c.business.name} · month {p.period.index} · {count(p.countedViews)} views that earned</p>
                {p.deductions > 0 && <p className="text-sm text-muted">{amount(p.deductions, c.currency)} taken off for posts that stopped earning</p>}
                {p.status === "PAID" && <p className="text-sm text-muted">Paid {p.paidAt ? day(p.paidAt) : ""}{p.reference ? ` · reference ${p.reference}` : ""}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold">{amount(p.amount, c.currency)}</span>
                <PayoutStatus status={p.status} />
              </div>
            </GlassCard>
          );
        })}
      </section>
    </>
  );
}
