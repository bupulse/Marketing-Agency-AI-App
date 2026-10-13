import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { resolvePrice } from "./pricing";
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

/** Default per-company monthly cap on AI spend (AI_COMPANY_MONTHLY_USD, default $3): plans without their own allowance. */
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

/** The ledger feature of website-chat replies (lib/widget/ai.ts). Visitors start these, not the owner. */
export const WIDGET_FEATURE = "widget";

/**
 * The share of a company's monthly allowance the website chat may use (WIDGET_AI_SHARE, default 0.5, between 0 and 1).
 * Visitors cannot use up what the owner's own features (Studio, Autopilot, designs...) need.
 */
export function widgetAiShare(): number {
  const raw = process.env.WIDGET_AI_SHARE;
  const value = raw === undefined || raw.trim() === "" ? 0.5 : Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

export const WIDGET_ALLOWANCE_MESSAGE = "The website chat's share of this month's AI allowance is used. Visitors can still leave their details.";

/** The website chat used its share of the company's allowance. The widget then only collects details (the contact form). */
export class WidgetBudgetExceededError extends CompanyBudgetExceededError {
  constructor(provider: string) {
    super(provider);
    this.message = WIDGET_ALLOWANCE_MESSAGE;
  }
}

/** AI images in one image pack (the `block:image` add-on, lib/offers/shared.ts). */
export const IMAGE_PACK_SIZE = 50;

/** What one AI image costs us (lib/ai/pricing.ts), for allowances that must cover a plan's images. */
export function imageUnitUsd(): number {
  const price = resolvePrice(process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image")?.price.perImage;
  return typeof price === "number" && price > 0 ? price : 0.039;
}

/** The dollars image packs add to the allowance, rounded up to whole dollars, so a paid pack is always usable. */
export function packAllowanceUsd(packs: number): number {
  return packs > 0 ? Math.ceil(packs * IMAGE_PACK_SIZE * imageUnitUsd()) : 0;
}

/** An allowance for a plan without one of its own (old custom plans): its AI images at cost x 1.5, plus $1 for text. */
export function derivedAllowanceUsd(imageLimit: number): number {
  return Math.ceil(Math.max(0, imageLimit) * imageUnitUsd() * 1.5 + 1);
}

/** Pure: a plan's own allowance when it has a sound one, else the default. */
export function allowanceFor(planUsd: number | null | undefined, fallback = companyMonthlyBudgetUsd()): number {
  return typeof planUsd === "number" && Number.isFinite(planUsd) && planUsd >= 0 ? planUsd : fallback;
}

const allowanceCache = new Map<string, { at: number; value: number }>();

/**
 * One company's monthly AI allowance: its plan's (PlanDefinition.aiMonthlyUsd: Starter and Standard $2, Business and
 * Pro $6, trial $1), else the code's seed plan, else AI_COMPANY_MONTHLY_USD. Cached 30 s per company.
 */
export async function companyAllowanceUsd(businessId: string, now = Date.now()): Promise<number> {
  const hit = allowanceCache.get(businessId);
  if (hit && now - hit.at < 30_000) return hit.value;
  let value = companyMonthlyBudgetUsd();
  try {
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { user: { select: { subscription: { select: { plan: true } } } } } });
    const key = business?.user?.subscription?.plan;
    if (key) {
      const row = await prisma.planDefinition.findUnique({ where: { key }, select: { aiMonthlyUsd: true, limits: true } });
      const { SEED_PLANS } = await import("@/lib/plans");
      const own = row?.aiMonthlyUsd ?? SEED_PLANS[key]?.aiMonthlyUsd;
      // A plan with no allowance of its own (a custom plan from before) gets one that covers its AI images.
      const images = Number((row?.limits as { image?: unknown } | null)?.image);
      value = allowanceFor(own ?? (row && Number.isFinite(images) ? derivedAllowanceUsd(images) : undefined));
    }
  } catch {
    // The default allowance while the plan cannot be read.
  }
  allowanceCache.set(businessId, { at: now, value });
  return value;
}

export function clearAllowanceCache() {
  allowanceCache.clear();
}

/** What one company's AI calls cost this calendar month (UTC), from the ledger. */
export async function companySpentThisMonthUsd(businessId: string, now = new Date()): Promise<number> {
  const { _sum } = await prisma.aiCall.aggregate({ where: { businessId, createdAt: { gte: monthStart(now) } }, _sum: { costUsd: true } });
  return Number(_sum.costUsd ?? 0);
}

export type CompanySpend = { totalUsd: number; widgetUsd: number; ownerUsd: number; allowanceUsd: number; widgetCapUsd: number };

/** One company's spend this month split into website chat (visitors) and everything the owner started. */
export async function companySpendThisMonth(businessId: string, now = new Date()): Promise<CompanySpend> {
  const since = monthStart(now);
  const [total, widget] = await Promise.all([
    prisma.aiCall.aggregate({ where: { businessId, createdAt: { gte: since } }, _sum: { costUsd: true } }),
    prisma.aiCall.aggregate({ where: { businessId, feature: WIDGET_FEATURE, createdAt: { gte: since } }, _sum: { costUsd: true } }),
  ]);
  const totalUsd = Number(total._sum.costUsd ?? 0);
  const widgetUsd = Math.min(totalUsd, Number(widget._sum.costUsd ?? 0));
  const allowanceUsd = await companyAllowanceUsd(businessId);
  return { totalUsd, widgetUsd, ownerUsd: totalUsd - widgetUsd, allowanceUsd, widgetCapUsd: allowanceUsd * widgetAiShare() };
}

/**
 * Pure: may this call go ahead? The website chat may spend at most its share (and never past the whole allowance);
 * the owner's features may spend the allowance minus what the chat used within its share, so the chat can never push
 * the owner below their own share (a chat call that ran over its share by a few cents does not count against the owner).
 */
export function companyCallAllowed(spend: CompanySpend, feature: string): boolean {
  if (feature === WIDGET_FEATURE) return spend.widgetUsd < spend.widgetCapUsd && spend.totalUsd < spend.allowanceUsd;
  return spend.ownerUsd < spend.allowanceUsd - Math.min(spend.widgetUsd, spend.widgetCapUsd);
}

/** Refuses an AI call for a company over its monthly allowance, or the website chat over its share (before calling, and paying, the provider). */
export async function assertCompanyWithinBudget(businessId: string, provider: string, now = new Date(), feature = ""): Promise<void> {
  if (companyCallAllowed(await companySpendThisMonth(businessId, now), feature)) return;
  throw feature === WIDGET_FEATURE ? new WidgetBudgetExceededError(provider) : new CompanyBudgetExceededError(provider);
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
