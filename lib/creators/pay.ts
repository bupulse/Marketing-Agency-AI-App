// What creators earn in a campaign's pay period (docs/CREATOR_CAMPAIGNS.md, "Pay"). Pure: no database, no clock, so
// the company's dashboard (earned so far), the creator's portal, the period close and the tests all agree.
//
// The owner's rules (21 October 2026):
// - A campaign is split into 30-day periods, each with its own goals, paid at its end. Views count in the period they
//   happen: a post's views in a period are its reading at the period's end minus its reading at the period's start.
// - The company sets view targets: per creator and for the whole campaign (either can be empty). Views past a target do
//   not earn. When all creators together pass the campaign target, each creator's counted views are scaled down by the
//   same share, so nobody loses out for posting later in the period.
// - Pay rules, any mix: a rate per 1,000 counted views, milestones (a one-off amount when a post's views reach a
//   number), a fee per post handed in during the period, and caps (per post, per creator, and the period's budget).
// - Only posts that are being tracked earn. A removed or rejected post earns nothing; pay it earned in a period that
//   was already paid is taken off the creator's next payout (deductionsFor).
// Amounts are whole units of the campaign's currency, rounded down so the company never pays more than its rules say.

import { z } from "zod";

export const milestoneSchema = z.object({
  views: z.number().int().min(1).max(1_000_000_000),
  amount: z.number().int().min(1).max(1_000_000_000),
});

export const payRulesSchema = z.object({
  /** Paid for every 1,000 counted views. */
  ratePerThousand: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  /** One-off amounts when a post's total views reach a number (each paid once per post). */
  milestones: z.array(milestoneSchema).max(10).optional(),
  /** Paid for every tracked post handed in during the period. */
  feePerPost: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  /** Most one post earns in one period. */
  capPerPost: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  /** Most one creator earns in one period. */
  capPerCreator: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
});
export type PayRules = z.infer<typeof payRulesSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;

/** A campaign's pay rules as stored (Json): unreadable or empty rules pay nothing rather than failing the page. */
export function readPayRules(value: unknown): PayRules {
  const parsed = payRulesSchema.safeParse(value ?? {});
  if (!parsed.success) return {};
  const milestones = [...(parsed.data.milestones ?? [])].sort((a, b) => a.views - b.views);
  return { ...parsed.data, milestones };
}

/** True when the rules can pay anything at all (the campaign form refuses rules that cannot). */
export function paysAnything(rules: PayRules): boolean {
  return Boolean(rules.ratePerThousand || rules.feePerPost || rules.milestones?.length);
}

export type PeriodGoals = {
  viewTargetPerCreator?: number | null;
  viewTargetCampaign?: number | null;
  budget?: number | null;
};

/** The statuses of CreatorPost that earn. */
export const EARNING_STATUSES = ["TRACKING", "FINAL"] as const;

export type PostInput = {
  postId: string;
  /** CampaignCreator id. */
  creatorId: string;
  status: string;
  /** postedAt is inside the period: the fee per post is paid in that period only. */
  postedInPeriod: boolean;
  /** The post's views when the period started (0 when it was posted inside the period). */
  viewsAtStart: number;
  /** The post's views when the period ended, or now for an open period. */
  viewsAtEnd: number;
  /** Milestones (their `views`) this post was already paid for in earlier periods. */
  milestonesPaid?: number[];
};

export type PostPay = {
  postId: string;
  /** Views the post made in the period. */
  views: number;
  /** The part of them that earns, after the targets. */
  countedViews: number;
  rate: number;
  /** The milestones (their `views`) reached in this period. */
  milestones: number[];
  milestonePay: number;
  fee: number;
  /** What the post earned, after every cap. */
  amount: number;
};

export type CreatorPay = {
  creatorId: string;
  views: number;
  countedViews: number;
  /** Before the per-creator cap and the budget. */
  gross: number;
  amount: number;
  posts: PostPay[];
};

export type PeriodPay = {
  creators: CreatorPay[];
  views: number;
  countedViews: number;
  amount: number;
  /** Which limits cut the pay this period, for the "why" line on the dashboard. */
  limitsHit: ("creatorTarget" | "campaignTarget" | "capPerPost" | "capPerCreator" | "budget")[];
};

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/**
 * Splits `total` over `weights` in proportion, in whole numbers that add up to exactly `total` (largest remainder,
 * ties to the earlier entry). Weights of 0 get 0; all-zero weights give all zeros.
 */
