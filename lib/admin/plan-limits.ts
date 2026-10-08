import "server-only";
import { prisma } from "@/lib/db";
import { PLANS, type UsageMetric } from "@/lib/plans";
import type { Plan } from "@/lib/generated/prisma/client";

export const USAGE_METRICS: UsageMetric[] = ["text", "image", "videoSeconds", "voiceCharacters", "chat"];
const TTL_MS = 30_000;

type Overrides = Partial<Record<Plan, Partial<Record<UsageMetric, number>>>>;
// lastGood survives cache clears and database errors, so a blip never brings the default limits back.
let lastGood: Overrides | null = null;
let fetchedAt = 0;

/** Mark the cache stale (the writer calls this so its own isolate sees a change at once; others catch up within 30 s). */
export function clearPlanLimitCache() {
  fetchedAt = 0;
}

function clean(value: unknown): Partial<Record<UsageMetric, number>> {
  const out: Partial<Record<UsageMetric, number>> = {};
  if (value && typeof value === "object") {
    for (const m of USAGE_METRICS) {
      const v = (value as Record<string, unknown>)[m];
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[m] = v;
    }
  }
  return out;
}

export async function getLimitOverrides(opts: { force?: boolean; now?: number } = {}): Promise<Overrides> {
  const now = opts.now ?? Date.now();
  if (!opts.force && lastGood && now - fetchedAt < TTL_MS) return lastGood;
  try {
    const overrides: Overrides = {};
    for (const row of (await prisma.planLimitOverride.findMany()) ?? []) overrides[row.plan] = clean(row.limits);
    lastGood = overrides;
    fetchedAt = now;
    return overrides;
  } catch {
    // The database blinking must never stop generation or reset limits: keep the last good overrides (code defaults
    // only if there has never been a successful read), and try again on the next call.
    return lastGood ?? {};
  }
}

/** A plan's limits: lib/plans.ts with the admin's runtime overrides on top. */
export async function getPlanLimits(plan: Plan): Promise<Record<UsageMetric, number>> {
  const overrides = await getLimitOverrides();
  return { ...PLANS[plan].limits, ...(overrides[plan] ?? {}) };
}
