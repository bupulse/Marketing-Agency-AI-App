// One shared media set per day (owner decisions, 11 November 2026; the later update the same day overrides the
// Instagram and TikTok parts): the day's format is decided once, the studio makes ONE set (1 to 4 pictures, the AI
// picks the count by the idea, plus the reel), and the post agent uses the same visuals on every app with a caption
// per app:
// - Facebook Page: the pictures as one multi-photo post; on a video day a second post with the reel;
// - LinkedIn Page: the pictures (multi-image from 2, else one) with a long, article-style caption and hashtags;
// - X: up to 4 of the pictures;
// - Instagram and TikTok (and YouTube Shorts): a reel EVERY day. On a pictures day it is a slideshow made from the
//   day's pictures (words on screen, a voice-over and a song from the library); on a video day the studio decides
//   which video (lib/content-flow/video-kind.ts). No Instagram carousels and no TikTok photo slides any more.
// Without a video (not in the plan, used up, a skit day) Instagram gets the pictures and TikTok / YouTube the script to
// film, as before. Pure, so the writer, the tests and the three makers (Create, Daily posts, Autopilot) agree.
import { ANGLES, type AngleId, type PackFormat } from "@/lib/studio/angles";
import type { Network } from "@/lib/social/types";
import type { FormatPreference, RecentFormats } from "./format";

/** "images": the pictures, and a slideshow reel made from them for Instagram and TikTok. "video": a real video day. */
export type DayFormat = "images" | "video";
/** What a post of the day carries: the set's pictures, the reel, or (no reel possible) the script to film. */
export type DayRole = "images" | "reel" | "film";

export const MAX_SET_IMAGES = 4;

/** Apps that take the reel every day. */
export const REEL_APPS: readonly Network[] = ["instagram", "tiktok", "youtube"];
/** Apps with no photo post: without a reel they get the script to film. */
const VIDEO_ONLY_APPS: readonly Network[] = ["tiktok", "youtube"];
/** Apps whose video post tells a video day from a pictures day on later days (Facebook gets the reel only then). */
const VIDEO_DAY_APPS: readonly Network[] = ["facebook", "linkedin", "twitter"];

/** The share of days that are video days, by the owner's "Format" choice. */
export const VIDEO_DAY_SHARE: Record<FormatPreference, number> = { auto: 0.35, video: 0.85, image: 0 };

const DAY_MS = 24 * 60 * 60 * 1000;
const dayBefore = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);

/** The format of the days before, from saved content: a day with a video post on Facebook, LinkedIn or X was a video day. */
export function recentDayFormat(recent: RecentFormats | undefined, day: string): DayFormat | null {
  let seen = false;
  for (const network of Object.keys(recent ?? {}) as Network[]) {
    for (const r of recent?.[network] ?? []) {
      if (r.day !== day) continue;
      seen = true;
      if (VIDEO_DAY_APPS.includes(network) && r.format === "video") return "video";
    }
  }
  return seen ? "images" : null;
}

/**
 * The day's format, decided once for all its posts. A video day needs a video BuPulse can make (the plan, the videos
 * left); never three video days running, and after two pictures days a video day is twice as likely.
 */
export function decideDayFormat(input: { day: string; preference?: FormatPreference; videoPossible: boolean; recent?: RecentFormats; rng: () => number }): { format: DayFormat; why: string } {
  const draw = input.rng();
  if (!input.videoPossible) return { format: "images", why: "no video can be made today" };
  const pref = input.preference ?? "auto";
  if (pref === "image") return { format: "images", why: "you asked for mostly pictures" };
  const [a, b] = [recentDayFormat(input.recent, dayBefore(input.day, 1)), recentDayFormat(input.recent, dayBefore(input.day, 2))];
  if (pref !== "video" && a === "video" && b === "video") return { format: "images", why: "two video days before" };
  const share = Math.min(1, VIDEO_DAY_SHARE[pref] * (a === "images" && b === "images" ? 2 : 1));
  return draw < share ? { format: "video", why: pref === "video" ? "you asked for mostly video" : "BuPulse chose a video day" } : { format: "images", why: "BuPulse chose a pictures day" };
}

/**
 * How many pictures suit an idea when the AI did not say (owner: 1 for a tip or a quote, 2 to 3 for an offer or a
 * before / after, 4 for a range of products). The writer's own count wins (lib/ai/pack.ts).
 */
export function imageCountFor(angle: AngleId, photos: number): number {
  switch (angle) {
    case "before-after":
      return 2;
    case "price":
    case "why-us":
    case "story":
    case "behind-scenes":
    case "seasonal":
      return 2;
    case "features":
    case "how-it-works":
      return 3;
    case "spotlight":
      return photos >= 4 ? 4 : 3;
    default:
      return ANGLES[angle].list ? 3 : 1;
  }
}

/**
 * The pictures a set can really have: each is an AI picture (while the AI images last) or one of the owner's photos as
 * it is, at most MAX_SET_IMAGES. At least one, so the set is planned (a set with nothing to show is skipped when drawn).
 */
export function clampImageCount(wanted: number, can: { aiImages: number; photos: number }): number {
  const room = Math.max(0, Math.floor(can.aiImages)) + Math.max(0, Math.floor(can.photos));
  return Math.max(1, Math.min(MAX_SET_IMAGES, Math.floor(wanted) || 1, room || 1));
}

/** The k-th post of each app goes into round k: one shared set (and one idea) per round. */
export function roundsOf(slots: readonly Network[]): Network[][] {
  const rounds: Network[][] = [];
  const count = new Map<Network, number>();
  for (const network of slots) {
    const k = count.get(network) ?? 0;
    count.set(network, k + 1);
    (rounds[k] ??= []).push(network);
  }
  return rounds;
}

export type DaySlot = { network: Network; role: DayRole; /** Facebook's reel post on a video day, next to its pictures post. */ companion?: boolean };

/**
 * What each app gets from the round's set. `reel`: the day has a reel (BuPulse makes it, or the owner's own video).
 * Facebook gets a second post with the reel on a video day.
 */
export function distributeRound(input: { networks: readonly Network[]; format: DayFormat; reel: boolean }): DaySlot[] {
  const out: DaySlot[] = [];
  for (const network of input.networks) {
    if (REEL_APPS.includes(network)) {
      out.push({ network, role: input.reel ? "reel" : VIDEO_ONLY_APPS.includes(network) ? "film" : "images" });
      continue;
    }
    out.push({ network, role: "images" });
    if (network === "facebook" && input.format === "video" && input.reel) out.push({ network, role: "reel", companion: true });
  }
  return out;
}

/** The writer's format for a post of the set. */
export function packFormatOf(role: DayRole, images: number): PackFormat {
  if (role !== "images") return "video";
  return images >= 2 ? "carousel" : "image";
}

/** The post's format when it is drafted: pictures wait for the set (POST, a carousel once there are 2 or more). */
export function draftFormatOf(role: DayRole): "POST" | "SCRIPT" {
  return role === "images" ? "POST" : "SCRIPT";
}

/** Whether the round needs the set's pictures drawn: a post shows them, or the reel is made from them. */
export function roundNeedsImages(slots: readonly DaySlot[], reelFromImages: boolean): boolean {
  return slots.some((s) => s.role === "images") || (reelFromImages && slots.some((s) => s.role === "reel"));
}
