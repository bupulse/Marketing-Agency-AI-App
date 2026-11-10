import Link from "next/link";
import type { ReactNode } from "react";
import { BadgeDollarSign, Clock, Eye, FileText, Filter, Globe2, Info, MapPin, MessageCircle, MousePointerClick, PhoneCall, Smartphone, Monitor, Tablet, UserPlus, Users, Share2, LineChart } from "lucide-react";
import type { VisitorAnalytics } from "@/lib/analytics/visitors";
import { countryName, dayLabel, durationLabel, oldMethodNote, previousLabel, previousRange, sourceLabel, type VisitorPeriod } from "@/lib/analytics/visitors-shared";
import { ChannelIcon } from "../channel-icon";
import { BarList } from "../charts/bar-list";
import { changePct, flagEmoji } from "../charts/chart-math";
import { ChartStyles, OTHER, SLOTS } from "../charts/chart-styles";
import { DonutChart } from "../charts/donut-chart";
import { FunnelChart } from "../charts/funnel-chart";
import { SegmentBar } from "../charts/segment-bar";
import { StatTile, type Delta } from "../charts/stat-tile";
import { PeriodPicker } from "./period-picker";
import { RankedTable } from "./ranked-table";
import { sourceSlices } from "./source-slices";
import { VisitorsChart } from "./visitors-chart";

// The support app's visitor analytics (docs/SUPPORT_DASHBOARD.md, "Visitor analytics"), in plain words for the owner:
// how many people came (against the same number of days before), when, from where, on what device, what they read and
// for how long, and how many went on to ask, chat, sign up and pay. Every section says in one line what it shows.

const num = (v: number) => v.toLocaleString("en-GB");
const pct1 = (v: number) => `${v < 10 && v % 1 !== 0 ? v.toFixed(1) : Math.round(v)}%`;

