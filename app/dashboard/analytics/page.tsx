import Link from "next/link";
import { ChartLine, Lightbulb, MessageCircle, Plug } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { formatCompact, formatPct } from "@/components/analytics/format";
import { StatCard } from "@/components/analytics/stat-card";
import { TrendChart } from "@/components/analytics/trend-chart";
import { NetworkIcon, networkName } from "@/components/publishing/network-icon";
import { Button, GlassCard } from "@/components/ui";
import { RANGES, parseRange } from "@/lib/analytics/compute";
import { loadClientAnalytics } from "@/lib/analytics/service";
import { cn } from "@/lib/cn";
import type { Network } from "@/lib/social/types";

export const metadata = { title: "Analytics" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await featureGate("analytics");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const days = parseRange((await searchParams).range);
  const data = await loadClientAnalytics(business.id, days);

  const header = <PageHeader title="Analytics" description="How your posts and website chat are doing, compared with the period before." action={<RangePicker days={days} />} />;

  if (!data.hasChannels) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          icon={Plug}
          title="Connect a channel to see your results"
          text="Once your Instagram, Facebook, LinkedIn, TikTok or YouTube account is connected and you have published, your reach and engagement show up here."
          action={<Button href="/dashboard/connections">Go to Channels</Button>}
        />
      </div>
    );
  }

  const { cards } = data;
  const noMetricsYet = data.cards.posts.value > 0 && data.measured === 0;

  return (
    <div className="flex flex-col gap-6">
      {header}

      {data.reminderOnlyChannels && (
        <Note>All your connected channels are reminder-only, so BuPulse cannot read their results. Connect a business or creator account to see reach and engagement.</Note>
      )}
      {noMetricsYet && !data.reminderOnlyChannels && (
        <Note>Your posts are live. Results arrive within a day of publishing, so check back tomorrow.</Note>
      )}
      {data.awaitingMetrics > 0 && !noMetricsYet && (
        <Note>{data.awaitingMetrics} recent {data.awaitingMetrics === 1 ? "post is" : "posts are"} still waiting for results. They arrive within a day of publishing.</Note>
      )}
      {data.reminderPosts > 0 && (
        <Note>{data.reminderPosts} {data.reminderPosts === 1 ? "post was" : "posts were"} sent as reminders (personal Instagram, scripts). They are posted by hand, so they have no results here.</Note>
      )}

      <section aria-label="Summary" className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Posts published" value={String(cards.posts.value)} change={cards.posts.change} />
        <StatCard label="Reach" value={formatCompact(cards.reach.value)} change={cards.reach.change} hint="People who saw your posts" />
        <StatCard label="Engagement" value={formatCompact(cards.engagement.value)} change={cards.engagement.change} hint="Likes, comments, shares and saves" />
        <StatCard label="Engagement rate" value={formatPct(cards.rate.value)} change={cards.rate.change} hint="Engagement divided by reach" />
        <StatCard label="Website chats" value={String(cards.chats.value)} change={cards.chats.change} />
        <StatCard label="Leads captured" value={String(cards.leads.value)} change={cards.leads.change} />
      </section>

      {data.tips.length > 0 && (
        <GlassCard className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]"><Lightbulb aria-hidden className="size-5 text-pulse-violet" />What worked</h2>
          <ul className="flex flex-col gap-2 text-[15px]">
            {data.tips.map((t) => <li key={t.id} className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-pulse-blue" /><span>{t.text}</span></li>)}
          </ul>
        </GlassCard>
      )}

      <GlassCard className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Trend</h2>
        {data.cards.posts.value === 0 ? (
          <p className="text-[15px] text-muted">No posts were published in the last {days} days. Schedule one from the Calendar and its results will appear here.</p>
        ) : data.measured === 0 ? (
          <p className="text-[15px] text-muted">The chart appears once results have arrived for your posts.</p>
        ) : (
          <TrendChart points={data.trend} unit={data.trendUnit} />
        )}
      </GlassCard>

      <GlassCard className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">By network</h2>
        {data.networks.length === 0 ? (
          <p className="text-[15px] text-muted">Nothing published in this period yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-[15px]">
              <thead>
                <tr className="text-[13px] text-muted">
                  <th className="py-2 pr-3 font-medium">Network</th>
                  <th className="px-3 py-2 text-right font-medium">Posts</th>
                  <th className="px-3 py-2 text-right font-medium">Reach</th>
                  <th className="px-3 py-2 text-right font-medium">Engagement</th>
                  <th className="py-2 pl-3 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.networks.map((n) => (
                  <tr key={n.network} className="border-t border-line">
                    <td className="py-3 pr-3"><span className="inline-flex items-center gap-2.5 font-medium"><NetworkIcon network={n.network as Network} size={24} />{networkName(n.network)}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums">{n.posts}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{n.measured > 0 ? formatCompact(n.reach) : "–"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{n.measured > 0 ? formatCompact(n.engagement) : "–"}</td>
                    <td className="py-3 pl-3 text-right tabular-nums">{formatPct(n.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <GlassCard className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Best posts</h2>
        {data.best.length === 0 ? (
          <p className="text-[15px] text-muted">Your top posts appear here once results have arrived for at least one post.</p>
        ) : (
          <ol className="flex flex-col">
            {data.best.map((b, i) => {
              const href = b.permalink ?? "/dashboard/calendar";
              const external = Boolean(b.permalink);
              return (
                <li key={b.id} className="border-t border-line first:border-t-0">
                  <Link href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="flex items-center gap-3 py-3 no-underline text-text">
                    <span aria-hidden className="w-4 shrink-0 text-center text-sm font-semibold text-muted">{i + 1}</span>
                    {b.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.thumb} alt="" width={56} height={56} loading="lazy" className="size-14 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl bg-soft text-muted"><ChartLine className="size-5" /></span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[15px] font-medium">{b.text || "Post without text"}</span>
                      <span className="flex items-center gap-2 text-[13px] text-muted">
                        <NetworkIcon network={b.network as Network} size={16} />
                        {networkName(b.network)} · {new Date(b.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: data.timeZone })}
                      </span>
                      <span className="text-[13px] text-muted tabular-nums">{formatCompact(b.reach)} reach · {formatCompact(b.engagement)} engagement</span>
                    </span>
                    <span className="shrink-0 text-right text-lg font-semibold tabular-nums">{formatPct(b.rate)}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </GlassCard>

      <GlassCard className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]"><MessageCircle aria-hidden className="size-5 text-pulse-blue" />Website chat</h2>
          <Button href="/dashboard/leads" variant="outline" size="sm">See leads</Button>
        </div>
        <dl className="grid grid-cols-3 gap-3">
          <Metric label="Conversations" value={String(data.chat.conversations)} />
          <Metric label="Leads" value={String(data.chat.leads)} />
          <Metric label="Became a lead" value={formatPct(data.chat.conversion)} />
        </dl>
        {data.chat.pages.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-[13px] font-medium text-muted">Pages leads came from</h3>
            <ul className="flex flex-col">
              {data.chat.pages.map((p) => (
                <li key={p.path} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[15px] first:border-t-0">
                  <span className="min-w-0 truncate">{p.path}</span>
                  <span className="shrink-0 tabular-nums text-muted">{p.count} {p.count === 1 ? "lead" : "leads"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[15px] text-muted">{data.chat.conversations === 0 ? "No one chatted with your website widget in this period." : "No leads with a page address in this period."}</p>
        )}
      </GlassCard>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="m-0 text-2xl font-semibold tabular-nums tracking-[-0.02em]">{value}</dd>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-soft px-4 py-3 text-[14px] text-muted">{children}</p>;
}

function RangePicker({ days }: { days: number }) {
  return (
    <nav aria-label="Time range" className="inline-flex rounded-full bg-soft p-1">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={`/dashboard/analytics?range=${r}`}
          aria-current={r === days ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 min-w-[72px] items-center justify-center rounded-full px-3 text-sm font-semibold no-underline transition-colors",
            r === days ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
          )}
        >
          {r} days
        </Link>
      ))}
    </nav>
  );
}
