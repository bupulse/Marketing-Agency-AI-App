// What the video quality choice (lib/visuals/video-quality.ts) can offer one company right now, for the Autopilot and
// Content -> Settings forms. A failing lookup offers simple videos only.
import "server-only";
import { isServiceEnabled } from "@/lib/admin/switch";
import { veoClipCredits } from "@/lib/video-engine/credits";
import { AI_CLIP_SECONDS, AI_CLIPS_PER_VIDEO, AI_VIDEOS_OFF } from "./video-quality";
import { videoAvailable } from "./service";

export type VideoQualityOffer = {
  /** AI clips can be made: the "Google Veo AI clips" switch is on and the plan has studio credits. */
  aiOn: boolean;
  /** Why not, in the owner's words, when aiOn is false. */
  aiOffReason: string | null;
  /** About what one AI video costs in studio credits. */
  aiCredits: number;
};

/** Null when the plan makes no videos at all (the choice is not shown). */
export async function videoQualityOffer(businessId: string, studioCreditsInPlan: number): Promise<VideoQualityOffer | null> {
  if (!(await videoAvailable(businessId))) return null;
  const aiCredits = AI_CLIPS_PER_VIDEO * veoClipCredits(AI_CLIP_SECONDS);
  const switchOn = await isServiceEnabled("veo").catch(() => false);
  const aiOffReason = !switchOn ? AI_VIDEOS_OFF : studioCreditsInPlan <= 0 ? "Your plan has no studio credits: simple videos are made." : null;
  return { aiOn: aiOffReason === null, aiOffReason, aiCredits };
}
