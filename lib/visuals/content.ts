// Visuals for Studio content (a product's or campaign's GeneratedContent): planned with the text, made again on
// request ("New picture"), and made for older content that has none yet.
import "server-only";
import { prisma } from "@/lib/db";
import { writingSubject, type Subject } from "@/lib/knowledge/service";
import { aiPhotosStatus, audienceFor, carouselNetworks, planVisuals, releaseContentVisuals, removeVisual, VisualError, videoAvailable, type Owner } from "./service";

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

/**
 * A new picture (or video plan, or both) for one content version, from a fresh art direction. The visuals it replaces
 * are removed (files a post still uses stay). Costs no text credit; AI photos use image credits as usual.
 */
export async function remakeContentVisuals(owner: Owner, contentId: string, only?: "image" | "video") {
  const content = await prisma.generatedContent.findFirst({ where: { id: contentId, businessId: owner.businessId }, select: { id: true, caption: true, adHeadlines: true, videoScript: true, productId: true, campaignId: true } });
  if (!content || (!content.productId && !content.campaignId)) throw new VisualError("We could not find that content.");
  const subject: Subject = content.productId ? { kind: "product", id: content.productId } : { kind: "campaign", id: content.campaignId! };
  const [business, item, old] = await Promise.all([
    prisma.business.findUnique({ where: { id: owner.businessId }, select: { name: true, tone: true, industry: true, brandColors: true } }),
    writingSubject(owner.businessId, subject),
    prisma.contentVisual.findMany({ where: { businessId: owner.businessId, contentId }, select: { id: true, kind: true } }),
  ]);
  if (!business || !item) throw new VisualError("We could not find that product or campaign.");
  const [ai, videoOk, carouselAllowed, audience] = await Promise.all([aiPhotosStatus(owner), videoAvailable(owner.businessId), carouselNetworks(owner.businessId).catch(() => true), audienceFor(owner.businessId)]);
  const wantVideo = only !== "image" && videoOk && content.videoScript.trim().length > 0;
  if (only === "video" && !wantVideo) throw new VisualError(videoOk ? "Write a video script first." : "Videos are not in your plan. Add video to your plan to make them.");

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
