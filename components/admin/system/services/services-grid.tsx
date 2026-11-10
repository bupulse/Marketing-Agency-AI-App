import Link from "next/link";
import { ArrowRight, Bot, KeyRound, MessagesSquare, Plug, Server } from "lucide-react";
import { cn } from "@/lib/cn";
import { CARD, EmptyState, FilterChips, FOCUS, IconBadge, LIFT, PageHeader, SectionCard, SectionGrid, StatusPill, type SearchParamsLike } from "@/components/admin/kit";
import { Section, notice } from "@/components/admin/ui";
import { HashRedirect } from "../hash-redirect";
import { Notices } from "../notices";
import { FILTER_LABEL, HEALTH_PILL, SERVICE_FILTERS, ago, filterCounts, isBroken, serviceFilterOf, serviceTone, sortServices, type ServiceFilter, type ServiceHealth } from "./service-status";

export type ServiceCardData = {
  id: string;
  name: string;
  purpose: string;
  health: ServiceHealth;
  whenOff: string;
  lastCheck: { ok: boolean; checkedAt: string } | null;
};

export type ServicesExtras = {
  inbox: { ready: boolean };
  custom: { count: number; broken: number };
  robot: { label: string; tone: "good" | "bad" | "muted" };
};

/** One service: its state in words, its last test and what stops if it is off. The whole card opens its page. */
function ServiceCard({ s, now }: { s: ServiceCardData; now: Date }) {
  const pill = HEALTH_PILL[s.health];
  const broken = isBroken(s.health);
  return (
    <Link href={`/admin/services/${s.id}`} className={cn("group relative flex min-w-0 flex-col gap-3 overflow-hidden p-4 text-text no-underline sm:p-5", CARD, LIFT, FOCUS, broken && "border-danger/40")}>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-brand-gradient opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
      <div className="flex items-start gap-3">
        <IconBadge icon={Plug} tone={serviceTone(s.health)} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[16px] font-bold leading-snug tracking-[-0.01em]">{s.name}</span>
          <StatusPill tone={pill.tone} dot className="w-fit">
            {pill.label}
          </StatusPill>
        </div>
        <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-soft text-muted transition-[transform,background-color,color] duration-200 group-hover:translate-x-0.5 group-hover:bg-pulse-blue group-hover:text-white motion-reduce:transform-none">
          <ArrowRight className="size-4" />
        </span>
      </div>
      <p className="line-clamp-2 text-[13px] leading-snug text-muted">{s.purpose}</p>
      <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3 text-[12.5px] leading-snug">
        <span>
          <span className="font-semibold">Last test:</span>{" "}
          {s.lastCheck ? <span className={s.lastCheck.ok ? "text-success" : "text-danger"}>{s.lastCheck.ok ? "passed" : "failed"}</span> : <span className="text-muted">never</span>}
          {s.lastCheck && <span className="text-muted"> · {ago(s.lastCheck.checkedAt, now)}</span>}
        </span>
        <span className="line-clamp-1 text-muted" title={s.whenOff}>
          <span className="font-semibold text-text">If off:</span> {s.whenOff}
        </span>
      </div>
    </Link>
  );
}

/** Admin -> Services: a card per outside service, filtered by state, plus the inbox route, custom keys and the video robot. */
export function ServicesGrid({ services, extras, filter, sp, unreadable, ok, bad, now = new Date() }: { services: ServiceCardData[]; extras: ServicesExtras; filter: ServiceFilter; sp: SearchParamsLike; unreadable: string[]; ok?: string; bad?: string; now?: Date }) {
  const counts = filterCounts(services);
  const shown = sortServices(services).filter((s) => !filter || serviceFilterOf(s.health) === filter);
  return (
    <>
      <HashRedirect routes={Object.fromEntries(services.map((s) => [`setup-${s.id}`, `/admin/services/${s.id}`]))} />
      <PageHeader icon={Server} tone="slate" title="Services" description="Every outside service BuPulse relies on. Tap one to add its key, test it or switch it off. Keys are saved encrypted and work within 30 seconds, no redeploy." />
      <Notices ok={ok} bad={bad} />
      {unreadable.length > 0 && (
        <p role="alert" className={notice.bad}>
          Some saved keys could not be read, so they are not in use: {unreadable.join(", ")}. This happens when ENCRYPTION_KEY changes. Save them again on their service.
        </p>
      )}
      <FilterChips
        label="Show services"
        param="show"
        base="/admin/services"
        params={sp}
        current={filter}
        options={SERVICE_FILTERS.filter((f) => f === "" || counts[f] > 0 || f === filter).map((f) => ({ value: f, label: FILTER_LABEL[f], count: counts[f] }))}
      />
      {shown.length === 0 ? (
        <EmptyState tone={filter === "attention" ? "good" : "calm"} title={filter === "attention" ? "Nothing needs you." : "No service here."} hint={filter === "attention" ? "No service is down, missing a key or switched off." : "Pick another filter above."} />
      ) : (
        <div className="kit-rise grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => (
            <ServiceCard key={s.id} s={s} now={now} />
          ))}
        </div>
      )}
      <Section title="More" description="How Instagram and Facebook replies travel, keys for anything else, and the video robot.">
        <SectionGrid>
          <SectionCard row href="/admin/services/inbox" icon={MessagesSquare} tone="slate" title="Instagram and Facebook replies" hint="How clients' comments and DMs reach their inbox, and the Composio budget." value={extras.inbox.ready ? "Working" : "Not set up"} count={extras.inbox.ready ? undefined : 1} countLabel="Replies are not set up" />
          <SectionCard row href="/admin/services/custom-keys" icon={KeyRound} tone="slate" title="Custom keys" hint="Keys for any other service, for example an AI model to try." value={String(extras.custom.count)} valueLabel={extras.custom.count === 1 ? "key saved" : "keys saved"} count={extras.custom.broken || undefined} countLabel={`${extras.custom.broken} custom keys not in use`} />
          <SectionCard row href="/admin/services/video-robot" icon={Bot} tone="slate" title="Video robot" hint="Makes content videos by itself every 15 minutes." value={extras.robot.label} count={extras.robot.tone === "bad" ? 1 : undefined} countLabel="The last robot run failed" />
        </SectionGrid>
      </Section>
    </>
  );
}
