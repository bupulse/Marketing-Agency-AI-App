import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/ai/types";
import { assertFeature, FeatureRequiredError, featureErrorResponse } from "@/lib/entitlements";
import { campaignColumns, mapLegacyProject, productColumns } from "@/lib/knowledge/legacy";
import { MAX_ALBUM_PHOTOS, MAX_PRODUCTS_PER_BUSINESS } from "@/lib/knowledge/products";
import { MAX_CAMPAIGNS_PER_BUSINESS } from "@/lib/knowledge/campaigns";
import { defaultCurrency, resolveSubject, type Subject } from "@/lib/knowledge/service";
import { resolveCompany } from "@/lib/team/company";
import { getCurrentUser } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { projectInputSchema } from "@/lib/studio/schemas";
import { generateForSubject } from "@/lib/studio/service";
import { draftPostsFromContent } from "@/lib/content-board/drafts";
import { consumeUsage, refundUsage, UsageLimitError } from "@/lib/usage";
import { linkInTx, MediaError } from "@/lib/media/service";

const photoPathsSchema = z.array(z.string().min(1).max(300)).max(MAX_ALBUM_PHOTOS, `Add up to ${MAX_ALBUM_PHOTOS} photos.`).default([]);

// Generates a caption, hashtags, video script and ad headlines. Costs 1 text generation from the plan.
// Body: { productId } or { campaignId } to write for an existing product or campaign; or, as before the Knowledge
// base, the old project fields (type, title, price, features, details; `extraDetails` is an alias of `details`),
// which create a product or campaign the way the migration maps projects (lib/knowledge/legacy.ts). `photoPaths` must be
// photos already in the company's gallery (their storage paths): they are added to the product's or campaign's album;
// any other path answers 400 invalid_photo, nothing is dropped silently. The answer keeps `projectId` (the new
// product's or campaign's id) next to `productId` / `campaignId`.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Teammates work on the company account: its products, its Storage folder and its credits.
  const company = await resolveCompany(user.id);
  const companyId = company?.ownerId ?? user.id;

  const raw = await request.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const existingId = typeof body?.productId === "string" ? body.productId : typeof body?.campaignId === "string" ? body.campaignId : null;
  const parsed = existingId
    ? null
    : projectInputSchema(companyId)
        .extend({ type: z.string().trim().toLowerCase().min(1).max(40).default("product"), photoPaths: photoPathsSchema })
        .safeParse(body && { ...body, details: body.details ?? body.extraDetails });
  if (parsed && !parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const photos = photoPathsSchema.safeParse(parsed?.success ? parsed.data.photoPaths : body?.photoPaths);
  if (!photos.success) return NextResponse.json({ error: "Invalid request", issues: photos.error.issues }, { status: 400 });

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true, suspendedAt: true } });
  if (account?.deletionScheduledFor || account?.suspendedAt || company?.ownerDeleting || company?.ownerSuspended) return NextResponse.json({ error: "account_locked" }, { status: 403 });

  try {
    await rateLimit(`project:${companyId}`, RATE_LIMITS.projectCreate);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: "rate_limited", message: rateLimitMessage(error) },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    throw error;
  }

  const business = await prisma.business.findUnique({ where: { userId: companyId }, select: { id: true } });
  if (!business) return NextResponse.json({ error: "Business profile not found" }, { status: 409 });
  try {
    await assertFeature(business.id, "content");
  } catch (error) {
    if (error instanceof FeatureRequiredError) return featureErrorResponse(error);
    throw error;
  }

  // Photos go in the album; each must be a photo of this company's gallery.
  const assets = photos.data.length ? await prisma.mediaAsset.findMany({ where: { businessId: business.id, path: { in: photos.data } }, select: { id: true, path: true } }) : [];
  const unknown = photos.data.filter((p) => !assets.some((a) => a.path === p));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: "invalid_photo", message: "photoPaths must be photos already in your BuPulse gallery (their storage paths). Upload them in the Gallery first, or leave photoPaths out.", paths: unknown },
      { status: 400 },
    );
  }

  let subject: Subject | null = null;
  if (existingId) {
    subject = await resolveSubject(business.id, existingId);
    if (!subject) return NextResponse.json({ error: "not_found", message: "No product or campaign with that id." }, { status: 404 });
  }
  const mapped = parsed?.success
    ? mapLegacyProject({ id: "", type: parsed.data.type, title: parsed.data.title, price: parsed.data.price ?? null, features: parsed.data.features, details: parsed.data.details ? { notes: parsed.data.details } : null, photoPaths: [] })
    : null;
  if (mapped?.target === "product" && (await prisma.product.count({ where: { businessId: business.id } })) >= MAX_PRODUCTS_PER_BUSINESS) {
    return NextResponse.json({ error: "project_limit", message: "Product limit reached." }, { status: 409 });
  }
  if (mapped?.target === "campaign" && (await prisma.campaign.count({ where: { businessId: business.id } })) >= MAX_CAMPAIGNS_PER_BUSINESS) {
    return NextResponse.json({ error: "project_limit", message: "Campaign limit reached." }, { status: 409 });
  }

  // Reserve the credit first, so a blocked call leaves nothing behind.
  let reservation;
  try {
    reservation = await consumeUsage(companyId, "text");
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return NextResponse.json({ error: "usage_blocked", reason: error.reason }, { status: 402 });
    }
    throw error;
  }

  if (mapped) {
    try {
      if (mapped.target === "product") {
        const row = await prisma.product.create({ data: { ...productColumns(mapped), businessId: business.id, currency: await defaultCurrency(business.id) }, select: { id: true } });
        subject = { kind: "product", id: row.id };
      } else {
        const row = await prisma.campaign.create({ data: { ...campaignColumns(mapped), businessId: business.id }, select: { id: true } });
        subject = { kind: "campaign", id: row.id };
      }
    } catch (error) {
      await refundUsage(companyId, "text", reservation.periodStart).catch(() => {});
      throw error;
    }
  }
  if (assets.length > 0) {
    try {
      await prisma.$transaction((tx) => linkInTx(tx, subject!.kind, subject!.id, assets.map((a) => a.id)));
    } catch (error) {
      await refundUsage(companyId, "text", reservation.periodStart).catch(() => {});
      if (error instanceof MediaError) return NextResponse.json({ error: "invalid_photo", message: error.message, projectId: subject!.id }, { status: 400 });
      throw error;
    }
  }
  const ids = { projectId: subject!.id, productId: subject!.kind === "product" ? subject!.id : null, campaignId: subject!.kind === "campaign" ? subject!.id : null };

  try {
    const content = await generateForSubject({ userId: companyId, businessId: business.id, subject: subject!, feature: "content", reservation });
    // The posts to review on the Content page (docs/CONTENT.md); never fails the answer.
    await draftPostsFromContent({ businessId: business.id }, content.id).catch(() => {});
    return NextResponse.json({ ...ids, content });
  } catch (error) {
    if (error instanceof AIProviderError) {
      return NextResponse.json({ error: "ai_failed", message: error.message, retryable: error.retryable, ...ids }, { status: 502 });
    }
    console.error("Generation failed", error);
    return NextResponse.json({ error: "server_error", message: "Content generation is not available right now.", ...ids }, { status: 500 });
  }
}
