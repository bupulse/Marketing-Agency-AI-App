import type { Plan } from "@/lib/generated/prisma/client";

export type UsageMetric = "text" | "image" | "videoSeconds" | "voiceCharacters";

export interface PlanConfig {
  name: string;
  priceUsdMonthly: number;
  limits: Record<UsageMetric, number>; // per billing period (trial: whole trial)
}

export const TRIAL_DAYS = 7;

// Video and voice are Phase 2; their limits are placeholders until then.
export const PLANS: Record<Plan, PlanConfig> = {
  TRIAL: {
    name: "Free trial",
    priceUsdMonthly: 0,
    limits: { text: 10, image: 5, videoSeconds: 0, voiceCharacters: 0 },
  },
  STANDARD: {
    name: "Standard",
    priceUsdMonthly: 49,
    limits: { text: 100, image: 50, videoSeconds: 0, voiceCharacters: 0 },
  },
  PRO: {
    name: "Pro",
    priceUsdMonthly: 99,
    limits: { text: 300, image: 150, videoSeconds: 120, voiceCharacters: 20000 },
  },
};
