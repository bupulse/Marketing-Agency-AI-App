import Link from "next/link";
import { BadgeCheck, CalendarClock, ChevronRight, FileText, Flag, Globe, Inbox, Layers, PhoneCall, Smartphone, Sparkles, Trophy, TriangleAlert, type LucideIcon } from "lucide-react";
import type { InboxKey, InboxSection } from "@/lib/admin/inbox";
import { dateTime, num } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import { CARD, EmptyState, FilterChips, FOCUS, IconBadge, LIFT, type KitTone, type SearchParamsLike } from "./kit";

/** The icon and colour of each kind of to-do, so the eye finds payments or quotes without reading. */
export const INBOX_LOOK: Record<InboxKey, { icon: LucideIcon; tone: KitTone; short: string }> = {
  quotes: { icon: PhoneCall, tone: "orange", short: "Quotes" },
  payments: { icon: Smartphone, tone: "green", short: "Payments" },
  approvals: { icon: BadgeCheck, tone: "violet", short: "Approvals" },
  demos: { icon: CalendarClock, tone: "orange", short: "Demos" },
  requests: { icon: Layers, tone: "orange", short: "Plan requests" },
  invoices: { icon: FileText, tone: "green", short: "Invoices" },
  offers: { icon: Sparkles, tone: "green", short: "Offers" },
  contests: { icon: Trophy, tone: "blue", short: "Contests" },
  regions: { icon: Globe, tone: "blue", short: "Regions" },
  reports: { icon: Flag, tone: "blue", short: "Reports" },
  errors: { icon: TriangleAlert, tone: "red", short: "Errors" },
};

/** The section the chips ask for (?show=), or "" for all of them. */
export const inboxShown = (sections: InboxSection[], asked: string | undefined) => (asked && sections.some((s) => s.key === asked) ? asked : "");

/**
 * The to-do list: filter chips (one per kind, with its count), then one calm card per kind of task with why it
 * matters, the first few items as tappable rows and a link to all of them. Most urgent first, as the lib sorts them.
 */
export function InboxView({ sections, show = "", params }: { sections: InboxSection[]; show?: string; params?: SearchParamsLike }) {
  if (sections.length === 0) {
    return <EmptyState tone="good" icon={Inbox} title="Inbox zero. Nothing is waiting for you." hint="New quotes, payments and requests appear here the moment they arrive." />;
  }
  const shown = show ? sections.filter((s) => s.key === show) : sections;
  const total = sections.filter((s) => s.key !== "errors").reduce((n, s) => n + s.count, 0);
  return (
    <div className="flex flex-col gap-4">
      {sections.length > 1 && (
        <FilterChips
          label="Show to-dos"
          param="show"
          base="/admin/inbox"
          params={params}
          current={show}
          options={[{ value: "", label: "Everything", count: total }, ...sections.map((s) => ({ value: s.key, label: INBOX_LOOK[s.key].short, count: s.count, icon: INBOX_LOOK[s.key].icon }))]}
        />
      )}
      <ul className="kit-rise grid items-start gap-4 xl:grid-cols-2">
        {shown.map((s) => (
          <li key={s.key} className="min-w-0">
            <InboxCard section={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function InboxCard({ section: s }: { section: InboxSection }) {
  const look = INBOX_LOOK[s.key];
  const urgent = s.tone === "danger" && s.key !== "errors";
  return (
    <section aria-labelledby={`inbox-${s.key}`} className={cn("relative flex min-w-0 flex-col gap-3 overflow-hidden p-4 sm:p-5", CARD)}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", urgent ? "bg-danger" : s.tone === "violet" ? "bg-pulse-violet" : "bg-line")} />
      <div className="flex items-start gap-3">
        <IconBadge icon={look.icon} tone={look.tone} />
        <div className="min-w-0 flex-1">
          <h2 id={`inbox-${s.key}`} className="text-[16px] font-bold leading-snug tracking-[-0.01em]">{s.title}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{s.why}</p>
        </div>
        <span className="flex shrink-0 flex-col items-end">
          <span className={cn("text-[24px] font-bold leading-none tabular-nums", urgent && "text-danger")} aria-label={`${s.count} waiting`}>{num(s.count)}</span>
          <span aria-hidden className="pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">waiting</span>
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {s.items.map((i) => (
          <li key={i.id}>
            <Link href={i.href} className={cn("group flex min-h-12 items-center gap-3 rounded-2xl bg-soft/70 px-3.5 py-2 text-text no-underline transition-colors hover:bg-soft dark:bg-white/[0.04] dark:hover:bg-white/[0.07]", FOCUS)}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-semibold">{i.text}</span>
                {(i.sub || i.at) && <span className="truncate text-[12.5px] text-muted">{[i.sub, i.at ? dateTime(i.at) : null].filter(Boolean).join(" · ")}</span>}
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none" />
            </Link>
          </li>
        ))}
      </ul>
      <Link href={s.href} className={cn("inline-flex min-h-10 w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[13px] font-semibold text-pulse-blue no-underline dark:bg-white/[0.04] dark:text-[#8db0ff]", LIFT, FOCUS)}>
        {s.count > s.items.length ? `See all ${num(s.count)}` : "Open the page"}
        <ChevronRight aria-hidden className="size-4" />
      </Link>
    </section>
  );
}
