export type UsageMetric = "text" | "image" | "videoSeconds" | "voiceCharacters" | "chat";
export const USAGE_METRICS: UsageMetric[] = ["text", "image", "videoSeconds", "voiceCharacters", "chat"];

/** A plan key (PlanDefinition.key): TRIAL, STANDARD, PRO, or any plan the admin creates. */
export type Plan = string;

/** The one plan that is the free trial. It cannot be deleted, retired or turned into a paid plan. */
export const TRIAL_PLAN_KEY = "TRIAL";

/** What a plan may unlock besides its usage limits. Checked through the plan, never with `plan === "PRO"`. */
export const CAPABILITIES = ["apiAccess", "ownComposio"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CAPABILITY_LABELS: Record<Capability, { label: string; hint: string }> = {
  apiAccess: { label: "API access", hint: "Public API keys and the API (switched off, not deleted, when the plan is lost)." },
  ownComposio: { label: "Own Composio account", hint: "Lets the client connect hundreds more apps with their own Composio account." },
};

export type PlanStatus = "active" | "hidden" | "retired";
export const PLAN_STATUSES: PlanStatus[] = ["active", "hidden", "retired"];

/** Usage limits per period, plus `seats` (users per company): a plain number checked by the team code, not a usage metric. */
export type PlanLimits = Record<UsageMetric, number> & { seats: number };
export const SEATS_MIN = 1;
export const SEATS_MAX = 1000;

export interface PlanConfig {
  name: string;
  description: string;
  isTrial: boolean;
  trialDays: number | null;
  sortOrder: number;
  highlight: boolean;
  priceUsdMonthly: number;
  priceUsdYearly: number;
  limits: PlanLimits; // per billing period (trial: whole trial)
  features: string[];
  capabilities: Record<Capability, boolean>;
}

export const TRIAL_DAYS = 7;

/**
 * The plans as they were when the plan builder was introduced (9 October 2026). They are the seed of the PlanDefinition
 * table (prisma/migrations/20261009095000_plan_builder) and the fallback when the database cannot be read; everything
 * else reads plans from the database (lib/plan-catalog.ts). Video and voice are Phase 2; their limits are placeholders
 * until then. "chat" counts AI replies of the website chat widget (Phase 6).
 */
export const SEED_PLANS: Record<string, PlanConfig> = {
  TRIAL: {
    name: "Free trial",
    description: "Try everything free. No card needed.",
    isTrial: true,
    trialDays: TRIAL_DAYS,
    sortOrder: 0,
    highlight: false,
    priceUsdMonthly: 0,
    priceUsdYearly: 0,
    limits: { text: 10, image: 5, videoSeconds: 0, voiceCharacters: 0, chat: 50, seats: 1 },
    features: [],
    capabilities: { apiAccess: false, ownComposio: false },
  },
  STANDARD: {
    name: "Standard",
    description: "For owners who want steady, on-brand content every week.",
    isTrial: false,
    trialDays: null,
    sortOrder: 10,
    highlight: false,
    priceUsdMonthly: 49,
    priceUsdYearly: 490,
    limits: { text: 100, image: 50, videoSeconds: 0, voiceCharacters: 0, chat: 1000, seats: 3 },
    features: ["100 AI text generations a month", "50 brand designs a month", "Post to 5 social networks", "Lead-capturing chat widget", "Content calendar and scheduling"],
    capabilities: { apiAccess: false, ownComposio: false },
  },
  PRO: {
    name: "Pro",
    description: "For busy businesses that post often and want every connection.",
    isTrial: false,
    trialDays: null,
    sortOrder: 20,
    highlight: true,
    priceUsdMonthly: 99,
    priceUsdYearly: 990,
    limits: { text: 300, image: 150, videoSeconds: 120, voiceCharacters: 20000, chat: 5000, seats: 10 },
    features: ["300 AI text generations a month", "150 brand designs a month", "Everything in Standard", "App connectors and API access", "Use your own Composio account", "Video and voiceover when released"],
    capabilities: { apiAccess: true, ownComposio: true },
  },
};

/** Kept for existing imports: the seed plans. Live values come from the database (lib/plan-catalog.ts). */
export const PLANS = SEED_PLANS;
