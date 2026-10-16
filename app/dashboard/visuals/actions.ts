"use server";

import { z } from "zod";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { remakeContentVisuals } from "@/lib/visuals/content";
import { finalizeVideo, leaseVideoForBrowser, markVideoFailed, prepareVideoUpload, removeVisual, renderImageStep, updateImageVisual, updateVideoPlan } from "@/lib/visuals/service";
import { activeTracks } from "@/lib/music/service";
import { featureStatus } from "@/lib/entitlements";
import { getUsageSummary } from "@/lib/usage";
import { audioUrlsFor } from "@/lib/visuals/robot";
import { SCRIPT_RULES } from "@/lib/visuals/script";
import { VISUAL_LIMITS, type VideoPlan } from "@/lib/visuals/types";
import { renderPhotoUrls, setVideoMusic } from "@/lib/visuals/sound";
import { ensureVoiceover, regenerateVoiceover, setVideoVoice } from "@/lib/voice/service";

// Content visuals (docs/CONTENT_VISUALS.md): drawing the picture, the owner's changes, and the browser-made video.
// Every action works inside the signed-in person's company (knowledgeAction), with the `content` permission and feature.

const id = z.string().min(1).max(60);
const GUARD = { permission: "content" as const, feature: "content" as const, limit: "knowledgeEdit" as const };
const BAD = { ok: false as const, error: "We could not find that picture." };

/** Draws the next slides of a pending picture (call again while it says "pending"). */
export async function renderVisual(visualId: string): Promise<Result<{ status: string; drawn: number; total: number; problem: string | null }>> {
  if (!id.safeParse(visualId).success) return BAD;
  return knowledgeAction({ ...GUARD, limit: undefined, source: "visuals.render" }, async ({ userId, businessId }) => {
    const r = await renderImageStep({ userId, businessId }, visualId);
    return { status: r.status, drawn: r.plan?.slides.filter((s) => s.path).length ?? 0, total: r.plan?.slides.length ?? 0, problem: r.error ?? null };
  });
}

/**
 * A new picture, video plan or both for a content version (fresh art direction). For a video, `script` is the owner's
 * own script; without it, content with no script gets one written by the AI first (one text generation).
 */
export async function remakeVisual(contentId: string, only?: "image" | "video", script?: string): Promise<Result<{ image: string | null; video: string | null }>> {
  if (!id.safeParse(contentId).success || (only && only !== "image" && only !== "video")) return BAD;
  if (script !== undefined && (typeof script !== "string" || only !== "video" || script.length > SCRIPT_RULES.maxLength)) return { ok: false, error: `Keep your script under ${SCRIPT_RULES.maxLength} characters.` };
  return knowledgeAction({ ...GUARD, source: "visuals.remake" }, ({ userId, businessId }) => remakeContentVisuals({ userId, businessId }, contentId, only, script === undefined ? {} : { script }));
}

const changesSchema = z.object({
  pack: z.string().max(20).optional(),
  template: z.string().max(30).optional(),
  slides: z
    .array(z.object({ index: z.number().int().min(0).max(VISUAL_LIMITS.maxCarouselSlides - 1), headline: z.string().max(300).optional(), subline: z.string().max(400).optional(), chip: z.string().max(100).optional() }))
    .max(VISUAL_LIMITS.maxCarouselSlides)
    .optional(),
  swap: z.object({ index: z.number().int().min(0).max(VISUAL_LIMITS.maxCarouselSlides - 1), photoPath: z.string().min(1).max(300) }).optional(),
  redesign: z.boolean().optional(),
});

/** "New design", style pack, template, slide texts or a photo swap; the changed slides are drawn again (free). */
export async function changeVisual(visualId: string, changes: z.input<typeof changesSchema>): Promise<Result<{ status: string }>> {
  const parsed = changesSchema.safeParse(changes);
  if (!id.safeParse(visualId).success || !parsed.success) return { ok: false, error: "Check the slide texts and try again." };
  return knowledgeAction({ ...GUARD, source: "visuals.change" }, async ({ userId, businessId }) => ({ status: (await updateImageVisual({ userId, businessId }, visualId, parsed.data)).status }));
}

/** Removes the picture or video from the content (files a post uses stay). */
export async function deleteVisual(visualId: string): Promise<Result> {
  if (!id.safeParse(visualId).success) return BAD;
  return knowledgeAction({ ...GUARD, source: "visuals.remove" }, async ({ userId, businessId }) => {
    await removeVisual({ userId, businessId }, visualId);
    return {};
  });
}

const videoChangesSchema = z.object({ texts: z.array(z.string().max(300)).max(10).optional(), photos: z.array(z.string().max(300).nullable()).max(10).optional() });

/** New captions (or photos) for the video's scenes; the video is made again. */
export async function changeVideo(visualId: string, changes: z.input<typeof videoChangesSchema>): Promise<Result> {
  const parsed = videoChangesSchema.safeParse(changes);
  if (!id.safeParse(visualId).success || !parsed.success) return { ok: false, error: "Check the captions and try again." };
  return knowledgeAction({ ...GUARD, source: "visuals.video.change" }, async ({ userId, businessId }) => {
    await updateVideoPlan({ userId, businessId }, visualId, parsed.data);
    return {};
  });
}

