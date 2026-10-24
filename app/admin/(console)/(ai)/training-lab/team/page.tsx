import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { Empty, Panel, notice } from "@/components/admin/ui";
import { Badge, Button } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { BRAIN_LABELS } from "@/lib/training-lab/agents";
import { SUMMARY_DAYS, teamSummary, type AgentSummary } from "@/lib/training-lab/runs";
import { LabTabs } from "../lab-tabs";
import { rateRunAction, setBrainAction } from "./actions";
import { resultLabels } from "@/lib/training-lab/from-result";
import { subscriptionUse, teamCards, type MemberCard } from "./data";

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
      <PageHeader title="Training Lab" description="BuPulse's studio team: each member does one job, learns from your Lab examples, and works on the brain you choose." />
      <LabTabs current="team" />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <p className={onSubscription.length ? notice.bad : "rounded-2xl bg-soft px-4 py-3 text-sm text-muted"}>
        The Claude subscription is for your own use on your Mac. Before anything goes to bupulse.com, move every member on it to the Anthropic key.
        {onSubscription.length > 0 && ` On it now: ${onSubscription.join(", ")}.`}
      </p>
      {subscription.prompter && <p className="rounded-2xl bg-soft px-4 py-3 text-sm text-muted">The image engine&apos;s Prompter uses your subscription when there is no Anthropic key, as it does here now.</p>}

      <ol className="flex min-w-0 flex-col gap-5">
        {cards.map((card, i) => (
          <li key={card.agent.id} id={`agent-${card.agent.id}`} className="min-w-0 scroll-mt-24">
            <MemberPanel card={card} step={i + 1} summary={byAgent.get(card.agent.id)} labels={labels} />
          </li>
        ))}
      </ol>
    </>
  );
}

function MemberPanel({ card, step, summary, labels }: { card: MemberCard; step: number; summary?: AgentSummary; labels: Map<string, string> }) {
  const { agent } = card;
  const single = card.options.length === 1;
  // Several brains but its engine does not ask the router yet: the brains are information, there is nothing to save.
  const unwired = !agent.wired && !single;
  return (
    <Panel title={`${step}. ${agent.name}`} description={agent.job} action={agent.paid ? <Badge tone="violet">Paid</Badge> : <Badge tone="success">Free</Badge>}>
      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 text-[14px] sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">Engine</dt>
        <dd className="min-w-0 break-words">{agent.engine}</dd>
        <dt className="text-muted">Lab examples</dt>
        <dd>{agent.reads.length === 0 ? "Reads none: it works from the business's own facts." : `${card.examples} it can read now`}</dd>
        <dt className="text-muted">Works on now</dt>
        <dd className="min-w-0 break-words">
          {unwired ? (
            <span className="font-semibold">{card.defaultNote ?? "As it always has"}</span>
          ) : card.defaultNote ? (
            <span className="font-semibold">{card.defaultNote}</span>
          ) : (
            <>
              {card.using ? <span className="font-semibold">{BRAIN_LABELS[card.using]}</span> : <span className="font-semibold text-danger">No brain is available here</span>}
              {card.using && card.using !== card.chosen && (
                <span className="block text-[13px] text-muted">
                  {card.saved ? `Your choice, ${BRAIN_LABELS[card.chosen]}, is not available here, so it works on ${BRAIN_LABELS[card.using]}.` : `Its default, ${BRAIN_LABELS[card.chosen]}, is not available here, so it works on ${BRAIN_LABELS[card.using]}.`}
                </span>
              )}
            </>
          )}
        </dd>
      </dl>

      {single ? (
        <p className="text-[13px] text-muted">It has one brain: {card.options[0].label}{card.options[0].note ? ` (${card.options[0].note})` : ""}.</p>
      ) : unwired ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[13px] font-medium text-muted">The brains it can use</p>
          <ul className="flex min-w-0 flex-col gap-1">
            {card.options.map((o) => (
              <li key={o.brain} className="min-w-0 px-2 py-1.5 text-[14px]">
                <BrainLine option={o} isDefault={o.brain === agent.defaultBrain} />
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted">{card.defaultNote ? "Not connected to the switch yet: its brain cannot be changed for now." : "Not connected to the switch yet: it works as it always has."}</p>
        </div>
      ) : (
        <form action={setBrainAction} className="flex min-w-0 flex-col gap-2">
          <input type="hidden" name="agentId" value={agent.id} />
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1 text-[13px] font-medium text-muted">Its brain</legend>
            {card.options.map((o) => (
              <label key={o.brain} className="flex min-h-11 min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-[14px] hover:bg-soft">
                <input type="radio" name="brain" value={o.brain} defaultChecked={o.brain === card.chosen} className="mt-0.5 size-5 shrink-0" />
                <BrainLine option={o} isDefault={o.brain === agent.defaultBrain} />
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="submit" size="sm" variant="outline">Save the brain</Button>
          </div>
        </form>
      )}

      <Runs summary={summary} agentId={agent.id} labels={labels} />
    </Panel>
  );
}

function BrainLine({ option: o, isDefault }: { option: MemberCard["options"][number]; isDefault: boolean }) {
  return (
    <span className="min-w-0">
      <span className="font-medium">{o.label}</span>
      {isDefault && <span className="text-muted"> (default)</span>}
      {o.paid ? <Badge tone="violet" className="ml-2">paid</Badge> : <Badge tone="success" className="ml-2">{o.brain === "rules" ? "free" : "no cost per call"}</Badge>}
      {o.note ? <span className="block text-[13px] text-danger">{o.note}</span> : <span className="block text-[13px] text-success">Available here</span>}
    </span>
  );
}

function Runs({ summary, agentId, labels }: { summary?: AgentSummary; agentId: string; labels: Map<string, string> }) {
  if (!summary || summary.runs === 0) return <Empty>No runs in the last {SUMMARY_DAYS} days.</Empty>;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 text-[14px] sm:grid-cols-4">
        <Stat label={`Runs (${SUMMARY_DAYS} days)`} value={String(summary.runs)} />
        <Stat label="Worked" value={percent(summary.okRate)} />
        <Stat label="Cost" value={usd(summary.costUsd)} />
        <Stat label="Rating" value={summary.avgRating === null ? "none yet" : `${summary.avgRating} of 5 (${summary.rated})`} />
      </dl>
      <div className="min-w-0">
        <p className="mb-1 text-[13px] font-medium text-muted">Last runs</p>
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
      </div>
    </div>
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
