import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { AIProviderError } from "./types";

/** Monthly safety cap on BuPulse's own AI spend (AI_MONTHLY_BUDGET_USD, default $20). */
export function monthlyBudgetUsd(): number {
  const value = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 20);
  return Number.isFinite(value) && value > 0 ? value : 20;
}

export class AIBudgetExceededError extends AIProviderError {
  constructor(provider: string) {
    super("BuPulse's monthly AI budget has been reached", provider, false);
  }
}

/** What the cost ledger says was spent this calendar month (UTC). */
export async function spentThisMonthUsd(now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { _sum } = await prisma.aiCall.aggregate({ where: { createdAt: { gte: start } }, _sum: { costUsd: true } });
  return Number(_sum.costUsd ?? 0);
}

let alerted = "";

/**
 * Stops AI calls once the month's spend reaches the cap, so a bug or abuse can never run up a big
 * bill. Logs one alert per month per server instance (the admin console and Jarvis read ErrorLog).
 */
export async function assertWithinBudget(provider: string, now = new Date()): Promise<void> {
  const cap = monthlyBudgetUsd();
  const spent = await spentThisMonthUsd(now);
  if (spent < cap) return;
  const month = now.toISOString().slice(0, 7);
  if (alerted !== month) {
    alerted = month;
    await logError(new Error(`AI budget reached: $${spent.toFixed(2)} of $${cap} in ${month}; AI calls are paused`), {
      source: "ai.budget",
      level: "error",
    });
  }
  throw new AIBudgetExceededError(provider);
}
