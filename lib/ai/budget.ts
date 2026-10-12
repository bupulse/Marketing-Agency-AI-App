import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { AIProviderError } from "./types";

/** Monthly safety cap on BuPulse's own AI spend (AI_MONTHLY_BUDGET_USD, default $20). */
export function monthlyBudgetUsd(): number {
  const value = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 20);
  return Number.isFinite(value) && value > 0 ? value : 20;
}

export const BUDGET_SETTING_KEY = "ai.monthlyBudgetUsd";
export const BUDGET_MIN_USD = 1;
export const BUDGET_MAX_USD = 1000;
let budgetCache: { at: number; value: number } | null = null;

export function clearBudgetCache() {
  budgetCache = null;
}

/** The cap in force: the admin console's setting when there is one, otherwise AI_MONTHLY_BUDGET_USD (default $20). Cached 30 s. */
export async function effectiveBudgetUsd(): Promise<number> {
  if (budgetCache && Date.now() - budgetCache.at < 30_000) return budgetCache.value;
  let value = monthlyBudgetUsd();
  try {
    const row = await prisma.adminSetting.findUnique({ where: { key: BUDGET_SETTING_KEY } });
    const set = Number(row?.value);
    if (row && Number.isFinite(set) && set >= BUDGET_MIN_USD && set <= BUDGET_MAX_USD) value = set;
  } catch {
    if (budgetCache) return budgetCache.value; // keep the last good value through a database blip
  }
  budgetCache = { at: Date.now(), value };
  return value;
}

export class AIBudgetExceededError extends AIProviderError {
  constructor(provider: string) {
    super("BuPulse's monthly AI budget has been reached", provider, false);
  }
}

/** Per-company monthly cap on AI spend (AI_COMPANY_MONTHLY_USD, default $3), on top of the platform cap above. */
export function companyMonthlyBudgetUsd(): number {
  const value = Number(process.env.AI_COMPANY_MONTHLY_USD ?? 3);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

export const COMPANY_ALLOWANCE_MESSAGE = "Your monthly AI allowance is reached. It renews on the 1st of next month.";

/**
 * One company used its monthly AI allowance. A kind of AIBudgetExceededError, so every caller that pauses on the
 * platform cap pauses on this too; `message` is safe to show the owner.
 */
export class CompanyBudgetExceededError extends AIBudgetExceededError {
  constructor(provider: string) {
    super(provider);
    this.message = COMPANY_ALLOWANCE_MESSAGE;
  }
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** What one company's AI calls cost this calendar month (UTC), from the ledger. */
export async function companySpentThisMonthUsd(businessId: string, now = new Date()): Promise<number> {
  const { _sum } = await prisma.aiCall.aggregate({ where: { businessId, createdAt: { gte: monthStart(now) } }, _sum: { costUsd: true } });
  return Number(_sum.costUsd ?? 0);
}

/** Refuses an AI call for a company over its monthly allowance (before calling, and paying, the provider). */
export async function assertCompanyWithinBudget(businessId: string, provider: string, now = new Date()): Promise<void> {
  if ((await companySpentThisMonthUsd(businessId, now)) < companyMonthlyBudgetUsd()) return;
  throw new CompanyBudgetExceededError(provider);
}

/** What the cost ledger says was spent this calendar month (UTC). */
export async function spentThisMonthUsd(now = new Date()): Promise<number> {
  const { _sum } = await prisma.aiCall.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { costUsd: true } });
  return Number(_sum.costUsd ?? 0);
}

let alerted = "";

/**
 * Stops AI calls once the month's spend reaches the cap, so a bug or abuse can never run up a big
 * bill. Logs one alert per month per server instance (the admin console and Jarvis read ErrorLog).
 */
export async function assertWithinBudget(provider: string, now = new Date()): Promise<void> {
  const cap = await effectiveBudgetUsd();
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
