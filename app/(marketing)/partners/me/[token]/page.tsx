import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Container, GlassCard } from "@/components/ui";
import { HOLD_DAYS } from "@/lib/partners/commission";
import { partnerByToken } from "@/lib/partners/service";
import { formatMinor } from "@/lib/region-format";

// A partner's own numbers, at a private link the owner sends them (no account). The token is 32 random bytes; an
// unknown token, or a partner not active or paused, is a plain 404.
export const metadata: Metadata = { title: "Your partner page", robots: { index: false, follow: false } };

const rwf = (n: number) => formatMinor(n, "RWF");
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Kigali" }) : "Not yet");

export default async function PartnerPage({ params }: PageProps<"/partners/me/[token]">) {
  const { token } = await params;
  const view = await partnerByToken(token);
  if (!view) notFound();
  const s = view.summary;
  return (
    <Container size="narrow" className="flex flex-col gap-6 py-16">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted">BuPulse partner</p>
        <h1 className="text-3xl font-bold tracking-tight">{view.name}</h1>
        {view.status === "paused" && <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm">Your partnership is paused: your link does not count new sign-ups for now. Commission on your clients keeps counting.</p>}
      </div>

      {view.link && (
        <GlassCard padding="lg" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Your link</h2>
          <p className="break-all font-mono text-[15px]">{view.link}</p>
          <p className="text-sm text-muted">Share it with businesses. It works on every page of bupulse.com (add ?ref=… to any address).</p>
        </GlassCard>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <GlassCard padding="md" className="flex flex-col gap-1">
          <span className="text-[13px] text-muted">Paying clients</span>
          <span className="text-2xl font-semibold">{s.payingClients}</span>
          <span className="text-xs text-muted">Your rate: {s.currentPct}%{s.nextTier ? ` (${s.nextTier.pct}% from ${s.nextTier.from})` : ""}</span>
        </GlassCard>
        <GlassCard padding="md" className="flex flex-col gap-1">
          <span className="text-[13px] text-muted">Owed to you</span>
          <span className="text-2xl font-semibold">{rwf(Math.max(0, s.owedRwf))}</span>
          <span className="text-xs text-muted">{rwf(s.onHoldRwf)} on hold ({HOLD_DAYS} days)</span>
        </GlassCard>
        <GlassCard padding="md" className="flex flex-col gap-1">
          <span className="text-[13px] text-muted">Paid to you</span>
          <span className="text-2xl font-semibold">{rwf(s.paidRwf)}</span>
          <span className="text-xs text-muted">Earned in all: {rwf(s.earnedRwf)}</span>
        </GlassCard>
      </div>

      <GlassCard padding="lg" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your clients</h2>
        {view.companies.length === 0 ? (
          <p className="text-muted">No sign-ups with your link yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {view.companies.map((c) => (
              <li key={c.businessId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="flex flex-col">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted">Signed up {day(c.signedUpAt)} · first payment {c.firstPaidAt ? day(c.firstPaidAt) : "not yet"}{c.earnUntil ? ` · earning until ${day(c.earnUntil)}` : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  {c.qualified ? <Badge tone="success">Paying</Badge> : c.firstPaidAt ? <Badge tone="neutral">Paid too late</Badge> : <Badge tone="neutral">Not paid yet</Badge>}
                  <span className="tabular-nums">{rwf(c.earnedRwf)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {view.payouts.length > 0 && (
        <GlassCard padding="lg" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Payouts</h2>
          <ul className="flex flex-col divide-y divide-line">
            {view.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{day(p.paidAt)} · <span className="font-mono text-sm">{p.reference}</span></span>
                <span className="tabular-nums">{rwf(p.amountRwf)}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
      <p className="text-sm text-muted">Questions about your commission? Reply to the person at BuPulse who sent you this page.</p>
    </Container>
  );
}
