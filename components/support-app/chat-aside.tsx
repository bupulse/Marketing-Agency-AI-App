import type { ReactNode } from "react";
import { Building2, ChevronRight, Clock, ExternalLink, Globe2, History, Link2, Mail, MapPin, Monitor, Phone, Route, ShieldCheck, Target, Wifi } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AccountFacts, ConversationDetail } from "@/lib/support/contract";
import { minutesOnSite } from "@/lib/support/app-client/lists";
import { flagEmoji, placeLabel } from "./chat/helpers";
import { Avatar } from "./chat/message";

const PLAN_STATUS: Record<string, { label: string; tone: string }> = {
  trial: { label: "trial", tone: "bg-ok-bg text-ok" },
  active: { label: "active", tone: "bg-success-bg text-success" },
  past_due: { label: "payment late", tone: "bg-danger-bg text-danger" },
  pending_payment: { label: "payment pending", tone: "bg-[#fff4e0] text-[#8a5a00] dark:bg-[#d08700]/20 dark:text-[#ffc65c]" },
  none: { label: "no plan", tone: "bg-black/[0.05] text-muted dark:bg-white/[0.08]" },
};

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

function Card({ title, icon, children, label }: { title: string; icon: ReactNode; children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 shadow-[0_10px_30px_-26px_rgba(17,24,39,0.6)]">
      <h2 className="flex items-center gap-2 text-[11.5px] font-bold tracking-[0.06em] text-muted">
        <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-lg bg-soft text-ok">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One fact: an icon, a quiet label and the value. */
function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[13px]">
      <span aria-hidden className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <dt className="w-[86px] shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words font-medium">{children}</dd>
    </div>
  );
}

function Plan({ a }: { a: AccountFacts }) {
  const status = a.planStatus ? PLAN_STATUS[a.planStatus] : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-semibold">{a.plan ?? "No plan"}</span>
      {status && (
        <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", status.tone)}>
          {status.label}
          {a.planStatus === "trial" && a.trialDaysLeft != null ? `, ${a.trialDaysLeft} days left` : ""}
        </span>
      )}
    </span>
  );
}

const ic = "size-4";

