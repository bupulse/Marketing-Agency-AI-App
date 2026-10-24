import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { Empty, Panel, notice } from "@/components/admin/ui";
import { Badge, Button } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { BRAIN_LABELS } from "@/lib/training-lab/agents";
import { SUMMARY_DAYS, teamSummary, type AgentSummary } from "@/lib/training-lab/runs";
import { LabTabs } from "../lab-tabs";
import { setBrainAction } from "./actions";
import { teamCards, type MemberCard } from "./data";

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
  const onSubscription = cards.filter((c) => c.chosen === "claude-subscription" || c.using === "claude-subscription").map((c) => c.agent.name);

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

      <ol className="flex min-w-0 flex-col gap-5">
        {cards.map((card, i) => (
          <li key={card.agent.id} id={`agent-${card.agent.id}`} className="min-w-0 scroll-mt-24">
            <MemberPanel card={card} step={i + 1} summary={byAgent.get(card.agent.id)} />
          </li>
        ))}
      </ol>
    </>
  );
}

function MemberPanel({ card, step, summary }: { card: MemberCard; step: number; summary?: AgentSummary }) {
  const { agent } = card;
  const single = card.options.length === 1;
  return (
    <Panel title={`${step}. ${agent.name}`} description={agent.job} action={agent.paid ? <Badge tone="violet">Paid</Badge> : <Badge tone="success">Free</Badge>}>
      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 text-[14px] sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">Engine</dt>
        <dd className="min-w-0 break-words">{agent.engine}</dd>
        <dt className="text-muted">Lab examples</dt>
        <dd>{agent.reads.length === 0 ? "Reads none: it works from the business's own facts." : `${card.examples} it can read now`}</dd>
        <dt className="text-muted">Works on now</dt>
        <dd className="min-w-0 break-words">
          {card.using ? <span className="font-semibold">{BRAIN_LABELS[card.using]}</span> : <span className="font-semibold text-danger">No brain is available here</span>}
          {card.using && card.using !== card.chosen && <span className="block text-[13px] text-muted">Your choice, {BRAIN_LABELS[card.chosen]}, is not available here, so it falls back.</span>}
        </dd>
      </dl>

      {single ? (
        <p className="text-[13px] text-muted">It has one brain: {card.options[0].label}{card.options[0].note ? ` (${card.options[0].note})` : ""}.</p>
      ) : (
        <form action={setBrainAction} className="flex min-w-0 flex-col gap-2">
          <input type="hidden" name="agentId" value={agent.id} />
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1 text-[13px] font-medium text-muted">Its brain</legend>
            {card.options.map((o) => (
              <label key={o.brain} className="flex min-h-11 min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-[14px] hover:bg-soft">
                <input type="radio" name="brain" value={o.brain} defaultChecked={o.brain === card.chosen} className="mt-0.5 size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="font-medium">{o.label}</span>
                  {o.brain === agent.defaultBrain && <span className="text-muted"> (default)</span>}
                  {o.paid ? <Badge tone="violet" className="ml-2">paid</Badge> : <Badge tone="success" className="ml-2">{o.brain === "rules" ? "free" : "no cost per call"}</Badge>}
                  {o.note ? <span className="block text-[13px] text-danger">{o.note}</span> : <span className="block text-[13px] text-success">Available here</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="submit" size="sm" variant="outline">Save the brain</Button>
          </div>
        </form>
      )}

      <Runs summary={summary} />
    </Panel>
  );
}

function Runs({ summary }: { summary?: AgentSummary }) {
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
              {r.rating !== null && <span className="text-muted">{r.rating} of 5</span>}
              {!r.ok && r.error && <span className="block w-full break-words text-danger">{r.error.slice(0, 200)}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
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
