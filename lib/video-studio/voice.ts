import "server-only";
import { assertServiceEnabled, ServiceDisabledError } from "@/lib/admin/switch";
import { AIBudgetExceededError } from "@/lib/ai/budget";
import { withLedger } from "@/lib/ai/ledger";
import { getTtsProvider, type TtsResult } from "@/lib/ai/tts";
import { getContentSettings } from "@/lib/content-board/settings-service";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeUsage, refundUsage } from "@/lib/usage";
import { VOICE_OVER_CREDITS } from "@/lib/video-engine/credits";
import { VIDEO_LEDGER_FEATURES } from "@/lib/video-engine/ledger-features";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { fitSpecToVoice, looksKinyarwanda, voiceLanguage, voiceLines, voiceScript, type SpokenLine, type VoiceCue } from "@/lib/video-engine/voice";
import { lineTimings, type Timing } from "@/lib/voice/speech";
import { claimClip, fileExists, storeAudio, voiceHash } from "@/lib/voice/service";
import { DEFAULT_VOICE_ID, isVoiceId } from "@/lib/voice/voices";
import { VideoStudioError, type StudioOwner } from "./jobs";

// The voice-over of a Video Studio design (docs/VIDEO_APP_INTEGRATION.md, POST /api/video/jobs/<id>/voice): the
// design's `say` lines spoken in the company's voice by ElevenLabs (lib/ai/tts.ts), through the cost ledger
// ("video-voice", and so the ElevenLabs switch). The take is a VoiceClip, shared with the content videos by its hash
// (voice, model and exact text): a take the company already has is free; a new one costs VOICE_OVER_CREDITS video
// credits, taken first and given back when it is not spoken. While the take is being made the job holds the
// reservation (voiceCredits, voicePeriodStart, voiceReservedAt): this request clears it when the take is paid for or
// the credits go back, and the video-jobs sweep gives back one left after VOICE_LEASE_MS (sweep.ts; the request died), so a
// reservation is settled exactly once. The browser then mixes the take into the MP4 (encodeSpecMp4).

/** How long the browser may fetch the take (it encodes right after asking). */
const VOICE_URL_SECONDS = 30 * 60;

export type JobVoice = {
  /** A signed link to the MP3 (or the MP3 itself as a data URL when it could not be stored this time). */
  url: string;
  /** The design fitted to the voice: scenes stretched to their lines (fitSpecToVoice). */
  spec: MotionSpec;
  cues: VoiceCue[];
  /** False when the lines were too long for 30 seconds and some were cut. */
  fits: boolean;
  /** True when the company already had this take (nothing charged). */
  cached: boolean;
  durationMs: number;
  characters: number;
  /** The language the voice speaks, and the owner's note when it is not the content language (Kinyarwanda). */
  spokenLanguage: string;
  note: string | null;
};

/** Why a voice-over cannot be made right now (no key, or ElevenLabs switched off), before anything is charged. */
export async function voiceUnavailable(): Promise<string | null> {
  if (!getTtsProvider()) return "Voice-over is not available right now: it is waiting for its voice key. The MP4 can be made without it.";
  try {
    await assertServiceEnabled("elevenlabs");
  } catch (error) {
    if (error instanceof ServiceDisabledError) return "Voice-over is paused right now. The MP4 can be made without it.";
    throw error;
  }
  return null;
}

async function signedVoiceUrl(businessId: string, path: string): Promise<string | null> {
  if (!path.startsWith(`voice/${businessId}/`) || path.includes("..")) return null;
  const { data } = await createAdminClient().storage.from("media").createSignedUrl(path, VOICE_URL_SECONDS);
  return data?.signedUrl ?? null;
}

const dataUrl = (audio: Uint8Array) => `data:audio/mpeg;base64,${Buffer.from(audio).toString("base64")}`;

/**
 * The voice-over of a designed Motion job. Null voice (and nothing charged) when the design has no `say` lines.
 * Throws VideoStudioError in plain English (unavailable, lines in a language the voice cannot speak, another request
 * speaking the same take) before or instead of charging; UsageLimitError when the video credits are used up.
 */
