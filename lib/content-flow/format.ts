// Picture or video (docs/CONTENT.md, "Format: BuPulse decides"): when content is made ("Create today's content",
// content packs, Autopilot) BuPulse chooses each post's format per app and angle, so the owner never has to ask for
// videos. Owner rules (13 October 2026):
// - TikTok and YouTube Shorts: video (about 9 in 10 where the app also takes photo posts); a picture or a script to
//   film only when video is not in the plan or the plan's videos are used up, and the run says why;
// - Instagram: a mix, Reels about half the time, carousels for tips and lists, single pictures otherwise;
// - Facebook: video about a third of the time; LinkedIn: mostly pictures, carousels and articles, video about 1 in 5;
// - day to day variety: never the same format on the same app three days running (TikTok and YouTube excepted);
// - within the plan's videos and at most MAX_RUN_VIDEOS videos BuPulse makes per run.
// The owner can lean a run towards video or pictures ("Format" in the dialog). Pure: the RNG is passed in.
import { ANGLES, type AngleId, type PackFormat } from "@/lib/studio/angles";
import type { Network } from "@/lib/social/types";
import { NETWORK_STYLE } from "./networks";

export const FORMAT_PREFERENCES = ["auto", "video", "image"] as const;
export type FormatPreference = (typeof FORMAT_PREFERENCES)[number];
export const FORMAT_PREFERENCE_LABEL: Record<FormatPreference, string> = { auto: "Let BuPulse decide", video: "Mostly video", image: "Mostly pictures" };
export const isFormatPreference = (value: unknown): value is FormatPreference => typeof value === "string" && (FORMAT_PREFERENCES as readonly string[]).includes(value);

/** The most videos BuPulse makes in one run (each is rendered and may be voiced). */
export const MAX_RUN_VIDEOS = 5;

/** The share of posts that are videos, per app and preference. TikTok and YouTube are video apps whatever is chosen. */
export const VIDEO_SHARE: Record<FormatPreference, Record<Network, number>> = {
  auto: { tiktok: 0.9, youtube: 0.9, instagram: 0.55, facebook: 0.35, linkedin: 0.2, twitter: 0.2 },
  video: { tiktok: 1, youtube: 1, instagram: 0.85, facebook: 0.7, linkedin: 0.5, twitter: 0.5 },
  image: { tiktok: 0.9, youtube: 0.9, instagram: 0.15, facebook: 0.1, linkedin: 0.05, twitter: 0.05 },
};

const CAROUSEL_APPS: readonly Network[] = ["instagram", "facebook", "linkedin"];
/** The video apps; those that also take photo posts are passed as `photoApps`. */
export const VIDEO_APPS: readonly Network[] = ["tiktok", "youtube"];
const isVideoApp = (network: Network) => NETWORK_STYLE[network].video === "always";

/** A post's format, and for a video whether the owner films it (no video BuPulse can make: the script is a reminder). */
export type FormatChoice = { format: PackFormat; film?: boolean };
/** One app's formats on the days before, newest first ("YYYY-MM-DD"). */
export type RecentFormats = Partial<Record<Network, { day: string; format: PackFormat }[]>>;

export type FormatInput = {
  slots: readonly { network: Network; angle: AngleId }[];
  /** The business-local day the posts are for. */
  day: string;
  preference?: FormatPreference;
  videoInPlan: boolean;
  /** Videos the plan has left: this month's, and today's (the daily cap) when it is lower. */
  videosLeft: number;
  /** Videos this run may make at most (MAX_RUN_VIDEOS by default). */
  maxVideos?: number;
  /** Whether a slot's video would be the owner's own album video (it uses none of the plan's videos). */
  freeVideo?: (index: number) => boolean;
  /** Apps among TikTok / YouTube that also take photo posts (TikTok with photo posting on). */
  photoApps?: readonly Network[];
  recent?: RecentFormats;
  rng: () => number;
};

export type FormatDecision = { choices: FormatChoice[]; notes: string[] };

const DAY_MS = 24 * 60 * 60 * 1000;
const dayBefore = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);

/** The format an app had on each of the two days before `day` when it was the same both days, else null. */
export function repeatedFormat(recent: RecentFormats | undefined, network: Network, day: string): PackFormat | null {
  const list = recent?.[network] ?? [];
  const on = (d: string) => {
    const formats = new Set(list.filter((r) => r.day === d).map((r) => r.format));
    return formats.size === 1 ? [...formats][0] : null;
  };
  const a = on(dayBefore(day, 1));
  return a && a === on(dayBefore(day, 2)) ? a : null;
}

