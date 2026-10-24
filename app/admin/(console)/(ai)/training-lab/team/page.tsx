import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { notice } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { BRAIN_LABELS } from "@/lib/training-lab/agents";
import { SUMMARY_DAYS, teamSummary, type AgentSummary } from "@/lib/training-lab/runs";
import { LabTabs } from "../lab-tabs";
import { rateRunAction, setBrainAction } from "./actions";
import { resultLabels } from "@/lib/training-lab/from-result";
import { subscriptionUse, teamCards, type MemberCard as Card } from "./data";
import { AGENT_ICONS, Pipeline } from "./pipeline";
import { SHORT_BRAIN, costChip, learnsLine } from "./view";

export const metadata = { title: "Training Lab team" };
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(4)}`;
const percent = (n: number | null) => (n === null ? "none yet" : `${Math.round(n * 100)}%`);

export default async function TrainingLabTeamPage({ searchParams }: PageProps<"/admin/training-lab/team">) {
  const me = await requirePermission("ai"); // pages render alongside the layout, so check here too
  // The owner from ADMIN_EMAILS only (lib/training-lab/examples.ts); anyone else does not see the page exists.
  if (!me.isOwner || me.staffId) notFound();
  const sp = await searchParams;
  const [cards, summary] = await Promise.all([teamCards(), teamSummary()]);
  const byAgent = new Map(summary.map((s) => [s.agentId, s]));
  const labels = await resultLabels(summary.flatMap((s) => s.last.map((r) => r.resultRef)));
  const subscription = subscriptionUse(cards);
  const onSubscription = subscription.members;

  return (
    <>
      <PageHeader title="Training Lab" description="Your studio team: each member does one job, learns from your Lab examples, and works on the brain you choose." />
      <LabTabs current="team" />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <p className={onSubscription.length ? notice.bad : "rounded-2xl bg-soft px-4 py-3 text-sm text-muted"}>
        Your Claude subscription is for you, on your Mac only. Before anything goes to bupulse.com, move the members using it to the Claude key.
        {onSubscription.length > 0 && ` Using it now: ${onSubscription.join(", ")}.`}
        {subscription.prompter && " The image engine's Prompter also uses it when there is no Claude key."}
      </p>

      <Pipeline />

      <ul className="grid min-w-0 gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <li key={card.agent.id} id={`agent-${card.agent.id}`} className="min-w-0 scroll-mt-24">
            <MemberCard card={card} summary={byAgent.get(card.agent.id)} labels={labels} />
          </li>
        ))}
      </ul>
    </>
  );
}

const CHIP = { Free: "bg-success-bg text-success", Paid: "bg-amber-100 text-amber-800" } as const;

function MemberCard({ card, summary, labels }: { card: Card; summary?: AgentSummary; labels: Map<string, string> }) {
  const { agent } = card;
  const Icon = AGENT_ICONS[agent.id];
  const cost = costChip(card);
  const single = card.options.length === 1;
  // Several brains but its engine does not ask the router yet: the brains are information, there is nothing to save.
  const unwired = !agent.wired && !single;
  const unavailable = card.options.filter((o) => o.note);
  return (
    <section aria-label={agent.name} className="flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-glow">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{agent.name}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${CHIP[cost]}`}>{cost}</span>
          </div>
          <p className="text-[14px] text-muted">{agent.job}</p>
          <p className="text-[13px] text-muted">{learnsLine(card)}</p>
        </div>
      </div>

      {unwired || card.defaultNote ? (
        <p className="text-[14px] font-medium">{card.defaultNote ?? "Works as it always has."}</p>
      ) : card.using ? (
        card.using !== card.chosen && (
          <p className="text-[13px] text-muted">
            {card.saved ? `Your choice, ${BRAIN_LABELS[card.chosen]}, is not available here, so it works on ${BRAIN_LABELS[card.using]}.` : `Its default, ${BRAIN_LABELS[card.chosen]}, is not available here, so it works on ${BRAIN_LABELS[card.using]}.`}
          </p>
        )
      ) : (
        <p className="text-[14px] font-semibold text-danger">No brain is available here.</p>
      )}

      {single ? (
        <p className="text-[13px] text-muted">One brain: {card.options[0].label}{card.options[0].note ? ` (${card.options[0].note})` : ""}.</p>
      ) : unwired ? (
        <p className="text-[13px] text-muted">
          It can use {card.options.map((o) => SHORT_BRAIN[o.brain]).join(", ")}. {card.defaultNote ? "Not connected to the switch yet, so its brain cannot be changed for now." : "Not connected to the switch yet, so it works as it always has."}
        </p>
      ) : (
        <form action={setBrainAction} className="flex min-w-0 flex-col gap-2">
          <input type="hidden" name="agentId" value={agent.id} />
          <div role="group" aria-label={`${agent.name}'s brain`} className="grid min-w-0 grid-cols-2 gap-1 rounded-2xl bg-soft p-1 sm:grid-cols-4">
            {card.options.map((o) => {
              const on = o.brain === card.chosen;
              return (
                <button
                  key={o.brain}
                  type="submit"
                  name="brain"
                  value={o.brain}
                  aria-pressed={on}
                  title={o.note ?? (o.brain === agent.defaultBrain ? "Default" : undefined)}
                  className={`min-h-11 min-w-0 rounded-xl px-2 text-[13px] font-medium ${on ? "bg-surface text-text shadow-glass" : "text-muted hover:bg-surface/60"} ${o.note ? "opacity-50" : ""}`}
                >
                  {SHORT_BRAIN[o.brain]}
                </button>
              );
            })}
          </div>
          {unavailable.map((o) => (
            <p key={o.brain} className="text-[12px] text-muted">{SHORT_BRAIN[o.brain]} is greyed out: {o.note!.charAt(0).toLowerCase()}{o.note!.slice(1)}.</p>
          ))}
        </form>
      )}

      <Stats summary={summary} />
      <Recent summary={summary} agentId={agent.id} labels={labels} />
    </section>
  );
}

