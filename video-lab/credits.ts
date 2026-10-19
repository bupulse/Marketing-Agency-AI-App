// Video Studio credits (docs/VIDEO_ENGINE.md, "Studio"): a credit price per video, like Seedance's and Higgsfield's,
// so the owner sees a price before pressing Generate. 1 credit = 10 RWF for the Rwanda launch (so 100 credits =
// 1,000 RWF, about $0.69): a credit price is the estimated provider cost with a margin, rounded to 5. The wallet is a
// local file for the owner's tests; a client's credits are their plan's `videoCredits` (lib/usage.ts, the same balance
// BuPulse shows in Usage and Billing and sells top-ups of), taken from the company owner's account.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import type { StudioIdentity } from "./session";

// The prices live in lib/video-engine/credits.ts (shared with the app); the lab keeps only its wallet.
export { CLAUDE_VIDEO_CREDITS, PREMIUM_3D_CREDITS, PREMIUM_RERENDER_CREDITS, PRESENTER_IMAGE_CREDITS, RWF_PER_CREDIT, USD_PER_RWF, VOICE_OVER_CREDITS, isPremiumQuality, seedanceCredits, type PremiumQuality } from "@/lib/video-engine/credits";

const WALLET = path.resolve("video-lab/data/wallet.json");
const START_CREDITS = Number(process.env.VIDEO_LAB_START_CREDITS) || 5000;

export type Wallet = { balance: number; spent: number; history: { at: string; delta: number; note: string; jobId?: string }[] };

export async function readWallet(): Promise<Wallet> {
  try {
    return JSON.parse(await fs.readFile(WALLET, "utf8")) as Wallet;
  } catch {
    return { balance: START_CREDITS, spent: 0, history: [{ at: new Date().toISOString(), delta: START_CREDITS, note: "Lab starting credits" }] };
  }
}

async function write(w: Wallet): Promise<void> {
  await fs.mkdir(path.dirname(WALLET), { recursive: true });
  await fs.writeFile(WALLET, JSON.stringify({ ...w, history: w.history.slice(-500) }, null, 2));
}

/**
 * Who is paying: a client's request runs with their session's identity (set once per request by the server, and found
 * again here); the owner's requests have none and use the local test wallet.
 */
const requestIdentity = new AsyncLocalStorage<StudioIdentity | null>();
export const enterRequest = (identity: StudioIdentity | null) => requestIdentity.enterWith(identity);

/** What a charge was taken from, kept on the job so a refund (also from a background poll) goes back to the same place. null: the test wallet. */
export type Payer = { userId: string; periodStart: string } | null;

const BLOCKED: Record<string, string> = {
  no_subscription: "there is no active plan",
  pending_demo: "the account is waiting for its demo to start",
  trial_expired: "the free trial has ended",
  inactive: "the plan is not active",
  past_due: "the last payment did not go through",
};

/** Credits left in the plan's current month (limit minus used), for a company. */
export async function creditsLeft(companyUserId: string): Promise<{ left: number; used: number } | { blocked: string }> {
  const { getUsageSummary, UsageLimitError } = await import("@/lib/usage");
  const { periodState } = await import("@/lib/billing/period");
  try {
    const u = await getUsageSummary(companyUserId);
    // The same checks as consumeUsage (lib/usage.ts), so the balance never shows credits that cannot be spent.
    const sub = u.subscription;
    if (sub.user?.suspendedAt || (sub.status !== "TRIALING" && sub.status !== "ACTIVE" && sub.status !== "PAST_DUE" && sub.status !== "PENDING_DEMO")) return { blocked: BLOCKED.inactive };
    if (sub.status === "PENDING_DEMO") return { blocked: BLOCKED.pending_demo };
    if (sub.status === "PAST_DUE") return { blocked: BLOCKED.past_due };
    const state = periodState(sub);
    if (state === "ended") return { blocked: sub.plan === "TRIAL" ? BLOCKED.trial_expired : BLOCKED.inactive };
    return { left: Math.max(0, u.limits.videoCredits - u.used.videoCredits), used: u.used.videoCredits };
  } catch (error) {
    if (error instanceof UsageLimitError) return { blocked: BLOCKED[error.reason] ?? "the plan cannot be used right now" };
    throw error;
  }
}

/** Takes credits before a generation; throws in plain English when there are not enough. Returns what to give back to. */
export async function charge(credits: number, note: string, jobId?: string): Promise<Payer> {
  const who = requestIdentity.getStore();
  if (who) {
    const { consumeUsage, UsageLimitError } = await import("@/lib/usage");
    try {
      const { periodStart } = await consumeUsage(who.companyUserId, "videoCredits", credits);
      return { userId: who.companyUserId, periodStart: periodStart.toISOString() };
    } catch (error) {
      if (!(error instanceof UsageLimitError)) throw error;
      if (error.reason === "limit_reached") {
        const left = await creditsLeft(who.companyUserId);
        throw new Error(`Not enough video credits: this needs ${credits} and you have ${"left" in left ? left.left : 0}. Buy more credits on BuPulse.`);
      }
      throw new Error(`Videos cannot be made right now: ${BLOCKED[error.reason] ?? "the plan cannot be used"}. Open BuPulse billing to fix it.`);
    }
  }
  const w = await readWallet();
  if (w.balance < credits) throw new Error(`Not enough credits: this needs ${credits} and you have ${w.balance}. Top up in Pricing.`);
  w.balance -= credits;
  w.spent += credits;
  w.history.push({ at: new Date().toISOString(), delta: -credits, note, jobId });
  await write(w);
  return null;
}

/** Gives credits back (a failed generation, or a cancel before it ran) to where the charge came from. */
export async function refund(credits: number, note: string, jobId?: string, payer: Payer = null): Promise<void> {
  if (payer) {
    const { refundUsage } = await import("@/lib/usage");
    await refundUsage(payer.userId, "videoCredits", new Date(payer.periodStart), credits);
    return;
  }
  const w = await readWallet();
  w.balance += credits;
  w.spent = Math.max(0, w.spent - credits);
  w.history.push({ at: new Date().toISOString(), delta: credits, note, jobId });
  await write(w);
}

export async function topUp(credits: number, note: string): Promise<Wallet> {
  const w = await readWallet();
  w.balance += credits;
  w.history.push({ at: new Date().toISOString(), delta: credits, note });
  await write(w);
  return w;
}

/** The Rwanda credit packs shown on Pricing (lab values; the app's plans come from Admin -> Plans). */
export const CREDIT_PACKS = [
  { id: "starter", name: "Starter pack", credits: 1000, rwf: 10_000, blurb: "About 11 Seedance Fast clips (5 s, 480p), or 28 Claude 3D motion videos" },
  { id: "business", name: "Business pack", credits: 3500, rwf: 30_000, blurb: "Best for weekly posting", popular: true },
  { id: "studio", name: "Studio pack", credits: 7500, rwf: 60_000, blurb: "For agencies and busy shops" },
] as const;
