// What a "Create today's content" run uses, shown before the owner confirms (docs/CONTENT.md). Pure, so the dialog
// and the server agree. Text: one generation per post (the current metering). AI images: at most one per designed
// post, only with "AI designs" and while the plan's image credits last (reserved when the run starts). Videos BuPulse
// makes use up to 30 video seconds each and, with voiceover, up to 600 voice characters each, when they are made.

export type DayMode = "ai" | "describe" | "own";
export type DesignChoice = "ai" | "free";

/** The most one video BuPulse makes uses (VIDEO_LIMITS.maxMs, MAX_VOICE_CHARS). */
export const VIDEO_SECONDS_PER_VIDEO = 30;
export const VOICE_CHARS_PER_VIDEO = 600;

export type RunCostInput = {
  mode: DayMode;
  design: DesignChoice;
  /** Posts in the run (one per network). */
  posts: number;
  /** Posts that get a designed picture (not the owner's own media, not a video only). */
  designed: number;
  /** AI photos are possible at all: the plan has them, credits and the AI allowance are left. */
  aiPhotos: boolean;
  textLeft: number;
  imagesLeft: number;
  /** Videos BuPulse would make from the photos (TikTok / YouTube without the owner's video, plan with video). */
  videos?: number;
  videoSecondsLeft?: number;
  /** Voiceover is in the plan and on: each made video is spoken. */
  voice?: boolean;
  voiceCharsLeft?: number;
};

export type RunCost = { text: number; aiImages: number; videoSeconds: number; voiceChars: number; enoughText: boolean; message: string };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export function runCost(input: RunCostInput): RunCost {
  const text = Math.max(0, input.posts);
  const aiImages = input.mode !== "own" && input.design === "ai" && input.aiPhotos ? Math.max(0, Math.min(input.designed, input.imagesLeft)) : 0;
  const videos = input.mode === "own" ? 0 : Math.max(0, input.videos ?? 0);
  const videoSeconds = Math.min(videos * VIDEO_SECONDS_PER_VIDEO, Math.max(0, input.videoSecondsLeft ?? 0));
  const voiceChars = input.voice && videoSeconds > 0 ? Math.min(videos * VOICE_CHARS_PER_VIDEO, Math.max(0, input.voiceCharsLeft ?? 0)) : 0;
  const textLeft = Math.max(0, input.textLeft);
  const enoughText = text > 0 && textLeft >= text;
  const showImages = input.mode !== "own" && input.design === "ai";

  const uses = [plural(text, "text generation", "text generations")];
  uses.push(aiImages > 0 ? `up to ${plural(aiImages, "AI image", "AI images")}` : "no AI images");
  if (videoSeconds > 0) uses.push(`up to ${plural(videoSeconds, "video second", "video seconds")}`);
  if (voiceChars > 0) uses.push(`about ${plural(voiceChars, "voiceover character", "voiceover characters")}`);
  const left = [plural(textLeft, "text generation", "text generations")];
  if (showImages) left.push(plural(Math.max(0, input.imagesLeft), "AI image", "AI images"));
  if (videoSeconds > 0) left.push(plural(Math.max(0, input.videoSecondsLeft ?? 0), "video second", "video seconds"));
  if (voiceChars > 0) left.push(plural(Math.max(0, input.voiceCharsLeft ?? 0), "voiceover character", "voiceover characters"));
  const short = enoughText ? "" : text === 0 ? " Choose at least one app." : ` Choose ${textLeft === 0 ? "again when your credits renew" : `at most ${textLeft} ${textLeft === 1 ? "app" : "apps"}`}.`;
  return { text, aiImages, videoSeconds, voiceChars, enoughText, message: `Uses ${list(uses)}; you have ${list(left)} left this month.${short}` };
}