function Stats({ summary }: { summary?: AgentSummary }) {
  const has = !!summary && summary.runs > 0;
  return (
    <dl className="grid grid-cols-3 gap-2 text-[14px]">
      <Stat label={`Runs, ${SUMMARY_DAYS} days`} value={has ? String(summary.runs) : "0"} />
      <Stat label="Worked" value={has ? percent(summary.okRate) : "none yet"} />
      <Stat label="Cost" value={has ? usd(summary.costUsd) : "$0"} />
    </dl>
  );
}

/** The last runs and the stars on their work, folded away until opened. */
function Recent({ summary, agentId, labels }: { summary?: AgentSummary; agentId: string; labels: Map<string, string> }) {
  if (!summary || summary.runs === 0) return <p className="text-[13px] text-muted">No work in the last {SUMMARY_DAYS} days.</p>;
  return (
    <details className="min-w-0">
      <summary className="min-h-11 cursor-pointer py-2.5 text-[14px] font-medium">Recent work{summary.avgRating !== null ? ` · rated ${summary.avgRating} of 5 (${summary.rated})` : ""}</summary>
      <ul className="flex min-w-0 flex-col divide-y divide-line">
        {summary.last.map((r) => (
          <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
            {r.ok ? <Badge tone="success">ok</Badge> : <Badge tone="danger">error</Badge>}
            <span className="font-medium">{BRAIN_LABELS[r.brain] ?? r.brain}</span>
            <span className="text-muted">{dateTime(r.createdAt)}</span>
            <span className="tabular-nums text-muted">{usd(r.costUsd)}</span>
            {!r.resultRef && r.rating !== null && <span className="text-muted">{r.rating} of 5</span>}
            {!r.ok && r.error && <span className="block w-full break-words text-danger">{r.error.slice(0, 200)}</span>}
            {r.resultRef && labels.has(r.resultRef) && <RateResult agentId={agentId} resultRef={r.resultRef} label={labels.get(r.resultRef)!} rating={r.rating} />}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** What a run made, and 1-5 stars on it: the rating goes on every run that made it. */
function RateResult({ agentId, resultRef, label, rating }: { agentId: string; resultRef: string; label: string; rating: number | null }) {
  return (
    <form action={rateRunAction} className="flex w-full min-w-0 flex-wrap items-center gap-1">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="resultRef" value={resultRef} />
      <span className="mr-1 min-w-0 break-words text-muted">
        Made:{" "}
        {resultRef.startsWith("reel:") ? (
          <Link href={`/admin/training-lab/editor?reel=${encodeURIComponent(resultRef.slice(5))}`} className="font-medium text-pulse-blue underline">{label}</Link>
        ) : (
          label
        )}
      </span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="submit" name="rating" value={String(n)} aria-label={`Rate ${label} ${n} of 5`} aria-pressed={rating === n} className={`flex size-11 items-center justify-center rounded-full text-lg ${rating && n <= rating ? "text-amber-500" : "text-muted"} hover:bg-soft`}>
          {rating && n <= rating ? "★" : "☆"}
        </button>
      ))}
      {rating !== null && (
        <button type="submit" name="rating" value="" className="min-h-11 rounded-full px-3 text-[13px] text-muted underline hover:bg-soft">Clear</button>
      )}
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-soft px-3 py-2">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
