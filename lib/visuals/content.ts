// Visuals for Studio content (a product's or campaign's GeneratedContent): planned with the text, made again on
// request ("New picture"), and made for older content that has none yet.
import "server-only";
import { prisma } from "@/lib/db";
import { writingSubject, type Subject } from "@/lib/knowledge/service";
import { checkScript, SCRIPT_RULES } from "./script";
import { writeContentScript } from "./script-writer";
import { aiPhotosStatus, audienceFor, carouselNetworks, planVisuals, releaseContentVisuals, removeVisual, VisualError, videoAvailable, type Owner } from "./service";

export const VIDEO_NOT_IN_PLAN = "Videos are not in your plan. Add video to your plan to make them.";

type BusinessBits = { name: string; tone: string | null; industry: string | null; brandColors: string[] };
type ItemBits = { type: string; title: string; price?: string | null; photoPaths: string[] };
type ContentBits = { id: string; caption: string; adHeadlines: string[]; videoScript: string };

/** Plans the image (or carousel) and, when the plan has video and there is a script, the video of new content. */
export async function planContentVisuals(owner: Owner, input: { business: BusinessBits; item: ItemBits; content: ContentBits }) {
  const { business, item, content } = input;
  const [ai, video, carouselAllowed, audience] = await Promise.all([aiPhotosStatus(owner), videoAvailable(owner.businessId).catch(() => false), carouselNetworks(owner.businessId).catch(() => true), audienceFor(owner.businessId)]);
  return planVisuals({
    owner,
    target: { contentId: content.id },
    business,
    subjectType: item.type,
    title: item.title,
    price: item.price,
    caption: content.caption,
    headlines: content.adHeadlines,
    videoScript: content.videoScript,
    photos: item.photoPaths,
    video: video && content.videoScript.trim().length > 0,
    carouselAllowed,
    aiAllowed: ai.allowed,
    aiExhausted: ai.exhausted ?? undefined,
    audience,
  });
}

/** The owner's own video script, as typed (control characters out, within the length limit), or a reason it cannot be used. */
export function ownScript(script: string): string {
  const clean = script.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!clean || checkScript(clean).scenes.length === 0) throw new VisualError("Write your script first: one line per scene.");
  if (clean.length > SCRIPT_RULES.maxLength) throw new VisualError(`Keep your script under ${SCRIPT_RULES.maxLength} characters.`);
  return clean;
}

/**
 * A new picture (or video plan, or both) for one content version, from a fresh art direction. The visuals it replaces
 * are removed (files a post still uses stay). AI photos use image credits as usual.
 *
 * "Make a video" never stops at a missing script: `script` is the owner's own (used as typed, no credit); without one,
 * content that has no video script gets one written by the AI first (one text generation, lib/visuals/script-writer.ts).
 * Only a plan without video stops it.
 */
export async function remakeContentVisuals(owner: Owner, contentId: string, only?: "image" | "video", options: { script?: string } = {}) {
  const row = await prisma.generatedContent.findFirst({ where: { id: contentId, businessId: owner.businessId }, select: { id: true, caption: true, adHeadlines: true, videoScript: true, productId: true, campaignId: true } });
  if (!row) throw new VisualError("We could not find that content.");
  let content = row;
  if (only === "video") {
    if (!(await videoAvailable(owner.businessId))) throw new VisualError(VIDEO_NOT_IN_PLAN);
    if (options.script !== undefined) {
      const videoScript = ownScript(options.script);
      await prisma.generatedContent.updateMany({ where: { id: contentId, businessId: owner.businessId }, data: { videoScript } });
      content = { ...content, videoScript };
    } else if (!content.videoScript.trim()) {
      content = { ...content, videoScript: await writeContentScript(owner, contentId) };
    }
  }
  // Content for General (a day's run, docs/CONTENT.md) is about the business itself: no album.
  const subject: Subject | null = content.productId ? { kind: "product", id: content.productId } : content.campaignId ? { kind: "campaign", id: content.campaignId } : null;
  const [business, found, old] = await Promise.all([
    prisma.business.findUnique({ where: { id: owner.businessId }, select: { name: true, tone: true, industry: true, brandColors: true } }),
    subject ? writingSubject(owner.businessId, subject) : null,
    prisma.contentVisual.findMany({ where: { businessId: owner.businessId, contentId }, select: { id: true, kind: true } }),
  ]);
  const item = found ?? (subject || !business ? null : { type: "other", title: business.name, price: null, photoPaths: [] as string[] });
  if (!business || !item) throw new VisualError("We could not find that product or campaign.");
  const [ai, videoOk, carouselAllowed, audience] = await Promise.all([aiPhotosStatus(owner), videoAvailable(owner.businessId), carouselNetworks(owner.businessId).catch(() => true), audienceFor(owner.businessId)]);
  const wantVideo = only !== "image" && videoOk && content.videoScript.trim().length > 0;
  if (only === "video" && !wantVideo) throw new VisualError(VIDEO_NOT_IN_PLAN);

  const made = await planVisuals({
    owner,
    target: { contentId },
    business,
    subjectType: item.type,
    title: item.title,
    price: item.price,
    caption: content.caption,
    headlines: content.adHeadlines,
    videoScript: content.videoScript,
    photos: item.photoPaths,
    image: only !== "video",
    video: wantVideo,
    carouselAllowed,
    aiAllowed: ai.allowed,
    aiExhausted: ai.exhausted ?? undefined,
    audience,
  });
  if (!made.image && !made.video) throw new VisualError("We could not plan a new picture just now. Please try again.");
  const replaced = old.filter((v) => (v.kind === "video" ? !!made.video : !!made.image));
  for (const v of replaced) await removeVisual(owner, v.id).catch(() => {});
  return made;
}

/** Moves a content version's visuals to the version that replaces it (the owner saved edits), so the picture stays. */
export async function carryVisuals(businessId: string, fromContentId: string, toContentId: string) {
  await prisma.contentVisual.updateMany({ where: { businessId, contentId: fromContentId }, data: { contentId: toContentId } });
}

export { releaseContentVisuals };