function Section({ id, title, what, icon, children, className }: { id: string; title: string; what: ReactNode; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-4 rounded-[24px] border border-line bg-surface p-4 shadow-[0_24px_60px_-48px_rgba(17,24,39,0.5)] sm:p-6 ${className ?? ""}`}>
      <header className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_24px_-12px_rgba(47,107,255,0.9)] [&>svg]:size-5">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
          <p className="text-[13px] leading-snug text-muted">{what}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="flex items-start gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3 text-[13.5px] text-muted">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-blue dark:text-[#8db0ff]" />
      <span>{children}</span>
    </p>
  );
}

const DEVICES: Record<string, { label: string; icon: ReactNode; slot: number }> = {
  mobile: { label: "Phones", icon: <Smartphone />, slot: 0 },
  desktop: { label: "Computers", icon: <Monitor />, slot: 1 },
  tablet: { label: "Tablets", icon: <Tablet />, slot: 6 },
};

function SourceIcon({ source, className = "size-7" }: { source: string; className?: string }) {
  if (source === "direct")
    return (
      <span aria-hidden className={`inline-flex items-center justify-center rounded-[28%] bg-[linear-gradient(135deg,#2f6bff,#7b5cff)] text-white ${className}`}>
        <MousePointerClick className="size-[58%]" strokeWidth={2.2} />
      </span>
    );
  if (source === "__other")
    return (
      <span aria-hidden className={`inline-flex items-center justify-center rounded-[28%] bg-soft text-[11px] font-bold text-muted ${className}`}>
        +
      </span>
    );
  return <ChannelIcon channel={source} className={className} />;
}

const sourceName = (key: string) => (key === "direct" ? "Direct" : key === "__other" ? "Everything else" : sourceLabel(key));
const sourceHint = (key: string) =>
  key === "direct" ? "Typed the address, a bookmark or an app" : key === "__other" ? "Smaller sources added up" : key.includes(".") ? "A link on this website" : undefined;

export function AnalyticsView({ data, period, href, liveHref, months, today }: { data: VisitorAnalytics; period: VisitorPeriod; href: string; liveHref: string; months: string[]; today: string }) {
  const unit = data.by;
  const old = oldMethodNote(data.lastOldDay);
  const cityShare = data.totals.rawVisitors ? Math.round((data.totals.visitorsWithCity / data.totals.rawVisitors) * 100) : null;
  const days = previousRange(period.from, period.to).days;
  const isToday = period.key === "today";
  const against = `vs ${previousLabel(days)}`;
  const prev = data.previous;
  const delta = (now: number, before: number | undefined): Delta | null => {
    if (isToday || !prev) return null;
    const v = changePct(now, before);
    return v == null ? null : { value: v, unit: "%", upIsGood: true, against };
  };
  const quotes = data.funnel.find((s) => s.key === "quotes")?.count ?? 0;
  const paid = data.funnel.find((s) => s.key === "paid")?.count ?? 0;
  const quoteRate = data.totals.visitors ? (quotes / data.totals.visitors) * 100 : null;
  const perVisitor = data.totals.visitors ? data.totals.views / data.totals.visitors : null;

  // Busiest point and the average, for the sentence under the chart.
  const busiest = data.series.reduce<(typeof data.series)[number] | null>((b, p) => (!b || p.visitors > b.visitors ? p : b), null);
  const avg = data.series.length ? Math.round(data.totals.visitors / data.series.length) : 0;

  const slices = sourceSlices(data.sources);
  const sourceTotal = data.sources.reduce((s, r) => s + r.visitors, 0);
  const topSource = slices[0];

  const funnelIcons: Record<string, ReactNode> = { visitors: <Users />, quotes: <PhoneCall />, chats: <MessageCircle />, signups: <UserPlus />, paid: <BadgeDollarSign /> };
  const deviceRows = data.devices.map((d) => ({ ...d, info: DEVICES[d.key] ?? { label: d.key, icon: <Globe2 />, slot: 7 } }));
  const phoneShare = (() => {
    const total = data.devices.reduce((s, d) => s + d.visitors, 0);
    const phones = data.devices.find((d) => d.key === "mobile")?.visitors ?? 0;
    return total ? Math.round((phones / total) * 100) : null;
  })();

  return (
    <main className="bp-viz flex flex-1 flex-col gap-5 p-4 sm:p-6">
      <ChartStyles />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">Analytics</h1>
          <p className="text-sm text-muted">
            Visitors to bupulse.com, <strong className="font-semibold text-text">{period.label}</strong>. Days run midnight to midnight UTC (2 AM to 2 AM in Kigali), the same as Admin.
          </p>
        </div>
        <Link
          href={liveHref}
          className="inline-flex min-h-11 items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pl-2 pr-4 text-sm font-semibold shadow-sm outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-4 focus-visible:ring-pulse-blue/30 motion-reduce:transform-none"
        >
          <span aria-hidden className="bp-live-dot inline-flex size-7 items-center justify-center rounded-full bg-[#0f9f6e] text-[12px] font-bold text-white">
            {data.liveNow == null ? "–" : num(data.liveNow)}
          </span>
          <span>
            {data.liveNow == null ? "On the site now" : `${data.liveNow === 1 ? "person" : "people"} on the site now`}
            <span className="ml-1.5 text-ok">See them live →</span>
          </span>
        </Link>
      </header>

      <PeriodPicker href={href} period={period} months={months} today={today} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          index={0}
          label="Visitors"
          value={data.totals.visitors}
          icon={<Users />}
          tone="blue"
          delta={delta(data.totals.visitors, prev?.visitors)}
          trend={data.series.length > 2 ? { values: data.series.map((p) => p.visitors), label: `Visitors per ${unit}, from ${data.series[0].label} to ${data.series[data.series.length - 1].label}` } : null}
          explain="People who opened the website. One per device per day: a phone and a laptop count as two."
          footer={isToday && prev ? <p className="text-[12.5px] text-muted">Yesterday (the whole day): <strong className="text-text">{num(prev.visitors)}</strong></p> : null}
        />
        <StatTile
          index={1}
          label="Page views"
          value={data.totals.views}
          icon={<Eye />}
          tone="violet"
          delta={delta(data.totals.views, prev?.views)}
          explain={perVisitor ? `Every page opened. On average each visitor opened ${perVisitor.toFixed(1)} pages.` : "Every page opened."}
          footer={isToday && prev ? <p className="text-[12.5px] text-muted">Yesterday (the whole day): <strong className="text-text">{num(prev.views)}</strong></p> : null}
        />
        <StatTile
          index={2}
          label="Average time on a page"
          value={data.totals.avgMs}
          format="ms"
          icon={<Clock />}
          tone="green"
          explain="How long a page stayed on screen. Longer usually means people were really reading."
        />
        <StatTile
          index={3}
          label="Asked for a quote"
          value={quotes}
          icon={<PhoneCall />}
          tone="orange"
          explain={quoteRate != null ? `“Get a free quote” forms sent: ${pct1(quoteRate)} of visitors. These are the warmest leads.` : "“Get a free quote” forms sent. These are the warmest leads."}
        />
      </div>

      {old && <Note>{old}</Note>}
      {data.breakdownFrom && <Note>Page views are kept for 90 days, so countries, cities, sources, devices and pages below start on {dayLabel(data.breakdownFrom, true)}. The visitor counts cover the whole period.</Note>}

      <Section
        id="visitors-h"
        title={`Visitors per ${unit}`}
        icon={<LineChart />}
        what={
          unit === "day"
            ? "How many people came each day. Tap “Page views” to see how much they read instead."
            : `How many people came each ${unit}. Each day counts its own visitors: someone who comes back on three days counts three times in the ${unit}.`
        }
      >
        <VisitorsChart points={data.series} unit={unit} />
        {busiest && busiest.visitors > 0 && data.series.length > 1 && (
          <p className="rounded-2xl bg-soft px-4 py-3 text-[13.5px]">
            Busiest {unit}: <strong>{busiest.label}</strong> with <strong>{num(busiest.visitors)}</strong> visitors. On average <strong>{num(avg)}</strong> a {unit}.
          </p>
        )}
      </Section>

      <Section
        id="funnel-h"
        title="From visit to paying"
        icon={<Filter />}
        what="Each step and how many reached it in this period. Steps are counted on their own, not the same people followed one by one."
      >
        <FunnelChart
          ariaLabel="From visit to paying, step by step"
          steps={data.funnel.map((s) => ({ key: s.key, label: s.label, hint: s.hint, icon: funnelIcons[s.key], count: s.count, ofPreviousPct: s.ofPreviousPct }))}
        />
        {data.totals.visitors > 0 && (
          <p className="rounded-2xl bg-soft px-4 py-3 text-[13.5px]">
            {paid > 0 ? (
              <>
                For every <strong>1,000 visitors</strong>, about <strong>{num(Math.max(1, Math.round((paid / data.totals.visitors) * 1000)))}</strong> started paying.
              </>
            ) : (
              <>No one started paying in this period yet. Quotes and chats are the steps to watch.</>
            )}
          </p>
        )}
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section
          id="sources-h"
          title="Where visitors came from"
          icon={<Share2 />}
          what={
            topSource && sourceTotal > 0 ? (
              <>The site or app that sent each visitor to their first page. Most came from <strong className="text-text">{sourceName(topSource.key)}</strong>.</>
            ) : (
              "The site or app that sent each visitor to their first page. Campaign links show their utm_source name."
            )
          }
        >
          {slices.length === 0 ? (
            <p className="rounded-2xl bg-soft px-4 py-5 text-center text-sm text-muted">No visits in this period yet.</p>
          ) : (
            <DonutChart
              ariaLabel="Visitors by where they came from"
              centerLabel="visitors"
              one="visitor"
              many="visitors"
              parts={slices.map((s) => ({
                key: s.key,
                label: sourceName(s.key),
                hint: sourceHint(s.key),
                icon: <SourceIcon source={s.key} />,
                value: s.value,
                color: s.slot == null ? OTHER : SLOTS[s.slot],
              }))}
            />
          )}
          <RankedTable
            caption="Visitors by where they came from"
            first="From"
            columns={["Visitors", "Page views"]}
            rows={data.sources.map((r) => ({ key: r.key, name: sourceLabel(r.key), value: r.visitors, cells: [r.visitors, r.views] }))}
            empty=""
          />
        </Section>

        <Section
          id="devices-h"
          title="Phones or computers"
          icon={<Smartphone />}
          what={phoneShare != null ? <>What visitors used to open the site. <strong className="text-text">{phoneShare}%</strong> were on a phone, so every page must work well on a small screen.</> : "What visitors used to open the site."}
        >
          <SegmentBar
            ariaLabel="Visitors by device"
            one="visitor"
            many="visitors"
            parts={deviceRows.map((d) => ({ key: d.key, label: d.info.label, icon: d.info.icon, value: d.visitors, color: SLOTS[d.info.slot] }))}
          />
          <RankedTable
            caption="Visitors by device"
            first="Device"
            columns={["Visitors", "Page views"]}
            rows={deviceRows.map((d) => ({ key: d.key, name: d.info.label, value: d.visitors, cells: [d.visitors, d.views] }))}
            empty=""
          />
        </Section>

        <Section id="countries-h" title="Countries" icon={<Globe2 />} what="Which country each visitor was in, from their internet address. The bar shows how they compare with the top country.">
          <BarList
            ariaLabel="Visitors by country"
            one="visitor"
            many="visitors"
            empty="No visits in this period yet."
            rows={data.countries.map((r) => ({ key: r.key || "unknown", name: countryName(r.key), label: countryName(r.key), icon: <span aria-hidden>{flagEmoji(r.key)}</span>, value: r.visitors }))}
          />
          <RankedTable
            caption="Visitors by country"
            first="Country"
            columns={["Visitors", "Page views"]}
            rows={data.countries.map((r) => ({ key: r.key || "unknown", name: countryName(r.key), value: r.visitors, cells: [r.visitors, r.views] }))}
            empty=""
          />
        </Section>

        <Section
          id="cities-h"
          title="Cities"
          icon={<MapPin />}
          what={
            cityShare != null && cityShare < 100
              ? `The nearest big town to each visitor (from their internet address, so not an exact place). Known for ${cityShare}% of visitors.`
              : "The nearest big town to each visitor (from their internet address, so not an exact place)."
          }
        >
          <BarList
            ariaLabel="Visitors by city"
            one="visitor"
            many="visitors"
            color="var(--viz-7)"
            empty="No city known yet for this period."
            rows={data.cities.map((r) => ({
              key: `${r.city}|${r.country ?? ""}`,
              name: (
                <>
                  {r.city}
                  {r.country && <span className="font-normal text-muted">, {countryName(r.country)}</span>}
                </>
              ),
              label: `${r.city}${r.country ? `, ${countryName(r.country)}` : ""}`,
              icon: <span aria-hidden>{flagEmoji(r.country)}</span>,
              value: r.visitors,
            }))}
          />
          <RankedTable
            caption="Visitors by city"
            first="City"
            columns={["Visitors", "Page views"]}
            rows={data.cities.map((r) => ({ key: `${r.city}|${r.country ?? ""}`, name: <>{r.city}{r.country && <span className="text-muted">, {countryName(r.country)}</span>}</>, value: r.visitors, cells: [r.visitors, r.views] }))}
            empty=""
          />
        </Section>
      </div>

      <Section
        id="pages-h"
        title="Most visited pages"
        icon={<FileText />}
        what="The pages opened most, with how long people stayed on each (only while the page was on screen; “–” means not measured yet)."
      >
        <BarList
          ariaLabel="Pages by views"
          one="view"
          many="views"
          first={8}
          showShare={false}
          color="var(--viz-3)"
          empty="No page views in this period yet."
          rows={data.pages.map((r) => ({
            key: r.path,
            name: <span className="font-mono text-[13px]">{r.path}</span>,
            label: r.path,
            value: r.views,
            detail: (
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="inline-flex items-center gap-1">
                  <Users aria-hidden className="size-3.5" /> {num(r.visitors)} visitors
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock aria-hidden className="size-3.5" /> {durationLabel(r.avgMs)} on the page
                </span>
              </span>
            ),
          }))}
        />
        <RankedTable
          caption="Pages by views, with the average time on each"
          first="Page"
          columns={["Views", "Visitors", "Avg time"]}
          rows={data.pages.map((r) => ({ key: r.path, name: <span className="break-all">{r.path}</span>, value: r.views, cells: [r.views, r.visitors, durationLabel(r.avgMs)] }))}
          empty=""
        />
      </Section>
    </main>
  );
}
