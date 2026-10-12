import { BUILT_APP_FEATURE_KEYS, sortFeatureKeys, type FeatureKey } from "@/lib/features";

export type UsageMetric = "text" | "image" | "videoSeconds" | "voiceCharacters" | "chat";
export const USAGE_METRICS: UsageMetric[] = ["text", "image", "videoSeconds", "voiceCharacters", "chat"];

/** A plan key (PlanDefinition.key): TRIAL, STANDARD, PRO, or any plan the admin creates. */
export type Plan = string;

/** The one plan that is the free trial. It cannot be deleted, retired or turned into a paid plan. */
export const TRIAL_PLAN_KEY = "TRIAL";

/**
 * The two plan "capabilities" from before the feature registry (lib/features.ts). They are feature keys now; the
 * PlanDefinition.capabilities column is kept in step with the plan's features, and `capabilities` is still accepted
 * as an alias when a plan is edited (Jarvis). Checked through the plan's features, never with `plan === "PRO"`.
 */
export const CAPABILITIES = ["apiAccess", "ownComposio"] as const satisfies readonly FeatureKey[];
export type Capability = (typeof CAPABILITIES)[number];

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
  /** Marketing bullets on the pricing card. */
  highlights: string[];
  /** What the plan unlocks: keys of lib/features.ts, prerequisites included. */
  features: FeatureKey[];
}

export const TRIAL_DAYS = 7;

/**
 * Every built feature of the app except the API and videos: what the trial and Standard had before plans carried
 * features. Videos came later (docs/CONTENT_VISUALS.md) and come with video seconds, which only Pro has.
 */
export const CORE_FEATURES: FeatureKey[] = BUILT_APP_FEATURE_KEYS.filter((k) => k !== "apiAccess" && k !== "video");
/** Every built feature of the app plus the client's own Composio account: Pro. (Managed by BuPulse is sold apart.) */
export const PRO_FEATURES: FeatureKey[] = sortFeatureKeys([...BUILT_APP_FEATURE_KEYS, "ownComposio"]);

/**
 * The plans as they were when the plan builder was introduced (9 October 2026). They are the seed of the PlanDefinition
 * table (prisma/migrations/20261009095000_plan_builder) and the fallback when the database cannot be read; everything
 * else reads plans from the database (lib/plan-catalog.ts). Video and voice are Phase 2; their limits are placeholders
 * until then. "chat" counts AI replies of the website chat widget (Phase 6). The feature lists are what the migration
 * 20261009110000_plan_features backfilled, so nothing changed for existing companies.
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
    highlights: [],
    features: CORE_FEATURES,
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
    highlights: ["100 AI text generations a month", "50 brand designs a month", "Post to 5 social networks", "Lead-capturing chat widget", "Content calendar and scheduling"],
    features: CORE_FEATURES,
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
    highlights: ["300 AI text generations a month", "150 brand designs a month", "Everything in Standard", "App connectors and API access", "Use your own Composio account", "Video and voiceover when released"],
    features: PRO_FEATURES,
  },
};

/** Kept for existing imports: the seed plans. Live values come from the database (lib/plan-catalog.ts). */
export const PLANS = SEED_PLANS;
