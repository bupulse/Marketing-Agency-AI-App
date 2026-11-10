import { archiveLinkAction } from "@/app/support/(app)/links/actions";
import { countryName, dayLabel, type VisitorPeriod } from "@/lib/analytics/visitors-shared";
import { channelLabel, shortLink } from "@/lib/links/rules";
import type { LinkRow, LinksReport, StaffLinkTotals } from "@/lib/links/service";
import { PeriodPicker } from "./analytics/period-picker";
import { CopyButton, CreateLinkForm } from "./links-client";

// The Links page of the support app (docs/SUPPORT_DASHBOARD.md "Tracked links").

const num = (v: number) => v.toLocaleString("en-US");

const RESULTS: { key: keyof Omit<LinkRow["stats"], "countries">; label: string }[] = [
  { key: "clicks", label: "Clicks" },
  { key: "visitors", label: "Visitors" },
  { key: "quotes", label: "Quotes" },
  { key: "chats", label: "Chats" },
  { key: "signups", label: "Sign-ups" },
  { key: "paid", label: "Paid" },
];

function LinkCard({ link, site, owner }: { link: LinkRow; site: string; owner: boolean }) {
  const url = shortLink(site, link.code);
  return (
    <li className={`flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 ${link.archived ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {link.label}
            {link.archived && <span className="ml-2 rounded-full bg-soft px-2 py-0.5 text-xs font-semibold text-muted">Archived</span>}
          </p>
          <p className="break-all text-sm">{url}</p>
          <p className="text-[13px] text-muted">
            {channelLabel(link.channel)} · opens {link.destination}
            {owner && <> · {link.by.owner ? "company link" : `by ${link.by.name ?? "staff"}`}</>} · made {dayLabel(link.createdAt.slice(0, 10), true)}
          </p>
        </div>
        <div className="flex gap-2">
          {!link.archived && <CopyButton text={url} />}
          <form action={archiveLinkAction}>
            <input type="hidden" name="id" value={link.id} />
            <input type="hidden" name="archive" value={link.archived ? "0" : "1"} />
            <button type="submit" className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:bg-ok-bg">
              {link.archived ? "Bring back" : "Archive"}
            </button>
          </form>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {RESULTS.map((r) => (
          <div key={r.key} className="rounded-xl bg-soft px-3 py-2">
            <dt className="text-xs text-muted">{r.label}</dt>
            <dd className="text-lg font-bold tabular-nums">{num(link.stats[r.key])}</dd>
          </div>
        ))}
      </dl>
      {link.stats.countries.length > 0 && (
        <p className="text-[13px] text-muted">
          Top countries: {link.stats.countries.map((c) => `${countryName(c.country)} (${num(c.clicks)})`).join(", ")}
        </p>
      )}
    </li>
  );
}

function StaffTable({ rows }: { rows: StaffLinkTotals[] }) {
  return (
    <section aria-labelledby="by-staff" className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 sm:p-5">
      <div>
        <h2 id="by-staff" className="text-base font-semibold">Leads by staff</h2>
        <p className="text-sm text-muted">
          Visitors from Google, Facebook and the other sites, and from the company&apos;s own links, are the company&apos;s. A visitor becomes a staff
          member&apos;s lead when they came through that person&apos;s link, or when that person talked to them first in the chat (chat leads).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2 pr-3 font-medium">Who</th>
              <th className="py-2 pr-3 text-right font-medium">Links</th>
              <th className="py-2 pr-3 text-right font-medium">Clicks</th>
              <th className="py-2 pr-3 text-right font-medium">Quotes</th>
              <th className="py-2 pr-3 text-right font-medium">Chat leads</th>
              <th className="py-2 pr-3 text-right font-medium">Sign-ups</th>
              <th className="py-2 text-right font-medium">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id ?? "company"} className="border-t border-line">
                <td className="py-2 pr-3 font-semibold">{r.name}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{num(r.links)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{num(r.clicks)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{num(r.quotes)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.company ? "–" : num(r.chatLeads)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{num(r.signups)}</td>
                <td className="py-2 text-right tabular-nums">{num(r.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LinksView({ report, owner, period, href, months, today, site }: { report: LinksReport; owner: boolean; period: VisitorPeriod; href: string; months: string[]; today: string; site: string }) {
  const active = report.links.filter((l) => !l.archived);
  const archived = report.links.filter((l) => l.archived);
  return (
    <main className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Links</h1>
        <p className="text-sm text-muted">
          Short links that show where visitors come from: every click, then who asked for a quote, chatted, signed up and paid, {period.label}. A visitor is
          credited to the last link they opened in the 30 days before.
          {owner ? " You see every link." : " You see your own links."}
        </p>
      </header>

      <CreateLinkForm site={site} owner={owner} />

      <PeriodPicker href={href} period={period} months={months} today={today} />
      {report.visitorsFrom && <p className="text-[13px] text-muted">Visitors are counted from {dayLabel(report.visitorsFrom, true)}: page views are kept 90 days.</p>}

      {owner && report.staff && report.staff.length > 0 && <StaffTable rows={report.staff} />}
      {!owner && (
        <p className="rounded-[20px] border border-line bg-surface p-4 text-sm">
          <strong className="tabular-nums">{num(report.myChatLeads)}</strong> chat {report.myChatLeads === 1 ? "lead" : "leads"} {period.label}: visitors you talked to first in
          the chat.
        </p>
      )}

      <section aria-labelledby="links" className="flex flex-col gap-3">
        <h2 id="links" className="text-base font-semibold">
          {owner ? "All links" : "Your links"} ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted">No links yet. Make one above, then put it in a bio, a post, a WhatsApp message or a poster.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((l) => (
              <LinkCard key={l.id} link={l} site={site} owner={owner} />
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-sm font-semibold">Archived ({archived.length})</summary>
          <ul className="mt-3 flex flex-col gap-3">
            {archived.map((l) => (
              <LinkCard key={l.id} link={l} site={site} owner={owner} />
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
