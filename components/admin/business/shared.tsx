// Small pieces shared by the redesigned Clients and Sales pages (admin redesign, round 2). Server-safe.
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Mail, MessageCircle, Search } from "lucide-react";
import { FOCUS, type PillTone, type SearchParamsLike } from "@/components/admin/kit";
import { notice } from "@/components/admin/ui";
import { cn } from "@/lib/cn";

/** A subscription status in words and a pill tone, the same words everywhere in Clients and Sales. */
export const SUB_STATUS: Record<string, { label: string; tone: PillTone }> = {
  PENDING_DEMO: { label: "Waiting for demo", tone: "new" },
  TRIALING: { label: "On trial", tone: "info" },
  ACTIVE: { label: "Paying", tone: "good" },
  PAST_DUE: { label: "Payment late", tone: "bad" },
  CANCELED: { label: "Cancelled", tone: "muted" },
  EXPIRED: { label: "Expired", tone: "muted" },
};

export const subStatus = (s: string | null | undefined) => (s ? (SUB_STATUS[s] ?? { label: s.toLowerCase().replace(/_/g, " "), tone: "muted" as PillTone }) : null);

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The page's ?notice= and ?error= messages (left by server actions). */
export function Notices({ sp }: { sp: SearchParamsLike }) {
  const ok = first(sp.notice);
  const bad = first(sp.error);
  return (
    <>
      {ok && <p role="status" className={notice.ok}>{ok}</p>}
      {bad && <p role="alert" className={notice.bad}>{bad}</p>}
    </>
  );
}

/**
 * A plain search box (a GET form): the text field and a round search button. `keep` are the other filters, sent as
 * hidden fields so a search keeps the chosen chips.
 */
export function SearchBox({ q, placeholder, keep = {}, label = "Search", className }: { q: string; placeholder: string; keep?: Record<string, string | undefined>; label?: string; className?: string }) {
  return (
    <form role="search" className={cn("flex w-full max-w-xl items-center gap-2", className)}>
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="relative flex min-w-0 flex-1 items-center">
        <span className="sr-only">{label}</span>
        <Search aria-hidden className="pointer-events-none absolute left-4 size-4 text-muted" />
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder={placeholder}
          className="min-h-12 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-[15px] text-text placeholder:text-muted focus:border-pulse-blue focus:outline-none focus:ring-4 focus:ring-pulse-blue/20 dark:bg-white/[0.04]"
        />
      </label>
      <button type="submit" className={cn("inline-flex min-h-12 shrink-0 cursor-pointer items-center rounded-full bg-pulse-blue px-5 text-[14px] font-semibold text-white hover:bg-pulse-blue/90", FOCUS)}>
        Search
      </button>
    </form>
  );
}

/** "Next page" / "Older ..." as a calm pill link under a list. */
export function MoreLink({ href, children = "Next page" }: { href: string | null; children?: ReactNode }) {
  if (!href) return null;
  return (
    <Link href={href} className={cn("inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[14px] font-semibold text-text no-underline hover:border-pulse-blue/40 dark:bg-white/[0.03]", FOCUS)}>
      {children}
      <ArrowRight aria-hidden className="size-4" />
    </Link>
  );
}

/** A label and its value, for the small fact grids on cards. */
export function Fact({ label, children, wide }: { label: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2")}>
      <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-[14px]">{children}</dd>
    </div>
  );
}

/** One-tap WhatsApp and email circles (WhatsApp greyed out when there is no phone number). */
export function ContactCircles({ name, wa, mail }: { name: string; wa: string | null; mail: string | null }) {
  return (
    <span className="flex gap-1.5">
      {wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${name}`} className={cn("inline-flex size-11 items-center justify-center rounded-full bg-success-bg text-success transition-transform hover:-translate-y-px motion-reduce:transform-none", FOCUS)}>
          <MessageCircle aria-hidden className="size-4" />
        </a>
      ) : (
        <span title="No phone number on file" className="inline-flex size-11 items-center justify-center rounded-full bg-soft text-muted opacity-50" aria-hidden>
          <MessageCircle className="size-4" />
        </span>
      )}
      {mail && (
        <a href={mail} aria-label={`Email ${name}`} className={cn("inline-flex size-11 items-center justify-center rounded-full bg-ok-bg text-ok transition-transform hover:-translate-y-px motion-reduce:transform-none", FOCUS)}>
          <Mail aria-hidden className="size-4" />
        </a>
      )}
    </span>
  );
}

/** Days since an ISO date in words ("Today", "Yesterday", "5 days ago", "Never"). */
export function daysAgo(iso: string | null, now: number): string {
  if (!iso) return "Never";
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}
