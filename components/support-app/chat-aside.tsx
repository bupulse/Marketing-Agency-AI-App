import type { AccountFacts, ConversationDetail } from "@/lib/support/contract";
import { initials, minutesOnSite } from "@/lib/support/app-client/lists";

const PLAN_STATUS: Record<string, { label: string; tone: string }> = {
  trial: { label: "trial", tone: "text-ok" },
  active: { label: "active", tone: "text-success" },
  past_due: { label: "payment late", tone: "text-danger" },
  pending_payment: { label: "payment pending", tone: "text-[#b45309] dark:text-[#ffc65c]" },
  none: { label: "no plan", tone: "text-muted" },
};

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const box = "flex flex-col gap-2 rounded-2xl border border-line p-3.5";
const heading = "text-xs font-bold tracking-[0.04em] text-muted";
const dl = "grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]";

function Plan({ a }: { a: AccountFacts }) {
  const status = a.planStatus ? PLAN_STATUS[a.planStatus] : null;
  return (
    <>
      <span className="font-semibold">{a.plan ?? "No plan"}</span>
      {status && <> · <span className={`font-semibold ${status.tone}`}>{status.label}{a.planStatus === "trial" && a.trialDaysLeft != null ? `, ${a.trialDaysLeft} days left` : ""}</span></>}
    </>
  );
}

/** The facts beside a chat: who it is, their account, this visit and their past chats. */
export function ChatAside({ detail, onOpenChat }: { detail: ConversationDetail; onOpenChat: (id: string) => void }) {
  const { visitor: v, account: a, visit } = detail;
  const name = v.name ?? detail.visitorName;
  const seconds = visit ? Math.max(0, (Date.parse(visit.lastSeenAt) - Date.parse(visit.startedAt)) / 1000) : 0;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[#f1e4ff] text-[15px] font-bold text-[#5b3fd9] dark:bg-[#7b5cff]/25 dark:text-[#d6ccff]">{initials(name)}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-bold">{name}</span>
          {v.email && <span className="truncate text-[13px] text-muted">{v.email}</span>}
          {v.phone && <span className="text-[13px] text-muted">{v.phone}</span>}
          {!v.signedIn && !v.email && <span className="text-[13px] text-muted">Not signed in</span>}
        </span>
      </div>
      {a && (
        <section aria-label="Account" className={box}>
          <h2 className={heading}>ACCOUNT</h2>
          <dl className={dl}>
            {a.businessName && <><dt className="text-muted">Business</dt><dd className="font-semibold">{a.businessName}</dd></>}
            <dt className="text-muted">Plan</dt><dd><Plan a={a} /></dd>
            {a.businessInfoPercent != null && <><dt className="text-muted">Business info</dt><dd>{a.businessInfoPercent}%</dd></>}
            {a.channels.length > 0 && (
              <>
                <dt className="text-muted">Channels</dt>
                <dd>{a.channels.map((c, i) => <span key={c.platform}>{i > 0 && " · "}{c.ok ? `${c.platform} OK` : <span className="font-semibold text-danger">{c.platform} expired</span>}</span>)}</dd>
              </>
            )}
            {a.failedPostsThisWeek != null && <><dt className="text-muted">Failed posts</dt><dd>{a.failedPostsThisWeek} this week</dd></>}
          </dl>
          {a.adminHref && <a href={a.adminHref} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-ok underline-offset-2 hover:underline">Open in Admin</a>}
        </section>
      )}
      {visit && (
        <section aria-label="This visit" className={box}>
          <h2 className={heading}>THIS VISIT</h2>
          <dl className={dl}>
            {(visit.city || visit.country) && <><dt className="text-muted">Where</dt><dd>{[visit.city, visit.country].filter(Boolean).join(", ")} (about)</dd></>}
            {visit.ip && <><dt className="text-muted">IP</dt><dd>{visit.ip}</dd></>}
            {(visit.device || visit.browser) && <><dt className="text-muted">Device</dt><dd>{[visit.device, visit.browser].filter(Boolean).join(" · ")}</dd></>}
            <dt className="text-muted">Came from</dt><dd>{visit.referrer ?? "direct"}</dd>
            <dt className="text-muted">On site</dt><dd>{minutesOnSite(seconds)} · {ordinal(visit.visitCount)} visit</dd>
          </dl>
          {visit.pages.length > 0 && (
            <ol className="list-decimal pl-[18px] text-[13px] leading-[1.7]">
              {visit.pages.map((p, i) => {
                const now = i === visit.pages.length - 1 && p.path === visit.currentPath;
                return (
                  <li key={`${p.path}-${p.at}`} className="break-all">
                    {now ? <strong>{p.path}</strong> : p.path}
                    {now && <span className="text-success"> · now</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
      {detail.past.length > 0 && (
        <section aria-label="Past chats" className="flex flex-col gap-1.5">
          <h2 className={heading}>PAST CHATS</h2>
          {detail.past.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpenChat(p.id)} className="min-h-9 cursor-pointer text-left text-[13px] text-ok underline-offset-2 hover:underline">
              #{String(p.number).padStart(4, "0")} · {p.title} · {p.outcome}
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
