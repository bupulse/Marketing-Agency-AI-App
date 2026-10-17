// Learning from BuPulse's own results (docs/research/BRAIN.md, "Learning from our own results"): the videos clients post
// through BuPulse come back with their views, likes, comments, saves and shares, and the brain blends those with the
// research when it ranks hooks, formats and templates. Pure and browser-safe (the brain index re-exports it); the file
// store for the lab is outcomes-store.ts.
import { hookById, formatById } from "./database";
import { FORMATS, PLATFORMS, SECTORS, type Outcome, type OutcomeStats, type Platform, type SectorId } from "./types";

/** A hook (or format, or template) needs this many posted videos before its own results count at all. */
export const MIN_POSTS = 5;
/** Below this many posts, a candidate's results may reorder it but never push a research top-three one out of the top three. */
export const STRONG_POSTS = 20;
/** How much the research counts, in posts: a candidate's own results outweigh it once it has more than this many. */
export const PRIOR_POSTS = 10;
/** Weight of a post by whose it is: the business's own, the same sector, or another sector on the same platform. */
export const WEIGHTS = { own: 3, sector: 1, other: 0.5 } as const;

/** Every problem with an outcome row, in plain English; [] when it can be stored. */
export function checkOutcome(o: Outcome): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, what: string) => {
    if (!ok) problems.push(what);
  };
  need(typeof o.videoId === "string" && !!o.videoId, "videoId is missing");
  need(typeof o.businessId === "string" && !!o.businessId, "businessId is missing");
  need((SECTORS as readonly string[]).includes(o.sector), `sector "${o.sector}" is not a brain sector`);
  need((PLATFORMS as readonly string[]).includes(o.platform), `platform "${o.platform}" is not a brain platform`);
  need(o.formatId === null || (FORMATS as readonly string[]).includes(o.formatId), `format "${o.formatId}" is not a brain format`);
  need(o.hookId === null || !!hookById(o.hookId), `hook "${o.hookId}" is not a brain hook`);
  need(Number.isFinite(o.seconds) && o.seconds > 0, "seconds must be a positive number");
  need(!Number.isNaN(Date.parse(o.postedAt)), "postedAt is not a date");
  need(o.source === "bupulse", 'source must be "bupulse"');
  for (const [k, s] of [["stats24h", o.stats24h], ["stats7d", o.stats7d]] as const)
    if (s) for (const [f, v] of Object.entries(s)) need(v === null || (Number.isFinite(v) && v >= 0), `${k}.${f} must be a number of 0 or more, or null`);
  return problems;
}

/** The latest stats of a post (7 days, else 24 hours); null when nothing has been read yet. */
const latest = (o: Outcome): OutcomeStats | null => o.stats7d ?? o.stats24h ?? null;
const reachOf = (s: OutcomeStats) => s.views ?? s.reach ?? null;
/** Engagement per view: comments, saves and shares count more than a like. */
const engagementOf = (s: OutcomeStats) => {
  const seen = reachOf(s);
  const acts = (s.likes ?? 0) + 2 * (s.comments ?? 0) + 2 * (s.saves ?? 0) + 3 * (s.shares ?? 0);
  return seen ? acts / seen : null;
};
/** Where a value stands among others, 0 to 1 (ties count half). */
const percentile = (v: number, all: number[]) => (all.filter((x) => x < v).length + 0.5 * all.filter((x) => x === v).length) / all.length;

/**
 * How well each post did against the other BuPulse posts on the same platform, 0 to 1 (0.5 is the middle): the mean
 * of its views percentile and its engagement-per-view percentile. Posts without numbers yet are left out. Pure.
 */
export function performance(outcomes: Outcome[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const platform of PLATFORMS) {
    const posts = outcomes.filter((o) => o.platform === platform && latest(o));
    const views = posts.map((o) => reachOf(latest(o)!)).filter((v): v is number => v !== null);
    const rates = posts.map((o) => engagementOf(latest(o)!)).filter((v): v is number => v !== null);
    for (const o of posts) {
      const s = latest(o)!;
      const parts = [reachOf(s), engagementOf(s)].map((v, i) => (v === null ? null : percentile(v, i ? rates : views))).filter((v): v is number => v !== null);
      if (parts.length) out.set(o.videoId, parts.reduce((a, b) => a + b, 0) / parts.length);
    }
  }
  return out;
}

export type Candidate = { id: string; score: number };
export type CandidateKind = "hook" | "format" | "template";
export type RankedCandidate = Candidate & {
  /** Where the research alone would put it, 0 to 1 among these candidates. */
  research: number;
  /** Its own posts on this platform: how many, their weight, their mean performance; null when it has none. */
  results: { posts: number; weight: number; performance: number } | null;
  /** What it is ranked by: the research's expected performance moved towards its own results as they come in. */
  blended: number;
  why: string;
};

const keyOf: Record<CandidateKind, (o: Outcome) => string | null> = { hook: (o) => o.hookId, format: (o) => o.formatId, template: (o) => o.templateId };

/**
 * Re-ranks candidates (best research score first or in any order) by blending the research with BuPulse's own
 * results on this platform. The research gives each candidate an expected performance (0.4 for the weakest to 0.7 for
 * the strongest) worth PRIOR_POSTS posts; each post moves it towards what really happened, weighted by whose post it
 * is (the business's own 3, its sector 1, another sector 0.5). Candidates with fewer than MIN_POSTS posts keep their
 * research place, and one with fewer than STRONG_POSTS posts never pushes a research top-three candidate out of the
 * top three. Pure and deterministic.
 */