/** The format of a post that is not a video: a carousel for list angles where the app has them, else a picture. */
function stillFormat(network: Network, angle: AngleId, avoid: PackFormat | null): PackFormat {
  const carousel = CAROUSEL_APPS.includes(network);
  const wanted: PackFormat = carousel && ANGLES[angle].list ? "carousel" : "image";
  if (wanted !== avoid || !carousel) return wanted;
  return wanted === "carousel" ? "image" : "carousel";
}

/**
 * Decides every post's format. The draws come first (one per post, so a seed gives the same answer), then the rules:
 * no video without the plan, the three-days rule, and the video budget (video apps get it first, the owner's own
 * album videos cost nothing). Each limit that changed a video app's post is said in `notes`.
 */
export function decideFormats(input: FormatInput): FormatDecision {
  const pref = input.preference ?? "auto";
  const notes = new Set<string>();
  const draws = input.slots.map(() => input.rng());
  const want = input.slots.map(({ network }, i) => {
    const photos = !isVideoApp(network) || (input.photoApps ?? []).includes(network);
    // Three days running of the same format on one app: no video today after two video days (a picture or carousel
    // day is varied by stillFormat). Video apps stay videos.
    if (!isVideoApp(network) && repeatedFormat(input.recent, network, input.day) === "video") return false;
    return draws[i] < (photos ? VIDEO_SHARE[pref][network] : 1);
  });

  // The budget: BuPulse-made videos within what the plan has left and the run's limit, video apps first.
  const byPlan = Math.max(0, Math.floor(input.videosLeft));
  const budget = Math.min(byPlan, input.maxVideos ?? MAX_RUN_VIDEOS);
  const order = input.slots.map((_, i) => i).sort((a, b) => Number(isVideoApp(input.slots[b].network)) - Number(isVideoApp(input.slots[a].network)) || a - b);
  const makes = new Set<number>();
  const blocked = new Map<number, string>();
  let made = 0;
  for (const i of order) {
    if (!want[i]) continue;
    if (input.freeVideo?.(i)) makes.add(i);
    else if (!input.videoInPlan) blocked.set(i, "videos are not in your plan");
    else if (made < budget) {
      makes.add(i);
      made += 1;
    } else blocked.set(i, byPlan <= budget ? "your plan's videos are used up for now" : `a run makes at most ${budget} videos`);
  }

  const choices = input.slots.map(({ network, angle }, i): FormatChoice => {
    if (makes.has(i)) return { format: "video" };
    const label = NETWORK_STYLE[network].label;
    const reason = blocked.get(i);
    if (isVideoApp(network) && want[i]) {
      // A video app without a video BuPulse can make: a photo post where the app takes one, else the script to film.
      if ((input.photoApps ?? []).includes(network)) {
        notes.add(`${label} gets a picture instead of a video: ${reason}.`);
        return { format: "image" };
      }
      notes.add(`${label} gets a video script to film yourself: ${reason}.`);
      return { format: "video", film: true };
    }
    if (reason && pref === "video") notes.add(`${label} gets a picture instead of a video: ${reason}.`);
    return { format: stillFormat(network, angle, isVideoApp(network) ? null : repeatedFormat(input.recent, network, input.day)) };
  });
  return { choices, notes: [...notes] };
}

/** How many videos a run is likely to make, for the dialog's cost line (the decision itself is made when it runs). */
export function expectedVideos(input: { networks: readonly Network[]; perApp: number; preference?: FormatPreference; videoInPlan: boolean; videosLeft: number; maxVideos?: number }): number {
  if (!input.videoInPlan) return 0;
  const pref = input.preference ?? "auto";
  const expected = input.networks.reduce((n, network) => n + VIDEO_SHARE[pref][network] * Math.max(1, input.perApp), 0);
  const budget = Math.min(Math.floor(Math.max(0, input.videosLeft)), input.maxVideos ?? MAX_RUN_VIDEOS);
  return Math.min(budget, Math.ceil(expected - 0.25));
}

/** Formats per app on the days before `day`, newest first, from saved content (format and the day it was for). */
export function recentFormatsOf(rows: readonly { network: string | null; format: string | null; day: string }[], day: string): RecentFormats {
  const out: RecentFormats = {};
  for (const r of [...rows].sort((a, b) => b.day.localeCompare(a.day))) {
    if (!r.network || r.day >= day || !isPackFormat(r.format)) continue;
    const network = r.network as Network;
    (out[network] ??= []).push({ day: r.day, format: r.format });
  }
  return out;
}

export const isPackFormat = (value: unknown): value is PackFormat => value === "image" || value === "carousel" || value === "video";
