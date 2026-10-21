import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Bars } from "@/components/analytics/trend-chart";
import { formatCompact, formatShortDate } from "@/components/analytics/format";
import { GlassCard, Meter } from "@/components/ui";
import { formatAmount, limitsInWords, payRulesInWords, PLATFORM_LABEL, type Platform } from "@/lib/creators/company-forms";
import type { CampaignOverview } from "@/lib/creators/analytics";
import type { CampaignView } from "@/lib/creators/campaigns";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <GlassCard padding="sm" className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <span className="text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </GlassCard>
  );
}

/** One goal of the period: how far along it is, or "no limit". */
function Goal({ label, value, max, format }: { label: string; value: number; max: number | null; format: (n: number) => string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-2 text-[14px]">
        <span className="font-medium">{label}</span>
        <span className="text-muted tabular-nums">{max ? `${format(value)} of ${format(max)}` : `${format(value)} · no limit`}</span>
      </div>
      {max ? <Meter value={value} max={max} label={label} /> : null}
    </div>
  );
}

const network = (n: string) => PLATFORM_LABEL[n as Platform] ?? n;

/** The campaign's Overview: totals, views per day, the period running now, the best creators and posts. */
export function CampaignOverviewView({ campaign, data }: { campaign: CampaignView; data: CampaignOverview }) {
  const money = (n: number) => formatAmount(n, campaign.currency);
  const p = data.period;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Views" value={formatCompact(data.totals.views)} hint={`${formatCompact(data.totals.impressions)} reached`} />
        <Stat label="Posts counting" value={String(data.totals.posts)} hint={`${formatCompact(data.totals.engagement)} likes, comments and shares`} />
        <Stat label="Creators" value={String(data.totals.creators)} hint={campaign.applied ? `${campaign.applied} waiting for your answer` : undefined} />
        <Stat label={p?.status === "CLOSED" ? "Paid out last period" : "Earned this period"} value={money(p?.earned ?? 0)} hint={p && p.status !== "CLOSED" ? "So far: it can still change until the period closes" : undefined} />
      </div>

      <GlassCard className="flex flex-col gap-3 p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Views per day</h2>
        {data.chart.length > 1 ? (
          <Bars points={data.chart} pick={(x) => x.views} color="var(--color-pulse-blue)" label="New views" />
        ) : (
          <p className="text-[15px] text-muted">{campaign.status === "DRAFT" ? "The chart starts when the campaign is live and the first posts are counted." : "The first views show here a few hours after creators hand in their posts."}</p>
        )}
        <p className="text-[13px] text-muted">BuPulse reads every post&apos;s views every 6 hours, in your timezone&apos;s days.</p>
      </GlassCard>

      {p && (
        <GlassCard className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">
              Pay period {p.index} of {p.count}
            </h2>
            <span className="text-[14px] text-muted">
              {formatShortDate(p.startsOn)} to {formatShortDate(p.endsOn)} · {p.status === "CLOSED" ? "closed" : p.started ? "running" : "not started"}
            </span>
          </div>
          {p.views !== null && <Goal label="Views of all creators" value={p.views} max={p.goals.viewTargetCampaign} format={formatCompact} />}
          <Goal label="Pay" value={p.earned} max={p.goals.budget} format={money} />
          {p.goals.viewTargetPerCreator ? <p className="text-[14px] text-muted">Each creator&apos;s views count up to {formatCompact(p.goals.viewTargetPerCreator)} in this period.</p> : null}
          {p.limitsHit.length > 0 && (
            <div className="rounded-2xl bg-soft p-4 text-[14px]">
              <p className="mb-1 font-semibold">Why pay is lower than the views alone</p>
              <ul className="list-disc pl-5">
                {limitsInWords(p.limitsHit).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[14px]">
            <p className="font-semibold">Pay rules</p>
            <ul className="list-disc pl-5 text-muted">
              {payRulesInWords(campaign.payRules, campaign.currency).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          <Link href={`/dashboard/creators/${campaign.id}/payouts`} className="self-start text-[15px] font-semibold text-[color:var(--bp-link)] underline">
            See every period and payout
          </Link>
        </GlassCard>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard className="flex flex-col gap-3 p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Top creators</h2>
          {data.topCreators.length === 0 ? (
            <p className="text-[15px] text-muted">Nobody has posts counting yet.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {data.topCreators.map((c, i) => (
                <li key={c.id}>
                  <Link href={`/dashboard/creators/${campaign.id}/creators/${c.id}`} className="flex items-center gap-3 py-2.5 no-underline hover:underline">
                    <span className="w-5 text-[13px] text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{c.name}</span>
                    <span className="text-right text-[13px] text-muted tabular-nums">
                      {formatCompact(c.views)} views · {c.posts} {c.posts === 1 ? "post" : "posts"}
                      <span className="block font-medium text-text">{money(c.earned)} this period</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </GlassCard>
        <GlassCard className="flex flex-col gap-3 p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Top posts</h2>
          {data.topPosts.length === 0 ? (
            <p className="text-[15px] text-muted">No posts counting yet.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {data.topPosts.map((post) => (
                <li key={post.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{post.creator}</span>
                    <span className="text-[13px] text-muted">
                      {network(post.network)}
                      {post.postedAt ? ` · ${new Date(post.postedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                    </span>
                  </span>
                  <span className="text-right text-[13px] tabular-nums">
                    <span className="block font-semibold">{formatCompact(post.views)} views</span>
                    <span className="text-muted">{formatCompact(post.engagement)} reactions</span>
                  </span>
                  <a href={post.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the post by ${post.creator}`} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
                    <ExternalLink aria-hidden className="size-4" />
                  </a>
                </li>
              ))}
            </ol>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