export function rankWithOutcomes(candidates: Candidate[], outcomes: Outcome[], ctx: { sector: SectorId; platform: Platform | "any"; businessId?: string | null; kind?: CandidateKind }): RankedCandidate[] {
  const kind = ctx.kind ?? "hook";
  const perf = performance(outcomes);
  const scores = candidates.map((c) => c.score);
  const [lo, hi] = [Math.min(...scores), Math.max(...scores)];
  const byResearch = [...candidates].sort((a, z) => z.score - a.score || a.id.localeCompare(z.id));
  const topThree = new Set(byResearch.slice(0, 3).map((c) => c.id));
  const ranked = candidates.map((c): RankedCandidate => {
    const research = hi > lo ? (c.score - lo) / (hi - lo) : 1;
    const prior = 0.4 + 0.3 * research;
    const mine = outcomes.filter((o) => keyOf[kind](o) === c.id && (ctx.platform === "any" || o.platform === ctx.platform) && perf.has(o.videoId));
    if (mine.length < MIN_POSTS) {
      return { ...c, research, results: mine.length ? { posts: mine.length, weight: 0, performance: mean(mine.map((o) => perf.get(o.videoId)!)) } : null, blended: prior, why: mine.length ? `${mine.length} posted videos: not enough yet (${MIN_POSTS} needed)` : "research only" };
    }
    const weightOf = (o: Outcome) => (ctx.businessId && o.businessId === ctx.businessId ? WEIGHTS.own : o.sector === ctx.sector ? WEIGHTS.sector : WEIGHTS.other);
    const weight = mine.reduce((s, o) => s + weightOf(o), 0);
    const sum = mine.reduce((s, o) => s + weightOf(o) * perf.get(o.videoId)!, 0);
    const p = sum / weight;
    const blended = (prior * PRIOR_POSTS + sum) / (PRIOR_POSTS + weight);
    return { ...c, research, results: { posts: mine.length, weight, performance: p }, blended, why: `${mine.length} posted videos, ${Math.round(p * 100)}th percentile on average` };
  });
  const order = [...ranked].sort((a, z) => z.blended - a.blended || z.score - a.score || a.id.localeCompare(z.id));
  // A small sample never pushes a research top-three candidate out of the top three.
  const top = order.slice(0, 3);
  for (const id of topThree) {
    if (top.some((c) => c.id === id)) continue;
    const weak = [...top].reverse().find((c) => !topThree.has(c.id) && (c.results?.posts ?? 0) < STRONG_POSTS);
    if (!weak) continue;
    top[top.indexOf(weak)] = order.find((c) => c.id === id)!;
  }
  top.sort((a, z) => z.blended - a.blended || z.score - a.score || a.id.localeCompare(z.id));
  return [...top, ...order.filter((c) => !top.includes(c))];
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The line for Claude's brief: what has worked for this business on this platform (5 or more of its posted videos with
 * numbers), else for its sector (10 or more); null when there is not enough. Names the best opening and format (3 or
 * more videos each) and the best length. Pure.
 */
export function outcomesLine(outcomes: Outcome[], ctx: { sector: SectorId; platform: Platform | "any"; businessId?: string | null }): string | null {
  const perf = performance(outcomes);
  const onPlatform = outcomes.filter((o) => (ctx.platform === "any" || o.platform === ctx.platform) && perf.has(o.videoId));
  const own = ctx.businessId ? onPlatform.filter((o) => o.businessId === ctx.businessId) : [];
  const sector = onPlatform.filter((o) => o.sector === ctx.sector);
  const [pool, who] = own.length >= MIN_POSTS ? [own, "you"] : sector.length >= 2 * MIN_POSTS ? [sector, "businesses like yours"] : [null, ""];
  if (!pool) return null;
  const best = (key: (o: Outcome) => string | null) => {
    const groups = new Map<string, number[]>();
    for (const o of pool) {
      const k = key(o);
      if (k) groups.set(k, [...(groups.get(k) ?? []), perf.get(o.videoId)!]);
    }
    const top = [...groups.entries()].filter(([, v]) => v.length >= 3).map(([k, v]) => ({ k, n: v.length, p: mean(v) })).sort((a, z) => z.p - a.p || a.k.localeCompare(z.k))[0];
    return top && top.p > 0.5 ? top : null;
  };
  const hook = best((o) => o.hookId);
  const format = best((o) => o.formatId);
  const length = best((o) => (o.seconds <= 10 ? "10 s or less" : o.seconds <= 20 ? "11 to 20 s" : "over 20 s"));
  const parts = [
    hook && `the "${hookById(hook.k)?.name ?? hook.k}" opening (${hook.n} videos)`,
    format && `${(formatById(format.k)?.name ?? format.k).toLowerCase()} videos (${format.n})`,
    length && `videos of ${length.k}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  const names: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", shorts: "YouTube Shorts" };
  const where = ctx.platform === "any" ? "" : ` on ${names[ctx.platform]}`;
  return `What has worked for ${who} (${pool.length} posted videos${where}): ${parts.join(", ")} did better than the rest. Lean on them where they fit this brief.`;
}