export function splitWhole(total: number, weights: number[]): number[] {
  const t = whole(total);
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (t === 0 || sum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (Math.max(0, w) * t) / sum);
  const out = exact.map(Math.floor);
  let left = t - out.reduce((s, n) => s + n, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (weights[i] > 0) {
      out[i] += 1;
      left -= 1;
    }
  }
  return out;
}

/** Scales amounts down so they add up to at most `limit`, keeping their shares (rounded down, whole). */
function scaleTo(amounts: number[], limit: number): number[] {
  const sum = amounts.reduce((s, n) => s + n, 0);
  if (sum <= limit) return amounts;
  return splitWhole(limit, amounts);
}

/** What every creator earned in one period, with the reason for each number. */
export function computePeriodPay(rules: PayRules, goals: PeriodGoals, posts: PostInput[]): PeriodPay {
  const limitsHit = new Set<PeriodPay["limitsHit"][number]>();
  const milestones = [...(rules.milestones ?? [])].sort((a, b) => a.views - b.views);

  const byCreator = new Map<string, PostInput[]>();
  for (const p of posts) {
    const list = byCreator.get(p.creatorId) ?? [];
    list.push(p);
    byCreator.set(p.creatorId, list);
  }

  // 1. Views made in the period, and the part of them each creator's target lets earn.
  const creators = [...byCreator.entries()].map(([creatorId, list]) => {
    const earning = list.map((p) => (EARNING_STATUSES as readonly string[]).includes(p.status));
    const views = list.map((p, i) => (earning[i] ? Math.max(0, whole(p.viewsAtEnd) - whole(p.viewsAtStart)) : 0));
    const total = views.reduce((s, n) => s + n, 0);
    let counted = total;
    if (positive(goals.viewTargetPerCreator) && counted > goals.viewTargetPerCreator) {
      counted = goals.viewTargetPerCreator;
      limitsHit.add("creatorTarget");
    }
    return { creatorId, list, earning, views, total, counted };
  });

  // 2. The campaign target: every creator's counted views scaled by the same share.
  const countedSum = creators.reduce((s, c) => s + c.counted, 0);
  if (positive(goals.viewTargetCampaign) && countedSum > goals.viewTargetCampaign) {
    const scaled = splitWhole(goals.viewTargetCampaign, creators.map((c) => c.counted));
    creators.forEach((c, i) => (c.counted = scaled[i]));
    limitsHit.add("campaignTarget");
  }

  // 3. Each post's pay: its share of the counted views at the rate, its milestones and its fee, then the post cap.
  const paid = creators.map((c) => {
    const counted = splitWhole(c.counted, c.views);
    const postPays: PostPay[] = c.list.map((p, i) => {
      if (!c.earning[i]) return { postId: p.postId, views: 0, countedViews: 0, rate: 0, milestones: [], milestonePay: 0, fee: 0, amount: 0 };
      const rate = positive(rules.ratePerThousand) ? whole((counted[i] * rules.ratePerThousand) / 1000) : 0;
      const already = new Set(p.milestonesPaid ?? []);
      const reached = milestones.filter((m) => whole(p.viewsAtEnd) >= m.views && !already.has(m.views));
      const milestonePay = reached.reduce((s, m) => s + m.amount, 0);
      const fee = p.postedInPeriod && positive(rules.feePerPost) ? rules.feePerPost : 0;
      let amount = rate + milestonePay + fee;
      if (positive(rules.capPerPost) && amount > rules.capPerPost) {
        amount = rules.capPerPost;
        limitsHit.add("capPerPost");
      }
      return { postId: p.postId, views: c.views[i], countedViews: counted[i], rate, milestones: reached.map((m) => m.views), milestonePay, fee, amount };
    });
    const gross = postPays.reduce((s, p) => s + p.amount, 0);
    let amounts = postPays.map((p) => p.amount);
    if (positive(rules.capPerCreator) && gross > rules.capPerCreator) {
      amounts = scaleTo(amounts, rules.capPerCreator);
      limitsHit.add("capPerCreator");
    }
    postPays.forEach((p, i) => (p.amount = amounts[i]));
    return { creatorId: c.creatorId, views: c.total, countedViews: c.counted, gross, amount: amounts.reduce((s, n) => s + n, 0), posts: postPays };
  });

  // 4. The period's budget: every creator scaled by the same share, and each creator's posts with them.
  const total = paid.reduce((s, c) => s + c.amount, 0);
  if (positive(goals.budget) && total > goals.budget) {
    const scaled = splitWhole(goals.budget, paid.map((c) => c.amount));
    paid.forEach((c, i) => {
      const posts = splitWhole(scaled[i], c.posts.map((p) => p.amount));
      c.posts.forEach((p, j) => (p.amount = posts[j]));
      c.amount = scaled[i];
    });
    limitsHit.add("budget");
  }

  return {
    creators: paid,
    views: paid.reduce((s, c) => s + c.views, 0),
    countedViews: paid.reduce((s, c) => s + c.countedViews, 0),
    amount: paid.reduce((s, c) => s + c.amount, 0),
    limitsHit: [...limitsHit],
  };
}

