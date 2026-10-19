// "Pick your plan in 30 seconds" on /pricing (docs/bizdev/PLAN.md, docs/guide/features/23-pricing-page-and-plan-quiz.md).
// Pure: three answers and the visitor's region plans (lib/region-prices.ts) give one recommendation. Nothing here knows a
// price or a plan name: the cheapest plan of the region whose features and limits fit wins, so the quiz follows every
// change made in Admin -> Plans and Admin -> Regions and prices.
import type { FeatureKey } from "@/lib/features";
import type { PlanLimits } from "@/lib/plans";

export type QuizGoal = "posts" | "videos" | "replies" | "done_for_you";
export type QuizVolume = "few" | "some" | "daily";
export type QuizTeam = "solo" | "small" | "large";
export type QuizAnswers = { goal: QuizGoal; volume: QuizVolume; team: QuizTeam };

export type QuizOption<T extends string> = { value: T; label: string };
export type QuizQuestion<K extends keyof QuizAnswers> = { key: K; title: string; options: QuizOption<QuizAnswers[K]>[] };

export const QUIZ_QUESTIONS: [QuizQuestion<"goal">, QuizQuestion<"volume">, QuizQuestion<"team">] = [
  {
    key: "goal",
    title: "What do you want most?",
    options: [
      { value: "posts", label: "Good posts and designs, without spending hours" },
      { value: "videos", label: "Short videos and photos of my products for Reels and TikTok" },
      { value: "replies", label: "Answer customers fast and collect their numbers" },
      { value: "done_for_you", label: "Someone to do it all for me" },
    ],
  },
  {
    key: "volume",
    title: "How many posts a week?",
    options: [
      { value: "few", label: "1 to 3" },
      { value: "some", label: "4 to 7" },
      { value: "daily", label: "More than one a day" },
    ],
  },
  {
    key: "team",
    title: "Who will use BuPulse?",
    options: [
      { value: "solo", label: "Just me" },
      { value: "small", label: "2 or 3 people" },
      { value: "large", label: "4 or more" },
    ],
  },
];

/** Posts a month for each answer (a month is about 4.3 weeks; the top of each range, rounded). */
export const POSTS_A_MONTH: Record<QuizVolume, number> = { few: 12, some: 30, daily: 60 };
/** Users for each answer. */
export const USERS: Record<QuizTeam, number> = { solo: 1, small: 3, large: 4 };
/** Features each goal needs. Done for you is a service, not a plan, so it needs none here. */
export const GOAL_FEATURES: Record<QuizGoal, FeatureKey[]> = { posts: [], videos: ["video"], replies: ["websiteChat"], done_for_you: [] };

/** What the quiz reads of a plan: a RegionalPlan fits. */
export type QuizPlan = { key: string; name: string; isTrial: boolean; monthlyPriceCents: number; features: readonly FeatureKey[]; limits: Pick<PlanLimits, "text" | "image" | "seats"> };

export type QuizResult<P extends QuizPlan = QuizPlan> =
  | { kind: "plan"; plan: P; reasons: string[] }
  | { kind: "managed"; reasons: string[] }
  | { kind: "custom"; reasons: string[] };

const isAnswer = <T extends string>(options: readonly QuizOption<T>[], v: unknown): v is T => options.some((o) => o.value === v);

/** The answers, or null while one is missing or unknown (the form posts strings). */
export function parseAnswers(raw: Partial<Record<keyof QuizAnswers, unknown>>): QuizAnswers | null {
  const [goal, volume, team] = QUIZ_QUESTIONS;
  if (!isAnswer(goal.options, raw.goal) || !isAnswer(volume.options, raw.volume) || !isAnswer(team.options, raw.team)) return null;
  return { goal: raw.goal, volume: raw.volume, team: raw.team };
}

/**
 * The recommendation: "Someone to do it all" is Managed by BuPulse; otherwise the cheapest plan (monthly price, then
 * key) that has the goal's features, enough AI texts and designs for the posts (one of each per post) and enough users.
 * When no plan on sale fits, a custom plan.
 */
export function recommendPlan<P extends QuizPlan>(answers: QuizAnswers, plans: readonly P[]): QuizResult<P> {
  const posts = POSTS_A_MONTH[answers.volume];
  const users = USERS[answers.team];
  if (answers.goal === "done_for_you") {
    return { kind: "managed", reasons: ["The BuPulse team makes and publishes your posts with BuPulse, and you approve them.", "We agree what you need in a free demo."] };
  }
  const needs = GOAL_FEATURES[answers.goal];
  const fits = plans
    .filter((p) => !p.isTrial && needs.every((f) => p.features.includes(f)) && p.limits.text >= posts && p.limits.image >= posts && p.limits.seats >= users)
    .sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents || a.key.localeCompare(b.key));
  const plan = fits[0];
  if (!plan) {
    return { kind: "custom", reasons: [`No plan on sale has everything for ${posts} posts a month and ${users} ${users === 1 ? "user" : "users"}${needs.length ? " with what you want most" : ""}.`, "A custom plan has only what you need, at its own price."] };
  }
  const reasons = [`Up to ${plan.limits.text} AI texts and ${plan.limits.image} designs a month: enough for about ${posts} posts.`, `${plan.limits.seats} ${plan.limits.seats === 1 ? "user" : "users"}.`];
  if (needs.includes("video")) reasons.push("Short videos made from your product photos, with captions.");
  if (needs.includes("websiteChat")) reasons.push("A website chat that answers customers and saves their numbers for you.");
  return { kind: "plan", plan, reasons };
}

/** The quiz's pick, kept for /book-demo so the plan step starts on it (a functional cookie: a plan key, nothing else). */
export const PLAN_PICK_COOKIE = "bp-plan-pick";
export const PLAN_PICK_MAX_AGE = 30 * 24 * 60 * 60;
const PLAN_KEY = /^[A-Z][A-Z0-9_-]{1,39}$/;

/** A plan key from the cookie, or null when it is not one (a cookie can hold anything). */
export const pickedPlanKey = (v: string | null | undefined): string | null => (v && PLAN_KEY.test(v) ? v : null);
