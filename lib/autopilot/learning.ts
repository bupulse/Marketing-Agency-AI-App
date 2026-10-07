// Learning from the business's own results, plus the pluggable source of outside trends.
// Pure functions over plain rows (the database reads live in data.ts), so they are easy to test.
import type { Network } from "@/lib/social/types";
import type { Goal, Idea } from "./playbook";
import { localParts } from "./timezone";

/** One published post with its latest metrics snapshot. */
export interface PostResult {
  playbookId: string | null;
  network: string;
  publishedAt: Date;
  views?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  saves?: number | null;
  shares?: number | null;
}

/** Used when a network reports neither reach nor views, so a few likes do not look like a huge rate. */
const FALLBACK_AUDIENCE = 100;

/** (likes + comments x2 + saves x3 + shares x3) per person reached (or viewed). Capped at 1. */
export function engagementRate(m: Omit<PostResult, "playbookId" | "network" | "publishedAt">): number {
  const weighted = (m.likes ?? 0) + (m.comments ?? 0) * 2 + (m.saves ?? 0) * 3 + (m.shares ?? 0) * 3;
  const audience = (m.reach ?? 0) > 0 ? m.reach! : (m.views ?? 0) > 0 ? m.views! : FALLBACK_AUDIENCE;
  return Math.min(1, weighted / audience);
}

export interface LearningProfile {
  /** Shrunk mean engagement rate per playbook idea. */
  ideas: Map<string, number>;
  /** Mean engagement rate per network. */
  networks: Map<string, number>;
  /** Best local hours (0-23), best first, per network and overall under "all". */
  bestHours: Map<string, number[]>;
  /** Best weekdays (0 = Monday), best first, per network and overall under "all". */
  bestWeekdays: Map<string, number[]>;
  /** Mean rate over all posts. */
  mean: number;
  posts: number;
  /** Enough published posts with metrics to trust the scores. */
  confident: boolean;
}

