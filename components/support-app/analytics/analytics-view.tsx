import Link from "next/link";
import type { ReactNode } from "react";
import type { VisitorAnalytics } from "@/lib/analytics/visitors";
import { countryName, dayLabel, durationLabel, oldMethodNote, sourceLabel, type VisitorPeriod } from "@/lib/analytics/visitors-shared";
import { PeriodPicker } from "./period-picker";
import { RankedTable } from "./ranked-table";
import { VisitorsChart } from "./visitors-chart";

// The support app's visitor analytics (docs/SUPPORT_DASHBOARD.md, "Visitor analytics"), in plain words for the owner:
// how many people came, from where, what they read and for how long, and how many went on to ask, chat, sign up and pay.

const num = (v: number) => v.toLocaleString("en-GB");
const pct = (v: number | null) => (v == null ? "–" : `${v % 1 === 0 ? v : v.toFixed(1)}%`);

function Section({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-[17px] font-bold">{title}</h2>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[18px] border border-line bg-surface p-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[26px] font-bold tabular-nums tracking-[-0.02em]">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function AnalyticsView({ data, period, href, liveHref, months, today }: { data: VisitorAnalytics; period: VisitorPeriod; href: string; liveHref: string; months: string[]; today: string }) {
  const unit = data.by;
  const old = oldMethodNote(data.lastOldDay);
  const cityShare = data.totals.rawVisitors ? Math.round((data.totals.visitorsWithCity / data.totals.rawVisitors) * 100) : null;
  return (
    <main className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Analytics</h1>
        <p className="text-sm text-muted">Visitors to bupulse.com, {period.label}. Days run from midnight to midnight UTC (2 AM to 2 AM in Kigali), the same as Admin.</p>
      </header>

      <PeriodPicker href={href} period={period} months={months} today={today} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Visitors" value={num(data.totals.visitors)} hint="One per device per day" />
        <Tile label="Page views" value={num(data.totals.views)} hint="Every page opened" />
        <Tile label="Average time on a page" value={durationLabel(data.totals.avgMs)} hint="While the page was on screen" />
        <Tile
          label="On the site now"
          value={data.liveNow == null ? "–" : num(data.liveNow)}
          hint={<Link href={liveHref} className="font-semibold text-ok underline-offset-2 hover:underline">See them live</Link>}
        />
      </div>

      {old && <p role="note" className="rounded-2xl border border-line bg-surface px-4 py-3 text-[13.5px] text-muted">{old}</p>}
      {data.breakdownFrom && (
        <p role="note" className="rounded-2xl border border-line bg-surface px-4 py-3 text-[13.5px] text-muted">
          Page views are kept for 90 days, so countries, cities, sources and pages below start on {dayLabel(data.breakdownFrom, true)}. The visitor counts cover the whole period.
        </p>
      )}

      <Section
        id="visitors-h"
        title={`Visitors per ${unit}`}
        note={unit === "day" ? "Someone who opens the site on a phone and later on a computer counts as two visitors." : `Each day counts its own visitors: someone who comes back on three days counts three times in the ${unit}.`}
      >
        <VisitorsChart points={data.series} unit={unit} />
      </Section>

      <Section id="funnel-h" title="From visit to paying" note="What happened in this period at each step. They are counted separately, not the same people followed one by one.">
        <ol className="flex flex-col gap-3">
          {data.funnel.map((s) => {
            const top = Math.max(1, data.funnel[0].count);
            return (
              <li key={s.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span><strong>{s.label}</strong> <span className="text-[13px] text-muted">{s.hint}</span></span>
                  <span className="tabular-nums">
                    <strong>{num(s.count)}</strong>
                    {s.ofPreviousPct != null && <span className="text-[13px] text-muted"> · {pct(s.ofPreviousPct)} of the step before</span>}
                  </span>
                </div>
                <span aria-hidden className="block h-2 rounded-full bg-ok-bg">
                  <span className="block h-full rounded-full bg-[var(--color-pulse-blue)]" style={{ width: `${s.count > 0 ? Math.max(1.5, Math.min(100, (s.count / top) * 100)) : 0}%` }} />
                </span>
              </li>
            );
          })}
        </ol>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section id="sources-h" title="Where visitors came from" note="The site or app that sent each visitor to their first page. Campaign links show their utm_source name.">
          <RankedTable
            caption="Visitors by where they came from"
            first="From"
            columns={["Visitors", "Page views"]}
            rows={data.sources.map((r) => ({ key: r.key, name: sourceLabel(r.key), value: r.visitors, cells: [r.visitors, r.views] }))}
            empty="No visits in this period yet."
          />
        </Section>
        <Section id="countries-h" title="Countries">
          <RankedTable
            caption="Visitors by country"
            first="Country"
            columns={["Visitors", "Page views"]}
            rows={data.countries.map((r) => ({ key: r.key || "unknown", name: countryName(r.key), value: r.visitors, cells: [r.visitors, r.views] }))}
            empty="No visits in this period yet."
          />
        </Section>
        <Section
          id="cities-h"
          title="Cities"
          note={cityShare != null && cityShare < 100 ? `The city is known for ${cityShare}% of visitors. It comes from the visitor's internet address, so it is the nearest big town, not an exact place.` : "From the visitor's internet address: the nearest big town, not an exact place."}
        >
          <RankedTable
            caption="Visitors by city"
            first="City"
            columns={["Visitors", "Page views"]}
            rows={data.cities.map((r) => ({ key: `${r.city}|${r.country ?? ""}`, name: <>{r.city}{r.country && <span className="text-muted">, {countryName(r.country)}</span>}</>, value: r.visitors, cells: [r.visitors, r.views] }))}
            empty="No city known yet for this period."
          />
        </Section>
        <Section id="pages-h" title="Most visited pages" note="Time on page counts only while the page is on screen. “–” means it was not measured yet.">
          <RankedTable
            caption="Pages by views, with the average time on each"
            first="Page"
            columns={["Views", "Visitors", "Avg time"]}
            rows={data.pages.map((r) => ({ key: r.path, name: <span className="break-all">{r.path}</span>, value: r.views, cells: [r.views, r.visitors, durationLabel(r.avgMs)] }))}
            empty="No page views in this period yet."
          />
        </Section>
      </div>
    </main>
  );
}
