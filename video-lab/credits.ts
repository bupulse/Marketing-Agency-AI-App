// Video Studio credits (docs/VIDEO_ENGINE.md, "Studio"): a credit price per video, like Seedance's and Higgsfield's,
// so the owner sees a price before pressing Generate. 1 credit = 10 RWF for the Rwanda launch (so 100 credits =
// 1,000 RWF, about $0.69): a credit price is the estimated provider cost with a margin, rounded to 5. The wallet is a
// local file for the lab; in the app it becomes plan allowances and add-ons (lib/usage.ts).
import fs from "node:fs/promises";
import path from "node:path";

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

/** Takes credits before a generation; throws in plain English when there are not enough. */
export async function charge(credits: number, note: string, jobId?: string): Promise<Wallet> {
  const w = await readWallet();
  if (w.balance < credits) throw new Error(`Not enough credits: this needs ${credits} and you have ${w.balance}. Top up in Pricing.`);
  w.balance -= credits;
  w.spent += credits;
  w.history.push({ at: new Date().toISOString(), delta: -credits, note, jobId });
  await write(w);
  return w;
}

/** Gives credits back (a failed generation, or a cancel before it ran). */
export async function refund(credits: number, note: string, jobId?: string): Promise<Wallet> {
  const w = await readWallet();
  w.balance += credits;
  w.spent = Math.max(0, w.spent - credits);
  w.history.push({ at: new Date().toISOString(), delta: credits, note, jobId });
  await write(w);
  return w;
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
  { id: "starter", name: "Starter pack", credits: 1000, rwf: 10_000, blurb: "About 7 Seedance Fast clips at 480p, or 60 Claude videos" },
  { id: "business", name: "Business pack", credits: 3500, rwf: 30_000, blurb: "Best for weekly posting", popular: true },
  { id: "studio", name: "Studio pack", credits: 7500, rwf: 60_000, blurb: "For agencies and busy shops" },
] as const;
