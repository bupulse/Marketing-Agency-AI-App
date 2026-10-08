// Shared shapes of the analytics query layer (lib/analytics/queries.ts). Plain JSON, safe to return from REST/MCP.

/** Inclusive UTC calendar days, "YYYY-MM-DD". */
export type DateRange = { from: string; to: string };

/** Money is always USD cents (integers) unless a field says otherwise. */
export type Cents = number;

export const METRIC_KEYS = [
  "visits", "unique_visitors", "sessions", // dimension "" = total
  "top_page", "source", "utm_campaign", "country", "device", // dimension = the value, e.g. "/pricing", "google"
  "signups", "trial_starts", "paid_starts", "cancellations",
  "onboarding_step", // dimension = step name; value = users reaching it that day
  "dau", "wau", "mau",
  "mrr_cents", "active_subscriptions", "churn_rate", // churn_rate: % of subscribers at day start who cancelled that day
  "feature_use", // dimension = event name; value = distinct users that day
  "revenue_cents", "refunds_cents", "ai_cost_cents", "fixed_cost_cents", "profit_cents",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricPoint = { date: string; dimension: string; value: number };

export type Overview = {
  range: DateRange;
  visits: number;
  uniqueVisitors: number;
  sessions: number;
  signups: number;
  trialStarts: number;
  paidStarts: number;
  trialToPaidPct: number | null;
  mrrCents: Cents; // as of the end of the range
  activeSubscriptions: number;
  cancellations: number;
  churnPct: number | null;
  dau: number; // as of the last day in range
  wau: number;
  mau: number;
  revenueCents: Cents;
  costCents: Cents;
  profitCents: Cents;
  /** The same numbers for the equal-length period just before `range`. */
  previous: Pick<Overview, "visits" | "uniqueVisitors" | "signups" | "paidStarts" | "revenueCents" | "costCents" | "profitCents">;
};

export type FunnelStep = { key: string; label: string; count: number; fromPreviousPct: number | null; fromTopPct: number | null };
export type Funnel = { range: DateRange; steps: FunnelStep[] };

export type Revenue = {
  range: DateRange;
  grossCents: Cents;
  refundsCents: Cents;
  netCents: Cents;
  mrrCents: Cents;
  byPlan: { plan: string; interval: string; subscribers: number; mrrCents: Cents }[];
  byDay: { date: string; grossCents: Cents; refundsCents: Cents; netCents: Cents }[];
};

export type Costs = {
  range: DateRange;
  totalCents: Cents;
  aiCents: Cents;
  byCategory: { category: string; cents: Cents }[]; // "ai", plus the owner's MonthlyCost categories spread over the days
  byDay: { date: string; aiCents: Cents; fixedCents: Cents; totalCents: Cents }[];
};

export type Profit = {
  range: DateRange;
  revenueCents: Cents;
  costCents: Cents;
  profitCents: Cents;
  byDay: { date: string; revenueCents: Cents; costCents: Cents; profitCents: Cents }[];
  byMonth: { month: string; revenueCents: Cents; costCents: Cents; profitCents: Cents }[];
};

export type TopContent = {
  range: DateRange;
  byNetwork: { network: string; posts: number; avgEngagement: number; avgReach: number }[];
  byFormat: { format: string; posts: number; avgEngagement: number; avgReach: number }[];
  topPosts: { postId: string; businessId: string; network: string; format: string; reach: number; engagement: number; excerpt: string }[];
};

export type Ranked = { key: string; visits?: number; signups: number; paid: number; signupPct: number | null; paidPct: number | null };

export type WhatsWorking = {
  range: DateRange;
  industries: Ranked[]; // key = Business.industry; signups = businesses created; paid = of those now paying
  sources: Ranked[]; // visits -> signups -> paid, by traffic source
  landingPages: Ranked[]; // first page of the session that signed up
  contentFormats: TopContent["byFormat"];
  networks: TopContent["byNetwork"];
  featuresPaidVsChurned: { feature: string; paidUsers: number; churnedUsers: number; paidPct: number; churnedPct: number }[];
};

export type WeeklyReport = {
  range: DateRange;
  overview: Overview;
  funnel: Funnel;
  profit: Profit;
  whatsWorking: WhatsWorking;
  summary: string; // short plain-English paragraph
};
