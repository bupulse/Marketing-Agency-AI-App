import Link from "next/link";
import { BarChart3, ChartLine, Eye, Heart, LayoutGrid, Lightbulb, MessageCircle, Percent, Plug, Send, Trophy, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/app/empty-state";
import { ChoiceTiles, FilterChips, KitStyles, PageHeader, StatGrid, StatTile, type TileDelta } from "@/components/admin/kit";
import { CARD } from "@/components/admin/kit/tones";
import { formatCompact, formatPct } from "@/components/analytics/format";
import { TrendChart } from "@/components/analytics/trend-chart";
import { NetworkIcon, networkName } from "@/components/publishing/network-icon";
import { Button } from "@/components/ui";
import { RANGES } from "@/lib/analytics/compute";
import type { loadClientAnalytics } from "@/lib/analytics/service";
import { cn } from "@/lib/cn";
import type { Network } from "@/lib/social/types";

export type AnalyticsData = Awaited<ReturnType<typeof loadClientAnalytics>>;
export const ANALYTICS_VIEWS = ["overview", "posts", "networks", "chat"] as const;
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

/** A change in percent as the kit's "Up 12%" chip (StatTile reads it from two numbers). */
const delta = (change: number | null, days: number): TileDelta | null => (change === null ? null : { now: 100 + change, before: 100, against: `vs the ${days} days before` });

/**
 * The Analytics page (plain data in, so the page and the dev preview draw the same). Split into four views picked by
 * cards (?view=), so each screen shows one thing: the summary, the posts, the networks or the website chat.
 */
export function AnalyticsScreen({ data, days, view, params = {}, base = "/dashboard/analytics" }: { data: AnalyticsData; days: number; view: AnalyticsView; params?: Record<string, string | string[] | undefined>; base?: string }) {
  const range = (
    <FilterChips
      label="Time range"
      param="range"
      base={base}
      params={params}
      current={String(days)}
      allValue="30"
      options={RANGES.map((r) => ({ value: String(r), label: `${r} days` }))}
    />
  );
  const header = <PageHeader icon={BarChart3} title="Analytics" description="How your posts and website chat are doing, compared with the days before." actions={data.hasChannels ? range : undefined} />;

  if (!data.hasChannels) {
    return (
      <div className="flex flex-col gap-6">
        <KitStyles />
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
  const noMetricsYet = cards.posts.value > 0 && data.measured === 0;
  const notes = [
    data.reminderOnlyChannels && "All your connected channels are reminder-only, so BuPulse cannot read their results. Connect a business or creator account to see reach and engagement.",
    noMetricsYet && !data.reminderOnlyChannels && "Your posts are live. Results arrive within a day of publishing, so check back tomorrow.",
    data.awaitingMetrics > 0 && !noMetricsYet && `${data.awaitingMetrics} recent ${data.awaitingMetrics === 1 ? "post is" : "posts are"} still waiting for results. They arrive within a day of publishing.`,
    data.reminderPosts > 0 && `${data.reminderPosts} ${data.reminderPosts === 1 ? "post was" : "posts were"} sent as reminders (personal Instagram, scripts). They are posted by hand, so they have no results here.`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      {header}
      <ChoiceTiles
        label="What to look at"
        param="view"
        base={base}
        params={params}
        current={view}
        allValue="overview"
        options={[
          { value: "overview", label: "Summary", hint: "The main numbers", icon: LayoutGrid },
          { value: "posts", label: "Posts", hint: "Trend and best posts", icon: Trophy },
          { value: "networks", label: "Networks", hint: "Each app side by side", icon: ChartLine },
          { value: "chat", label: "Website chat", hint: `${data.chat.leads} ${data.chat.leads === 1 ? "lead" : "leads"}`, icon: MessageCircle },
        ]}
      />

      {view === "overview" && (
        <>
          {notes.map((n) => (
            <p key={n} className="rounded-2xl bg-soft px-4 py-3 text-[14px] text-muted">
              {n}
            </p>
          ))}
          <StatGrid cols={3}>
            <StatTile icon={Send} label="Posts published" value={String(cards.posts.value)} delta={delta(cards.posts.change, days)} hint={cards.posts.change === null ? "No earlier data to compare." : undefined} />
            <StatTile icon={Eye} tone="violet" label="Reach" value={formatCompact(cards.reach.value)} delta={delta(cards.reach.change, days)} hint="People who saw your posts" />
            <StatTile icon={Heart} tone="pink" label="Engagement" value={formatCompact(cards.engagement.value)} delta={delta(cards.engagement.change, days)} hint="Likes, comments, shares and saves" />
            <StatTile icon={Percent} tone="indigo" label="Engagement rate" value={formatPct(cards.rate.value)} delta={delta(cards.rate.change, days)} hint="Engagement divided by reach" />
            <StatTile icon={MessageCircle} tone="teal" label="Website chats" value={String(cards.chats.value)} delta={delta(cards.chats.change, days)} hint="Visitors who chatted with you" href={`${base}?${new URLSearchParams({ ...(days !== 30 ? { range: String(days) } : {}), view: "chat" })}`} />
            <StatTile icon={UserPlus} tone="green" label="Leads captured" value={String(cards.leads.value)} delta={delta(cards.leads.change, days)} hint="People who left their details" href="/dashboard/leads" />
          </StatGrid>
          {data.tips.length > 0 && (
            <Card title="What worked" icon={<Lightbulb aria-hidden className="size-5 text-pulse-violet" />}>
              <ul className="flex flex-col gap-2 text-[15px]">
                {data.tips.map((t) => (
                  <li key={t.id} className="flex gap-2.5">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-pulse-blue" />
                    <span>{t.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {view === "posts" && (
        <>
          <Card title="Trend" hint={`Reach and engagement per ${data.trendUnit}.`}>
            {cards.posts.value === 0 ? (
              <p className="text-[15px] text-muted">No posts were published in the last {days} days. Schedule one from the Calendar and its results will appear here.</p>
            ) : data.measured === 0 ? (
              <p className="text-[15px] text-muted">The chart appears once results have arrived for your posts.</p>
            ) : (
              <TrendChart points={data.trend} unit={data.trendUnit} />
            )}
          </Card>
          <Card title="Best posts" hint="Your posts with the best engagement rate.">
            {data.best.length === 0 ? (
              <p className="text-[15px] text-muted">Your top posts appear here once results have arrived for at least one post.</p>
            ) : (
              <ol className="flex flex-col">
                {data.best.map((b, i) => {
                  const href = b.permalink ?? "/dashboard/calendar";
                  const external = Boolean(b.permalink);
                  return (
                    <li key={b.id} className="border-t border-line first:border-t-0">
                      <Link href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="flex items-center gap-3 rounded-xl py-3 text-text no-underline transition-colors hover:bg-soft/60">
                        <span aria-hidden className="w-4 shrink-0 text-center text-sm font-semibold text-muted">{i + 1}</span>
                        {b.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={b.thumb} alt="" width={56} height={56} loading="lazy" className="size-14 shrink-0 rounded-xl object-cover" />
                        ) : (
                          <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl bg-soft text-muted">
                            <ChartLine className="size-5" />
                          </span>
                        )}
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-[15px] font-medium">{b.text || "Post without text"}</span>
                          <span className="flex items-center gap-2 text-[13px] text-muted">
                            <NetworkIcon network={b.network as Network} size={16} />
                            {networkName(b.network)} · {new Date(b.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: data.timeZone })}
                          </span>
                          <span className="text-[13px] tabular-nums text-muted">
                            {formatCompact(b.reach)} reach · {formatCompact(b.engagement)} engagement
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-lg font-semibold tabular-nums">{formatPct(b.rate)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </>
      )}

      {view === "networks" && (
        <Card title="By network" hint="Each connected app, side by side.">
          {data.networks.length === 0 ? (
            <p className="text-[15px] text-muted">Nothing published in this period yet.</p>
          ) : (
            <ul className="kit-rise grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.networks.map((n) => (
                <li key={n.network} className="flex flex-col gap-3 rounded-2xl border border-line p-4">
                  <span className="inline-flex items-center gap-2.5 text-[15px] font-semibold">
                    <NetworkIcon network={n.network as Network} size={26} />
                    {networkName(n.network)}
                  </span>
                  <dl className="grid grid-cols-4 gap-2 text-center">
                    <Fact label="Posts" value={String(n.posts)} />
                    <Fact label="Reach" value={n.measured > 0 ? formatCompact(n.reach) : "–"} />
                    <Fact label="Engaged" value={n.measured > 0 ? formatCompact(n.engagement) : "–"} />
                    <Fact label="Rate" value={formatPct(n.rate)} />
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {view === "chat" && (
        <Card title="Website chat" hint="Visitors who chatted, and how many left their details." action={<Button href="/dashboard/leads" variant="outline" size="sm">See leads</Button>}>
          <StatGrid cols={3} className="grid-cols-3">
            <StatTile icon={MessageCircle} tone="teal" label="Chats" value={String(data.chat.conversations)} />
            <StatTile icon={UserPlus} tone="green" label="Leads" value={String(data.chat.leads)} />
            <StatTile icon={Percent} tone="indigo" label="Became a lead" value={formatPct(data.chat.conversion)} />
          </StatGrid>
          {data.chat.pages.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-muted">Pages leads came from</h3>
              <ul className="flex flex-col">
                {data.chat.pages.map((p) => (
                  <li key={p.path} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[15px] first:border-t-0">
                    <span className="min-w-0 truncate">{p.path}</span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {p.count} {p.count === 1 ? "lead" : "leads"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[15px] text-muted">{data.chat.conversations === 0 ? "No one chatted with your website widget in this period." : "No leads with a page address in this period."}</p>
          )}
        </Card>
      )}
    </div>
  );
}

function Card({ title, hint, icon, action, children }: { title: string; hint?: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={cn("kit-rise flex flex-col gap-4 p-5 sm:p-6", CARD)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-[18px] font-bold tracking-[-0.02em]">
            {icon}
            {title}
          </h2>
          {hint && <p className="text-[14px] text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-soft px-1 py-2">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="m-0 text-[16px] font-bold tabular-nums">{value}</dd>
    </div>
  );
}
