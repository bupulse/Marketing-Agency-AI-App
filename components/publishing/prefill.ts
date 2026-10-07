import type { StudioVariant } from "@/components/studio/helpers";
import type { ComposerPrefill, Overrides } from "@/lib/publishing/types";

/**
 * Opens the composer with generated content: the main caption and hashtags, the version prepared for each
 * network where it differs, and the video script for the video-only networks (TikTok, YouTube).
 */
export function prefillFromContent(
  content: { id: string; caption: string; hashtags: string[]; videoScript?: string; variants?: StudioVariant[] },
  projectId: string,
): ComposerPrefill {
  const overrides: Overrides = {};
  for (const v of content.variants ?? []) {
    if ((v.network === "instagram" || v.network === "facebook" || v.network === "linkedin") && (v.caption.trim() !== content.caption.trim() || v.hashtags.join(" ") !== content.hashtags.join(" "))) {
      overrides[v.network] = { text: v.caption, hashtags: v.hashtags };
    }
  }
  if (content.videoScript?.trim()) {
    overrides.tiktok = { text: content.videoScript };
    overrides.youtube = { text: content.videoScript };
  }
  return { text: content.caption, hashtags: content.hashtags, overrides, projectId, contentId: content.id };
}
