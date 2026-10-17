// Video Studio credits (docs/VIDEO_ENGINE.md, "Studio"): a credit price per video, like Seedance's and Higgsfield's,
// so the owner sees a price before pressing Generate. 1 credit = 10 RWF for the Rwanda launch (so 100 credits =
// 1,000 RWF, about $0.69): a credit price is the estimated provider cost with a margin, rounded to 5. The wallet is a
// local file for the lab; in the app it becomes plan allowances and add-ons (lib/usage.ts).
import fs from "node:fs/promises";
import path from "node:path";
import { SEEDANCE_USD_PER_SECOND, type SeedanceResolution, type SeedanceTier } from "@/lib/video-engine/seedance";

export const RWF_PER_CREDIT = 10;
export const USD_PER_RWF = 1 / 1450;
/** Margin over the estimated provider cost (Seedance clips; Claude designs are priced the same way). */
const MARGIN = 2.2;

const roundCredits = (usd: number) => Math.max(5, Math.round((usd * MARGIN) / USD_PER_RWF / RWF_PER_CREDIT / 5) * 5);

/** Credits for a Seedance clip: seconds x rate, with the margin, rounded to 5. */
export function seedanceCredits(tier: SeedanceTier, resolution: SeedanceResolution, seconds: number): number {
  return roundCredits(SEEDANCE_USD_PER_SECOND[tier][resolution] * seconds);
}

/** Credits for one Claude-designed video (about $0.10 on the API). */
export const CLAUDE_VIDEO_CREDITS = roundCredits(0.1);
/** Credits for one realistic presenter image (Gemini, about $0.04). */
export const PRESENTER_IMAGE_CREDITS = roundCredits(0.04);
/** Credits for one voice-over take (ElevenLabs, a 15 to 30 s script costs about $0.05 to $0.15). Cached takes are free. */
export const VOICE_OVER_CREDITS = 10;
/**
 * Credits for one Premium 3D clip (Claude designs a Blender scene, rendered on this Mac in minutes). Blender is free;
 * the price covers the design and the machine time. 120 until docs/BLENDER.md proposes a figure.
 */
export const PREMIUM_3D_CREDITS = 120;

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