/** What CreatorPayout.breakdown holds: the creator's line of the period, plus what was taken back. */
export type PayoutBreakdown = {
  views: number;
  countedViews: number;
  gross: number;
  earned: number;
  posts: PostPay[];
  /** Pay of posts removed or rejected after the period they earned in was paid, taken off this payout. */
  deducted: { postId: string; amount: number }[];
  /** Deductions this payout could not cover (it would go below 0): for the company to settle with the creator. */
  stillOwed: number;
};

/**
 * Pay to take back for posts that stopped earning (removed, rejected) after an earlier period paid them. `paid` is
 * each PAID payout's breakdown of the creator; `alreadyDeducted` the post ids taken back before (never twice).
 */
export function deductionsFor(stopped: Set<string>, paid: Pick<PayoutBreakdown, "posts">[], alreadyDeducted: Set<string>): { postId: string; amount: number }[] {
  const owed = new Map<string, number>();
  for (const b of paid) {
    for (const p of b.posts) {
      if (!stopped.has(p.postId) || alreadyDeducted.has(p.postId) || p.amount <= 0) continue;
      owed.set(p.postId, (owed.get(p.postId) ?? 0) + p.amount);
    }
  }
  return [...owed.entries()].map(([postId, amount]) => ({ postId, amount }));
}

/** A creator's payout for a closed period: earnings minus deductions, never below 0. */
export function payoutFor(line: CreatorPay, deducted: { postId: string; amount: number }[]): { amount: number; deductions: number; breakdown: PayoutBreakdown } {
  const total = deducted.reduce((s, d) => s + d.amount, 0);
  const deductions = Math.min(total, line.amount);
  return {
    amount: line.amount - deductions,
    deductions,
    breakdown: { views: line.views, countedViews: line.countedViews, gross: line.gross, earned: line.amount, posts: line.posts, deducted, stillOwed: total - deductions },
  };
}

/**
 * A DUE payout after one of its posts stopped earning before it was paid: that post's pay drops to 0 (owner decision:
 * "lose that post"). Returns the new amount and breakdown, or null when the post earned nothing in it.
 */
export function withoutPost(b: PayoutBreakdown, postId: string): { amount: number; deductions: number; breakdown: PayoutBreakdown } | null {
  const post = b.posts.find((p) => p.postId === postId);
  if (!post || post.amount <= 0) return null;
  const posts = b.posts.map((p) => (p.postId === postId ? { ...p, amount: 0 } : p));
  const earned = b.earned - post.amount;
  const owedBack = b.deducted.reduce((s, d) => s + d.amount, 0);
  const deductions = Math.min(owedBack, earned);
  return { amount: earned - deductions, deductions, breakdown: { ...b, posts, earned, stillOwed: owedBack - deductions } };
}

/** The milestones a post was paid in earlier payouts (so a milestone is never paid twice). */
export function milestonesPaidFor(postId: string, earlier: Pick<PayoutBreakdown, "posts">[]): number[] {
  const out = new Set<number>();
  for (const b of earlier) for (const p of b.posts) if (p.postId === postId) for (const m of p.milestones) out.add(m);
  return [...out];
}
