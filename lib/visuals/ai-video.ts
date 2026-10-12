// The seam for real AI video ("AI video (coming soon)" on the content screens). Slideshow videos are made in the
// owner's browser today (components/visuals/video-renderer.ts); an AI video provider (Veo or similar, through the
// VideoProvider interface in lib/ai/types.ts) plugs in here later, with its own credits and the AiCall ledger.
import type { VideoProvider } from "@/lib/ai/types";

export const AI_VIDEO_STATUS = "coming_soon" as const;

/** The AI video provider, or null while AI video is not available (always, for now). */
export function getAiVideoProvider(): VideoProvider | null {
  return null;
}
