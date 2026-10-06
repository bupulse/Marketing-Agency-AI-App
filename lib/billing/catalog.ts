import type { BillingInterval, BillingProvider, Plan } from "@/lib/generated/prisma/client";

export type PaidPlan = Exclude<Plan, "TRIAL">;

/** Prices shown on the site and in the app. Yearly = 10 months (2 months free). */
export const PRICES: Record<PaidPlan, Record<BillingInterval, number>> = {
  STANDARD: { MONTH: 49, YEAR: 490 },
  PRO: { MONTH: 99, YEAR: 990 },
};

export const PAID_PLANS: PaidPlan[] = ["STANDARD", "PRO"];
export const INTERVALS: BillingInterval[] = ["MONTH", "YEAR"];

// Each provider's price ids come from the environment, e.g. PADDLE_PRICE_STANDARD_MONTH.
// (They differ between the sandbox and live accounts.) The admin panel will manage these later.
function envName(provider: BillingProvider, plan: PaidPlan, interval: BillingInterval) {
  return `${provider}_PRICE_${plan}_${interval}`;
}

export function priceIdFor(provider: BillingProvider, plan: PaidPlan, interval: BillingInterval): string | null {
  return process.env[envName(provider, plan, interval)] || null;
}

/** Which plan and interval a provider price id stands for, or null if it is not ours. */
export function planForPriceId(
  provider: BillingProvider,
  priceId: string,
): { plan: PaidPlan; interval: BillingInterval } | null {
  for (const plan of PAID_PLANS) {
    for (const interval of INTERVALS) {
      if (priceIdFor(provider, plan, interval) === priceId) return { plan, interval };
    }
  }
  return null;
}

export function isPaidPlan(value: unknown): value is PaidPlan {
  return value === "STANDARD" || value === "PRO";
}

export function isInterval(value: unknown): value is BillingInterval {
  return value === "MONTH" || value === "YEAR";
}
