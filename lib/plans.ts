import type { Plan } from "@/lib/generated/prisma/client";

export type UsageMetric = "text" | "image" | "videoSeconds" | "voiceCharacters" | "chat";

export interface PlanConfig {
  name: string;
  priceUsdMonthly: number;
  limits: Record<UsageMetric, number>; // per billing period (trial: whole trial)
}

export const TRIAL_DAYS = 7;

// Video and voice are Phase 2; their limits are placeholders until then. "chat" counts AI replies of
// the website chat widget (Phase 6).
export const PLANS: Record<Plan, PlanConfig> = {
  TRIAL: {
    name: "Free trial",
    priceUsdMonthly: 0,
    limits: { text: 10, image: 5, videoSeconds: 0, voiceCharacters: 0, chat: 50 },
  },
  STANDARD: {
    name: "Standard",
    priceUsdMonthly: 49,
    limits: { text: 100, image: 50, videoSeconds: 0, voiceCharacters: 0, chat: 1000 },
  },
  PRO: {
    name: "Pro",
    priceUsdMonthly: 99,
    limits: { text: 300, image: 150, videoSeconds: 120, voiceCharacters: 20000, chat: 5000 },
  },
};
