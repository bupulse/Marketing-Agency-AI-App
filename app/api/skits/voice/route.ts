import { NextResponse } from "next/server";
import { checkActiveUser, allowed } from "@/lib/auth/require-user";
import { featureBlocked } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { saveSkitVoice, SkitError } from "@/lib/skits/service";
import { VOICE_MAX_BYTES } from "@/lib/skits/shared";

// One speaker's voice note for a talking skit (lib/skits): recorded in the browser (sent as WAV) or a WhatsApp voice
// note picked from the phone. Multipart form: skitId, speaker (1-based), file. Saved by the server in the company
// account's folder of the media bucket; the answer says which speakers still need one.
export async function POST(request: Request) {
  const check = await checkActiveUser();
  if (check.status === "signed_out") return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (check.status !== "ok") return NextResponse.json({ error: "Your account cannot do this now." }, { status: 403 });
  const user = check.user;
  if (!allowed(user, "content")) return NextResponse.json({ error: "Your role cannot record skits." }, { status: 403 });
  const blocked = await featureBlocked(user.businessId, "video");
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
  // A body far over the limit is refused before it is read.
  if (Number(request.headers.get("content-length") ?? 0) > VOICE_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "That recording is too long. Keep each voice note under 15 seconds." }, { status: 413 });
  try {
    await rateLimit(`skit-voice:${user.businessId}`, { limit: 40, windowSeconds: 60 * 60 });
    const form = await request.formData();
    const file = form.get("file");
    const skitId = String(form.get("skitId") ?? "");
    const speaker = Number(form.get("speaker"));
    if (!(file instanceof File) || !/^[a-z0-9]{8,40}$/i.test(skitId)) return NextResponse.json({ error: "Record the voice note again." }, { status: 400 });
    const result = await saveSkitVoice({ userId: user.id, businessId: user.businessId }, skitId, speaker, { type: file.type, size: file.size, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof SkitError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof RateLimitError) return NextResponse.json({ error: rateLimitMessage(error) }, { status: 429 });
    await logError(error, { source: "skits.voice", businessId: user.businessId });
    return NextResponse.json({ error: "We could not save the recording. Try again." }, { status: 500 });
  }
}
