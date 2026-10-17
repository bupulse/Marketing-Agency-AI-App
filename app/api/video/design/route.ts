import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkActiveUser } from "@/lib/auth/require-user";
import { assertFeature, FeatureRequiredError, featureErrorResponse } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { UsageLimitError } from "@/lib/usage";
import { DESIGN_MODES, PLATFORMS } from "@/lib/video-engine/designer";
import { RATIOS } from "@/lib/video-engine/spec";
import { BriefError, MAX_DESIGN_PHOTOS } from "@/lib/video-studio/brief";
import { designMotionJobs, VideoStudioError } from "@/lib/video-studio/jobs";

// A Claude design takes 30 to 60 s (two calls when the first answer cannot be read); four versions run side by side.
export const maxDuration = 300;

const body = z.object({
  productId: z.string().min(1).max(40),
  photoPaths: z.array(z.string().min(1).max(300)).max(MAX_DESIGN_PHOTOS, `Use up to ${MAX_DESIGN_PHOTOS} photos.`).optional(),
  templateId: z.string().min(1).max(40).default("product-hero"),
  hookId: z.string().min(1).max(40).default("auto"),
  ratio: z.enum(Object.keys(RATIOS) as [keyof typeof RATIOS, ...(keyof typeof RATIOS)[]]).default("9:16"),
  seconds: z.number().int().min(6).max(30).default(15),
  note: z.string().max(600).nullish(),
  mode: z.enum(DESIGN_MODES).default("reference"),
  parentId: z.string().min(1).max(40).nullish(),
  fixedLens: z.boolean().optional(),
  cartoonId: z.string().max(40).nullish(),
  platform: z.enum(Object.keys(PLATFORMS) as [keyof typeof PLATFORMS, ...(keyof typeof PLATFORMS)[]]).nullish(),
  versions: z.number().int().min(1).max(4).default(1),
  voice: z.boolean().optional(),
  chosenHook: z.object({ hookId: z.string().min(1).max(60), line: z.string().min(1).max(120) }).nullish(),
});

// Designs a Motion video with Claude (docs/VIDEO_APP_INTEGRATION.md, task 5). Costs CLAUDE_VIDEO_CREDITS video credits
// per version, taken before Claude is called and given back for a version that fails. Body: { productId, photoPaths?,
// templateId, hookId, ratio, seconds, note?, mode, parentId? (edit, extend), fixedLens?, cartoonId?, platform?,
// versions?, voice?, chosenHook? }. Answers { jobs } (each designed, or failed with its reason); 503 when video design is
// unavailable (no Claude key, or Claude switched off in Admin -> Services), before anything is charged.
export async function POST(request: Request) {
  const check = await checkActiveUser();
  if (check.status === "signed_out") return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (check.status !== "ok") return NextResponse.json({ error: "account_locked" }, { status: 403 });
  const user = check.user;

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  const input = parsed.data;
  if ((input.mode === "edit" || input.mode === "extend") && !input.parentId) return NextResponse.json({ error: "invalid", message: "Choose the video to change (parentId)." }, { status: 400 });

  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return NextResponse.json({ error: "Business profile not found" }, { status: 409 });
  try {
    await assertFeature(business.id, "videoStudio");
  } catch (error) {
    if (error instanceof FeatureRequiredError) return featureErrorResponse(error);
    throw error;
  }

  try {
    await rateLimit(`video-design:${user.id}`, RATE_LIMITS.videoDesign);
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: "rate_limited", message: rateLimitMessage(error) }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    throw error;
  }

  try {
    const jobs = await designMotionJobs({ userId: user.id, actorId: user.actorId, businessId: business.id }, { ...input, note: input.note ?? null, parentId: input.parentId ?? null, cartoonId: input.cartoonId ?? null, platform: input.platform ?? null, chosenHook: input.chosenHook ?? null });
    const designed = jobs.filter((j) => j.status === "designed");
    if (!designed.length) return NextResponse.json({ error: "design_failed", message: jobs[0]?.error ?? "The design could not be made.", jobs }, { status: 502 });
    return NextResponse.json({ jobs });
  } catch (error) {
    if (error instanceof VideoStudioError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof BriefError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "not_found" ? 404 : 400 });
    if (error instanceof UsageLimitError) return NextResponse.json({ error: "usage_blocked", reason: error.reason, message: error.reason === "limit_reached" ? "Your video credits for this month are used up." : undefined }, { status: 402 });
    await logError(error, { source: "video.design", userId: user.id });
    return NextResponse.json({ error: "server_error", message: "Video design is not available right now." }, { status: 500 });
  }
}