/**
 * The browser is about to make the video: it holds it (unless the video robot is making it right now), its voiceover
 * is made or reused (docs/VOICE_AND_MUSIC.md), and the plan to render comes back with its photo and sound URLs.
 */
export async function startVideoRender(visualId: string): Promise<Result<{ plan: VideoPlan | null; photoUrls: Record<string, string>; audioUrls: { voice?: string; music?: string } }>> {
  if (!id.safeParse(visualId).success) return BAD;
  return knowledgeAction({ ...GUARD, source: "visuals.video.lease" }, async ({ userId, businessId }) => {
    await leaseVideoForBrowser({ userId, businessId }, visualId);
    const voiced = await ensureVoiceover({ userId, businessId }, visualId);
    if (!voiced) return { plan: null, photoUrls: {}, audioUrls: {} };
    return { plan: voiced.plan, photoUrls: await renderPhotoUrls(userId, voiced.plan), audioUrls: await audioUrlsFor(businessId, voiced.plan, voiced.voiceDataUrl) };
  });
}

/** The owner's voiceover choices for one video (on or off, which voice); the video is made again with them. */
export async function changeVideoVoice(visualId: string, choice: { enabled: boolean; voiceId?: string | null; regenerate?: boolean }): Promise<Result> {
  if (!id.safeParse(visualId).success || typeof choice?.enabled !== "boolean") return BAD;
  return knowledgeAction({ ...GUARD, source: "visuals.video.voice" }, async ({ userId, businessId }) => {
    if (choice.regenerate) await regenerateVoiceover({ userId, businessId }, visualId);
    else await setVideoVoice({ userId, businessId }, visualId, { enabled: choice.enabled, voiceId: choice.voiceId ?? null });
    return {};
  });
}

/** Another library track for one video, or none (null). */
export async function changeVideoMusic(visualId: string, trackId: string | null): Promise<Result> {
  if (!id.safeParse(visualId).success || (trackId !== null && !id.safeParse(trackId).success)) return BAD;
  return knowledgeAction({ ...GUARD, source: "visuals.video.music" }, async ({ businessId }) => {
    await setVideoMusic(businessId, visualId, trackId);
    return {};
  });
}

const fileSchema = z.object({ bytes: z.number().int().positive(), mimeType: z.string().max(40), durationMs: z.number().positive().max(120_000) });

/** Checks the video the browser made and gives it a place to upload to. */
export async function startVideoUpload(visualId: string, file: z.input<typeof fileSchema>): Promise<Result<{ path: string; token: string; seconds: number }>> {
  const parsed = fileSchema.safeParse(file);
  if (!id.safeParse(visualId).success || !parsed.success) return { ok: false, error: "That video could not be used." };
  return knowledgeAction({ ...GUARD, source: "visuals.video.upload" }, async ({ userId, businessId }) => {
    const { path, token, seconds } = await prepareVideoUpload({ userId, businessId }, visualId, parsed.data);
    return { path, token, seconds };
  });
}

/** Confirms the uploaded video: it becomes the content's video (and goes on its Autopilot posts). */
export async function finishVideoUpload(visualId: string, input: { path: string; durationMs: number }): Promise<Result<{ path: string; seconds: number }>> {
  const parsed = z.object({ path: z.string().min(1).max(300), durationMs: z.number().positive().max(120_000) }).safeParse(input);
  if (!id.safeParse(visualId).success || !parsed.success) return { ok: false, error: "That video could not be used." };
  return knowledgeAction({ ...GUARD, source: "visuals.video.finish" }, ({ userId, businessId }) => finalizeVideo({ userId, businessId }, visualId, parsed.data));
}

/** The browser could not make the video: remember why, so the picture version is shown with the reason. */
export async function reportVideoFailure(visualId: string, message: string): Promise<Result> {
  if (!id.safeParse(visualId).success) return BAD;
  return knowledgeAction({ ...GUARD, source: "visuals.video.failed" }, async ({ userId, businessId }) => {
    await markVideoFailed({ userId, businessId }, visualId, String(message ?? "").slice(0, 300));
    return {};
  });
}

/** What the video panel's sound choices need: the library's tracks, the voices, and the voiceover characters used. */
export async function loadSoundOptions(): Promise<Result<{ tracks: { id: string; title: string; moods: string[] }[]; voiceInPlan: boolean; used: number; limit: number }>> {
  return knowledgeAction({ permission: "content", feature: "content", source: "visuals.sound.options" }, async ({ userId, businessId }) => {
    const [tracks, voice, usage] = await Promise.all([activeTracks().catch(() => []), featureStatus(businessId, "voice").catch(() => "plan_unknown"), getUsageSummary(userId).catch(() => null)]);
    return { tracks: tracks.map((t) => ({ id: t.id, title: t.title, moods: t.moods })), voiceInPlan: voice === "ok", used: usage?.used.voiceCharacters ?? 0, limit: usage?.limits.voiceCharacters ?? 0 };
  });
}
