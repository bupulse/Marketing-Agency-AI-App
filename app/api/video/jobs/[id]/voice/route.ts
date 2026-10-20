import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkActiveUser } from "@/lib/auth/require-user";
import { assertFeature, FeatureRequiredError, featureErrorResponse } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { can } from "@/lib/team/roles";
import { UsageLimitError } from "@/lib/usage";
import { VideoStudioError } from "@/lib/video-studio/job-view";
import { makeJobVoice } from "@/lib/video-studio/voice";

// ElevenLabs takes 5 to 20 s for 30 seconds of speech.
export const maxDuration = 120;

const body = z.object({ voiceId: z.string().max(40).nullish() });

// The voice-over of a designed Motion video (docs/VIDEO_APP_INTEGRATION.md): its `say` lines spoken in the company's
// voice (lib/video-studio/voice.ts). A take the company already has is free; a new one costs VOICE_OVER_CREDITS video
// credits, taken first and given back when it is not spoken. Body: { voiceId? }. Answers { voice, credits }, voice null
// when the design has no voice lines (nothing charged); 503 in plain English when voice-over is unavailable.
export async function POST(request: Request, ctx: RouteContext<"/api/video/jobs/[id]/voice">) {
  const check = await checkActiveUser();
  if (check.status === "signed_out") return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (check.status !== "ok") return NextResponse.json({ error: "account_locked" }, { status: 403 });
  const user = check.user;
  if (!can(user.role, "content")) return NextResponse.json({ error: "forbidden", message: "Ask your company owner for access to videos." }, { status: 403 });
  const { id } = await ctx.params;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || id.length > 40) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return NextResponse.json({ error: "Business profile not found" }, { status: 409 });
  try {
    await assertFeature(business.id, "videoStudio");
    await rateLimit(`video-voice:${user.id}`, RATE_LIMITS.videoVoice);
  } catch (error) {
    if (error instanceof FeatureRequiredError) return featureErrorResponse(error);
    if (error instanceof RateLimitError) return NextResponse.json({ error: "rate_limited", message: rateLimitMessage(error) }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    throw error;
  }

  try {
    return NextResponse.json(await makeJobVoice({ userId: user.id, actorId: user.actorId, businessId: business.id }, id, { voiceId: parsed.data.voiceId ?? null }));
  } catch (error) {
    if (error instanceof VideoStudioError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof UsageLimitError) return NextResponse.json({ error: "usage_blocked", reason: error.reason, message: error.reason === "limit_reached" ? "Your video credits for this month are used up." : undefined }, { status: 402 });
    await logError(error, { source: "video.voice", userId: user.id });
    return NextResponse.json({ error: "server_error", message: "The voice-over is not available right now." }, { status: 500 });
  }
}
