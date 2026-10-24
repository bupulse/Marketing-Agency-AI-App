import "server-only";
// Which Lab examples the team really used (docs/TRAINING_LAB.md): from the run log (AgentRun, runs.ts), the last 30 days,
// per example: how many runs read it, which members, when last, and how the owner rated those runs' work.
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { agentById } from "./agents";

export const USAGE_DAYS = 30;
const ROWS = 3000;

export type ExampleUse = { times: number; agents: string[]; last: Date; avgRating: number | null };
export type UsageRow = { agentId: string; exampleIds: string[]; rating: number | null; createdAt: Date };

/** Per example id, the use found in these runs. Pure. Members are named as in the registry, the most active first. */
export function usageFrom(rows: readonly UsageRow[], ids: readonly string[]): Map<string, ExampleUse> {
  const want = new Set(ids);
  type Acc = { times: number; by: Map<string, number>; last: Date; ratings: number[] };
  const acc = new Map<string, Acc>();
  for (const run of rows) {
    for (const id of new Set(run.exampleIds)) {
      if (!want.has(id)) continue;
      const a: Acc = acc.get(id) ?? { times: 0, by: new Map<string, number>(), last: run.createdAt, ratings: [] };
      a.times++;
      a.by.set(run.agentId, (a.by.get(run.agentId) ?? 0) + 1);
      if (run.createdAt > a.last) a.last = run.createdAt;
      if (run.rating !== null) a.ratings.push(run.rating);
      acc.set(id, a);
    }
  }
  const out = new Map<string, ExampleUse>();
  for (const [id, a] of acc) {
    const agents = [...a.by].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([agentId]) => agentById(agentId)?.name ?? agentId);
    out.set(id, { times: a.times, agents, last: a.last, avgRating: a.ratings.length ? Math.round((a.ratings.reduce((s, r) => s + r, 0) / a.ratings.length) * 10) / 10 : null });
  }
  return out;
}

/** One query for the whole page. An empty map on any error (the cards then say nothing is known). */
export async function exampleUsage(ids: string[], now: Date = new Date()): Promise<Map<string, ExampleUse>> {
  if (!ids.length) return new Map();
  try {
    const rows = await prisma.agentRun.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - USAGE_DAYS * 86_400_000) }, exampleIds: { hasSome: ids } },
      orderBy: { createdAt: "desc" },
      take: ROWS,
      select: { agentId: true, exampleIds: true, rating: true, createdAt: true },
    });
    return usageFrom(rows, ids);
  } catch (error) {
    await logError(error, { source: "training-lab.usage", level: "warn" });
    return new Map();
  }
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** "2 hours ago", "just now", "3 days ago". */
export function ago(date: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The card's line: "Used 7 times in the last 30 days, by the Script writer and the Designer (last: 2 hours ago; their work rated 4.5)". */
export function usageLine(use: ExampleUse | undefined, now: Date = new Date()): string {
  if (!use) return `Not used yet in the last ${USAGE_DAYS} days`;
  const times = use.times === 1 ? "once" : `${use.times} times`;
  const rated = use.avgRating === null ? "" : `; their work rated ${use.avgRating}`;
  return `Used ${times} in the last ${USAGE_DAYS} days, by ${list(use.agents)} (last: ${ago(use.last, now)}${rated})`;
}