export async function makeJobVoice(owner: StudioOwner, jobId: string, opts: { voiceId?: string | null } = {}): Promise<{ voice: JobVoice | null; credits: number }> {
  const job = await prisma.videoJob.findFirst({ where: { id: jobId, businessId: owner.businessId, engine: "motion" }, select: { id: true, status: true, spec: true } });
  if (!job?.spec || (job.status !== "designed" && job.status !== "ready")) throw new VideoStudioError("That video is not designed yet, so it has no voice lines.", "not_found", 404);
  const spec = job.spec as unknown as MotionSpec;
  const lines = voiceLines(spec);
  if (lines.length === 0) return { voice: null, credits: 0 };

  const unavailable = await voiceUnavailable();
  if (unavailable) throw new VideoStudioError(unavailable, "unavailable", 503);
  const business = await prisma.business.findUnique({ where: { id: owner.businessId }, select: { contentLanguage: true } });
  const { spokenLanguage, note } = voiceLanguage(business?.contentLanguage);
  // Kinyarwanda is spoken in English: lines still in Kinyarwanda (a design made before that rule) are refused unpaid.
  if (note && looksKinyarwanda(lines.map((l) => l.text).join(" "))) {
    throw new VideoStudioError(`The voice lines are in a language the voice cannot speak yet. Make the design again: its voice lines will be in ${spokenLanguage}.`, "invalid", 400);
  }
  const settings = await getContentSettings(owner.businessId).catch(() => null);
  const voiceId = isVoiceId(opts.voiceId) ? opts.voiceId : (settings?.voiceId ?? DEFAULT_VOICE_ID);
  const tts = getTtsProvider()!;
  const { text, ranges } = voiceScript(lines);
  const hash = voiceHash(voiceId, tts.model, text);
  const clipOwner = { userId: owner.userId, businessId: owner.businessId };

  const answer = async (clip: { path: string | null; durationMs: number; characters: number; timings: unknown }, cached: boolean, audio?: Uint8Array) => {
    const timings = (clip.timings as Timing[]) ?? [];
    const spoken: SpokenLine[] = lines.map((l, i) => ({ ...l, startMs: timings[i]?.startMs ?? 0, endMs: timings[i]?.endMs ?? 0 }));
    const fitted = fitSpecToVoice(spec, { lines: spoken, durationMs: clip.durationMs });
    const url = (clip.path ? await signedVoiceUrl(owner.businessId, clip.path) : null) ?? (audio ? dataUrl(audio) : null);
    if (!url) throw new VideoStudioError("The voice-over could not be opened. Please try again.", "unavailable", 503);
    const row = await prisma.voiceClip.findUnique({ where: { businessId_hash: { businessId: owner.businessId, hash } }, select: { id: true } });
    if (row) await prisma.videoJob.update({ where: { id: job.id }, data: { voiceClipId: row.id } });
    const voice: JobVoice = { url, spec: fitted.spec, cues: fitted.cues, fits: fitted.fits, cached, durationMs: clip.durationMs, characters: clip.characters, spokenLanguage, note };
    return { voice, credits: cached ? 0 : VOICE_OVER_CREDITS };
  };

  // A take the company already has costs nothing (its file must really be there).
  const known = await prisma.voiceClip.findUnique({ where: { businessId_hash: { businessId: owner.businessId, hash } } });
  if (known?.status === "ready" && (await fileExists(known.path))) return answer(known, true);

  // Credits first, held on the job (one voice reservation per job at a time); given back whenever the voice service is
  // not paid by this request, and only by whoever clears the reservation (this request, or the sweep once it is stale).
  const reservation = await consumeUsage(owner.userId, "videoCredits", VOICE_OVER_CREDITS);
  const reservedAt = new Date();
  const held = await prisma.videoJob
    .updateMany({ where: { id: job.id, voiceCredits: 0 }, data: { voiceCredits: VOICE_OVER_CREDITS, voicePeriodStart: reservation.periodStart, voiceReservedAt: reservedAt } })
    .catch(async (error: unknown) => {
      await refundUsage(owner.userId, "videoCredits", reservation.periodStart, VOICE_OVER_CREDITS).catch(() => {});
      throw error;
    });
  if (held.count !== 1) {
    await refundUsage(owner.userId, "videoCredits", reservation.periodStart, VOICE_OVER_CREDITS).catch(() => {});
    throw new VideoStudioError("The voice-over of this video is being made right now. Try again in a moment.", "unavailable", 409);
  }
  const release = () => prisma.videoJob.updateMany({ where: { id: job.id, voiceReservedAt: reservedAt, voiceCredits: { gt: 0 } }, data: { voiceCredits: 0, voicePeriodStart: null, voiceReservedAt: null } });
  const giveBack = async () => {
    // Not cleared (a database blip): the reservation stays, and the sweep gives it back later.
    const { count } = await release().catch(() => ({ count: 0 }));
    if (count === 1) await refundUsage(owner.userId, "videoCredits", reservation.periodStart, VOICE_OVER_CREDITS).catch(() => {});
  };
  let claim: Awaited<ReturnType<typeof claimClip>>;
  try {
    claim = await claimClip(clipOwner, hash, voiceId, text.length);
  } catch (error) {
    await giveBack();
    throw error;
  }
  if (claim === "busy") {
    await giveBack();
    throw new VideoStudioError("This voice-over is being made right now. Try again in a moment.", "unavailable", 409);
  }
  if (claim !== "claimed") {
    const clip = (await prisma.voiceClip.findUnique({ where: { businessId_hash: { businessId: owner.businessId, hash } } }))!;
    if (clip.status === "ready" && (await fileExists(clip.path))) {
      await giveBack();
      return answer(clip, true);
    }
    if (clip.status === "spoken" && clip.pendingAudio) {
      // Paid by an earlier request but not stored yet: stored now, free.
      await giveBack();
      const audio = new Uint8Array(clip.pendingAudio);
      const path = await storeAudio(clipOwner, hash, audio).catch(() => null);
      return answer({ ...clip, path }, true, audio);
    }
    // A ready row whose file is gone, or a take a content video found too long for its plan: spoken again here.
    await prisma.voiceClip.updateMany({ where: { businessId: owner.businessId, hash, status: clip.status }, data: { status: "speaking", path: null, updatedAt: new Date() } });
  }

  let spoken: TtsResult | null = null;
  try {
    spoken = await withLedger(
      { userId: owner.actorId, businessId: owner.businessId, feature: VIDEO_LEDGER_FEATURES.voice },
      { provider: tts.name, model: tts.model },
      async () => (spoken = await tts.speak({ text, voiceId })),
      (r) => ({ provider: r.provider, model: r.model, usage: { inputTokens: r.characters, outputTokens: 0 } }),
    );
  } catch (error) {
    if (!spoken) {
      // The voice service was not paid: the credits go back and the claim is released for a later try.
      await giveBack();
      await prisma.voiceClip.deleteMany({ where: { businessId: owner.businessId, hash, status: "speaking" } }).catch(() => {});
      if (error instanceof ServiceDisabledError) throw new VideoStudioError("Voice-over is paused right now. Your credits are back; the MP4 can be made without it.", "unavailable", 503);
      if (error instanceof AIBudgetExceededError) throw new VideoStudioError("The voice-over is not available this month. Your credits are back; the MP4 can be made without it.", "unavailable", 503);
      await logError(error, { source: "video.voice", level: "warn", businessId: owner.businessId });
      throw new VideoStudioError("The voice-over could not be made just now. Your credits are back; please try again.", "unavailable", 502);
    }
    // Spoken (and paid), only the ledger write failed: the take is kept and used.
    await logError(error, { source: "video.voice.ledger", level: "warn", businessId: owner.businessId });
  }

  // Paid from here on: the credits stay taken (the reservation is settled), and the audio is kept before anything else.
  const result = spoken as TtsResult;
  const settled = await release().catch(() => ({ count: 0 }));
  if (settled.count !== 1) await logError(new Error("voice reservation already settled"), { source: "video.voice.settle", level: "warn", businessId: owner.businessId, jobId: job.id });
  const timings = lineTimings(ranges, result.charStartsMs, result.charEndsMs);
  await prisma.voiceClip.updateMany({
    where: { businessId: owner.businessId, hash },
    data: { status: "spoken", pendingAudio: Buffer.from(result.audio), bytes: result.audio.length, characters: result.characters, durationMs: result.durationMs, timings: timings as unknown as Prisma.InputJsonValue },
  });
  let path: string | null = null;
  try {
    path = await storeAudio(clipOwner, hash, result.audio);
  } catch (error) {
    // Not stored (quota, storage): this MP4 still gets the voice, and the next request stores it from the kept audio.
    await logError(error, { source: "video.voice.store", level: "warn", businessId: owner.businessId });
  }
  return answer({ path, durationMs: result.durationMs, characters: result.characters, timings }, false, result.audio);
}
