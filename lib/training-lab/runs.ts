// The agent team's run log (model AgentRun): what each member did, on which brain, at what cost, which Lab examples it
// read and what it made, so the Team page can show runs, cost and ratings and a rating on a result finds its runs.
// Recording never fails the work it describes.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { AGENTS, type AgentId, type Brain } from "./agents";

export type RunEntry = {
  agentId: AgentId;
  brain: Brain;
  model?: string | null;
  feature: string;
  businessId?: string | null;
  ok: boolean;
  ms?: number;
  costUsd?: number;
  exampleIds?: string[];
  /** What the run made, e.g. "reel:<ReelJob id>" or "design:<id>". */
  resultRef?: string | null;
  error?: string | null;
};

/** Saves one run. For members that do not go through runText (rules members, the painter, the filmmaker). Null if it could not be saved. */
export async function recordRun(entry: RunEntry): Promise<string | null> {
  try {
    const row = await prisma.agentRun.create({
      data: {
        agentId: entry.agentId,
        brain: entry.brain,
        model: entry.model ?? null,
        feature: entry.feature,
        businessId: entry.businessId ?? null,
        ok: entry.ok,
        ms: Math.max(0, Math.round(entry.ms ?? 0)),
        costUsd: Math.max(0, entry.costUsd ?? 0),
        exampleIds: entry.exampleIds ?? [],
        resultRef: entry.resultRef ?? null,
        error: entry.error ? entry.error.slice(0, 500) : null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    await logError(error, { source: "training-lab.runs", level: "warn" });
    return null;
  }
}

/** Sets the owner's rating (1 to 5, or null to clear) on every run that made this result; returns how many. */
export async function rateResult(resultRef: string, rating: number | null): Promise<number> {
  if (!resultRef || (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5))) return 0;
  const done = await prisma.agentRun.updateMany({ where: { resultRef }, data: { rating } });
  return done.count;
}

export const SUMMARY_DAYS = 30;
const SUMMARY_ROWS = 5000;

export type RunView = { id: string; brain: Brain; model: string | null; feature: string; ok: boolean; ms: number; costUsd: number; resultRef: string | null; rating: number | null; error: string | null; createdAt: Date };
export type AgentSummary = { agentId: AgentId; runs: number; okRate: number | null; costUsd: number; avgRating: number | null; rated: number; last: RunView[] };

/** Per member, over the last 30 days: runs, share that worked, cost, average rating and the last 5 runs. */
export async function teamSummary(now: Date = new Date()): Promise<AgentSummary[]> {
  const rows = await prisma.agentRun.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - SUMMARY_DAYS * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: SUMMARY_ROWS,
  });
  return AGENTS.map((agent) => {
    const mine = rows.filter((r) => r.agentId === agent.id);
    const rated = mine.filter((r) => r.rating !== null).map((r) => r.rating as number);
    return {
      agentId: agent.id,
      runs: mine.length,
      okRate: mine.length ? mine.filter((r) => r.ok).length / mine.length : null,
      costUsd: Math.round(mine.reduce((sum, r) => sum + Number(r.costUsd), 0) * 1e6) / 1e6,
      avgRating: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null,
      rated: rated.length,
      last: mine.slice(0, 5).map((r) => ({ id: r.id, brain: r.brain as Brain, model: r.model, feature: r.feature, ok: r.ok, ms: r.ms, costUsd: Number(r.costUsd), resultRef: r.resultRef, rating: r.rating, error: r.error, createdAt: r.createdAt })),
    };
  });
}