/** The facts beside a chat, as cards: who it is, their account, this visit (where, device, link, pages) and past chats. */
export function ChatAside({ detail, onOpenChat }: { detail: ConversationDetail; onOpenChat: (id: string) => void }) {
  const { visitor: v, account: a, visit } = detail;
  const name = v.name ?? detail.visitorName;
  const seconds = visit ? Math.max(0, (Date.parse(visit.lastSeenAt) - Date.parse(visit.startedAt)) / 1000) : 0;
  const place = visit ? placeLabel(visit.city, visit.country) : null;
  return (
    <div className="flex flex-col gap-3 p-4">
      <section aria-label="Who" className="relative overflow-hidden rounded-[20px] border border-line bg-surface p-4 shadow-[0_10px_30px_-26px_rgba(17,24,39,0.6)]">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <div className="flex items-center gap-3">
          <span className="relative">
            <Avatar name={name} className="size-12 text-[15px]" />
            {visit?.country && (
              <span aria-hidden className="absolute -bottom-1 -right-1 text-[17px] leading-none drop-shadow-sm">{flagEmoji(visit.country)}</span>
            )}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[16px] font-bold">{name}</span>
            <span className="flex flex-wrap gap-1.5">
              {v.signedIn ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11.5px] font-semibold text-success">
                  <ShieldCheck aria-hidden className="size-3.5" /> Signed in
                </span>
              ) : (
                <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11.5px] font-semibold text-muted dark:bg-white/[0.08]">Not signed in</span>
              )}
              {place && <span className="truncate rounded-full bg-soft px-2 py-0.5 text-[11.5px] font-semibold text-text">{place}</span>}
            </span>
          </span>
        </div>
        {(v.email || v.phone) && (
          <dl className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
            {v.email && (
              <Row icon={<Mail className={ic} />} label="Email">
                <a href={`mailto:${v.email}`} className="text-ok underline-offset-2 hover:underline">{v.email}</a>
              </Row>
            )}
            {v.phone && (
              <Row icon={<Phone className={ic} />} label="Phone">
                {v.phone}
              </Row>
            )}
          </dl>
        )}
      </section>

      {a && (
        <Card title="ACCOUNT" label="Account" icon={<Building2 className="size-3.5" />}>
          <dl className="flex flex-col gap-2">
            {a.businessName && <Row icon={<Building2 className={ic} />} label="Business">{a.businessName}</Row>}
            <Row icon={<ShieldCheck className={ic} />} label="Plan"><Plan a={a} /></Row>
            {a.failedPostsThisWeek != null && (
              <Row icon={<Target className={ic} />} label="Failed posts">
                <span className={a.failedPostsThisWeek > 0 ? "text-danger" : undefined}>{a.failedPostsThisWeek} this week</span>
              </Row>
            )}
          </dl>
          {a.businessInfoPercent != null && (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between text-[12.5px]">
                <span className="text-muted">Business info filled in</span>
                <span className="font-semibold tabular-nums">{a.businessInfoPercent}%</span>
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-soft" role="img" aria-label={`Business info ${a.businessInfoPercent}% filled in`}>
                <span className="block h-full rounded-full bg-brand-gradient" style={{ width: `${Math.max(0, Math.min(100, a.businessInfoPercent))}%` }} />
              </span>
            </div>
          )}
          {a.channels.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-muted">Channels</span>
              <span className="flex flex-wrap gap-1.5">
                {a.channels.map((c) => (
                  <span key={c.platform} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold", c.ok ? "bg-success-bg text-success" : "bg-danger-bg text-danger")}>
                    <span aria-hidden className={cn("size-1.5 rounded-full", c.ok ? "bg-success" : "bg-danger")} />
                    {c.platform} {c.ok ? "OK" : "expired"}
                  </span>
                ))}
              </span>
            </div>
          )}
          {a.adminHref && (
            <a href={a.adminHref} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-line text-[13px] font-semibold text-ok transition-colors hover:bg-ok-bg">
              Open in Admin <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
        </Card>
      )}

      {visit && (
        <Card title="THIS VISIT" label="This visit" icon={<Globe2 className="size-3.5" />}>
          <dl className="flex flex-col gap-2">
            {place && (
              <Row icon={<MapPin className={ic} />} label="Where">
                <span aria-hidden>{flagEmoji(visit.country)} </span>
                {place} <span className="font-normal text-muted">(about)</span>
              </Row>
            )}
            {visit.ip && <Row icon={<Wifi className={ic} />} label="IP"><span className="font-mono text-[12.5px]">{visit.ip}</span></Row>}
            {(visit.device || visit.browser) && <Row icon={<Monitor className={ic} />} label="Device">{[visit.device, visit.browser].filter(Boolean).join(" · ")}</Row>}
            <Row icon={<Globe2 className={ic} />} label="Came from">{visit.referrer ?? "direct"}</Row>
            {detail.lead?.link && (
              <Row icon={<Link2 className={ic} />} label="Via link">
                <span className="rounded-md bg-soft px-1.5 py-0.5 font-mono text-[12px]">{detail.lead.link}</span>
              </Row>
            )}
            {detail.lead && <Row icon={<Target className={ic} />} label="Lead of">{detail.lead.of}</Row>}
            <Row icon={<Clock className={ic} />} label="On site">{minutesOnSite(seconds)} · {ordinal(visit.visitCount)} visit</Row>
          </dl>
          {visit.pages.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                <Route aria-hidden className="size-4" /> Pages, in order
              </span>
              <ol className="relative flex flex-col gap-2.5 pl-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
                {visit.pages.map((p, i) => {
                  const now = i === visit.pages.length - 1 && p.path === visit.currentPath;
                  return (
                    <li key={`${p.path}-${p.at}`} className="relative text-[13px] leading-snug">
                      <span aria-hidden className={cn("absolute -left-5 top-1 size-[11px] rounded-full border-2 border-surface", now ? "bg-success shadow-[0_0_0_3px_rgba(15,122,74,0.2)]" : "bg-line")} />
                      <span className={cn("break-all font-mono text-[12.5px]", now && "font-semibold")}>{p.path}</span>
                      {p.title && <span className="block text-[12px] text-muted">{p.title}</span>}
                      {now && <span className="ml-1 rounded-full bg-success-bg px-1.5 py-px text-[11px] font-semibold text-success">now</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </Card>
      )}

      {detail.past.length > 0 && (
        <Card title="PAST CHATS" label="Past chats" icon={<History className="size-3.5" />}>
          <ul className="-mx-1.5 flex flex-col gap-1">
            {detail.past.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpenChat(p.id)} className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-1.5 text-left transition-colors hover:bg-soft">
                  <span className="shrink-0 rounded-lg bg-soft px-1.5 py-1 font-mono text-[11.5px] font-semibold text-ok">#{String(p.number).padStart(4, "0")}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-semibold">{p.title}</span>
                    <span className="truncate text-[12px] text-muted">{p.outcome}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