/** Posts needed before learned scores steer the plan. */
export const MIN_POSTS_TO_LEARN = 6;
const SHRINK = 2; // pseudo-observations at the mean, so one lucky post does not decide
const MIN_BUCKET = 2; // posts needed in an hour or weekday before it counts

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function groupBy<T>(items: T[], key: (item: T) => string | number | null): Map<string | number, T[]> {
  const map = new Map<string | number, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

function best(rates: { key: number; rate: number }[][], top: number): number[] {
  const merged = new Map<number, number[]>();
  for (const group of rates) for (const { key, rate } of group) merged.set(key, [...(merged.get(key) ?? []), rate]);
  return [...merged.entries()]
    .filter(([, r]) => r.length >= MIN_BUCKET)
    .map(([key, r]) => ({ key, rate: mean(r) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, top)
    .map((x) => x.key);
}

export function buildProfile(results: PostResult[], timeZone: string): LearningProfile {
  const scored = results.map((r) => ({ ...r, rate: engagementRate(r) }));
  const overall = mean(scored.map((r) => r.rate));

  const ideas = new Map<string, number>();
  for (const [id, rows] of groupBy(scored, (r) => r.playbookId)) {
    const sum = rows.reduce((a, r) => a + r.rate, 0);
    ideas.set(String(id), (sum + SHRINK * overall) / (rows.length + SHRINK));
  }

  const networks = new Map<string, number>();
  for (const [n, rows] of groupBy(scored, (r) => r.network)) networks.set(String(n), mean(rows.map((r) => r.rate)));

  const bestHours = new Map<string, number[]>();
  const bestWeekdays = new Map<string, number[]>();
  const timed = scored.map((r) => {
    const p = localParts(r.publishedAt, timeZone);
    return { network: r.network, rate: r.rate, hour: p.hour, weekday: p.weekday };
  });
  const bucket = (rows: typeof timed, by: "hour" | "weekday") =>
    [...groupBy(rows, (r) => r[by]).entries()].map(([key, g]) => ({ key: Number(key), rate: mean(g.map((r) => r.rate)), n: g.length }));
  const expand = (rows: typeof timed, by: "hour" | "weekday") =>
    bucket(rows, by).flatMap(({ key, rate, n }) => Array.from({ length: n }, () => ({ key, rate })));
  bestHours.set("all", best([expand(timed, "hour")], 3));
  bestWeekdays.set("all", best([expand(timed, "weekday")], 3));
  for (const [n, rows] of groupBy(timed, (r) => r.network)) {
    bestHours.set(String(n), best([expand(rows, "hour")], 2));
    bestWeekdays.set(String(n), best([expand(rows, "weekday")], 3));
  }

  return {
    ideas,
    networks,
    bestHours,
    bestWeekdays,
    mean: overall,
    posts: results.length,
    confident: results.length >= MIN_POSTS_TO_LEARN,
  };
}

export const EMPTY_PROFILE: LearningProfile = buildProfile([], "UTC");

/** Sensible starting hours and weekdays (0 = Monday) per network, used until there is data. */
export const NETWORK_DEFAULTS: Record<Network, { hours: number[]; weekdays: number[] }> = {
  linkedin: { hours: [8, 12], weekdays: [1, 2, 3] },
  instagram: { hours: [12, 19], weekdays: [0, 2, 4, 5] },
  facebook: { hours: [13, 18], weekdays: [1, 2, 3, 5] },
  tiktok: { hours: [19, 21], weekdays: [1, 3, 4, 6] },
  youtube: { hours: [17, 18], weekdays: [4, 5, 6] },
};

/** Preferred weekdays for a network: learned when there is data, else the defaults. */
export function preferredWeekdays(profile: LearningProfile, network: Network): number[] {
  const learned = profile.confident ? (profile.bestWeekdays.get(network) ?? []) : [];
  return [...new Set([...learned, ...NETWORK_DEFAULTS[network].weekdays])];
}

/** Preferred hours for a network: learned (when confident) first, then the defaults. */
export function preferredHours(profile: LearningProfile, network: Network): number[] {
  const learned = profile.confident ? (profile.bestHours.get(network) ?? []) : [];
  return [...new Set([...learned, ...NETWORK_DEFAULTS[network].hours])];
}

// ---- Choosing ideas: exploit what works, explore the rest ----

/** Small seeded random generator (mulberry32), so a week's plan is repeatable. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick<T>(items: { item: T; weight: number }[], rng: () => number): T {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let r = rng() * total;
  for (const { item, weight } of items) {
    r -= weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1].item;
}

export const EXPLORE_RATE = 0.3;

export interface ChooseContext {
  profile: LearningProfile;
  rng: () => number;
  /** How often each idea was used in the last few weeks. */
  recent: Map<string, number>;
  /** Goals of the ideas already chosen this week. */
  chosenGoals: Goal[];
  explore?: number;
}

/**
 * Picks one idea. About 30% of the time (and always without enough data) it explores: any idea,
 * weighted by its default weight. Otherwise it exploits: one of the best-scoring ideas, still
 * weighted. Ideas used recently and goals already in this week's plan are down-weighted either way.
 */
export function chooseIdea(candidates: Idea[], ctx: ChooseContext): Idea {
  if (candidates.length === 0) throw new Error("No ideas to choose from");
  const base = (idea: Idea) => {
    const recentPenalty = 1 / (1 + (ctx.recent.get(idea.id) ?? 0) * 1.5);
    const goalPenalty = 0.5 ** ctx.chosenGoals.filter((g) => g === idea.goal).length;
    return Math.max(0.01, (idea.weight ?? 1) * recentPenalty * goalPenalty);
  };
  const exploring = !ctx.profile.confident || ctx.rng() < (ctx.explore ?? EXPLORE_RATE);
  if (exploring) return weightedPick(candidates.map((item) => ({ item, weight: base(item) })), ctx.rng);

  const learned = (idea: Idea) => ctx.profile.ideas.get(idea.id) ?? ctx.profile.mean;
  const ranked = [...candidates].sort((a, b) => learned(b) * base(b) - learned(a) * base(a));
  const top = ranked.slice(0, Math.max(2, Math.ceil(ranked.length * 0.4)));
  return weightedPick(top.map((item) => ({ item, weight: learned(item) * base(item) + 1e-6 })), ctx.rng);
}

// ---- Outside trends ----

export interface Trend {
  topic: string;
  hashtags: string[];
}

/** Where live trends plug in later (e.g. Instagram hashtag search). */
export interface TrendSource {
  readonly name: string;
  trends(input: { network: Network; country?: string | null; industry?: string | null }): Promise<Trend[]>;
}

export const noopTrendSource: TrendSource = {
  name: "none",
  async trends() {
    return [];
  },
};
