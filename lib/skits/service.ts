// Talking skits (the Skit model in prisma/schema.prisma). On the plan's skit days (lib/skits/schedule.ts) BuPulse
// writes a short skit from the business and its subject of the day; the Posts page shows it as "Record your skit"
// with the lines, and the client is told (email and phone notification). The client records one voice note per
// speaker (or sends a WhatsApp voice note); with Admin -> Settings "Skit videos" on, the voices go to Seedance 2.0
// reference-to-video on Higgsfield (lib/skits/higgsfield.ts) and the finished video becomes posts waiting for approval,
// like the daily posts. Off (the default until the owner's lip-sync test), the skit waits as "Voice received". A skit
// not recorded by the end of its day moves to the next day, like a post (3 moves, then EXPIRED).
// The video-jobs cron runs the sweep (lib/skits/sweep.ts): carry-over, writing, notices, starting and checking videos.
import "server-only";
import { adminEmails } from "@/lib/admin/auth";
import { getSetting } from "@/lib/admin/settings";
import { getTextProvider } from "@/lib/ai";
import { withLedger } from "@/lib/ai/ledger";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { autoSchedule } from "@/lib/content-board/auto";
import { carryStep } from "@/lib/content-board/carry-over";
import { dateDay, dayDate } from "@/lib/content-flow/day";
import { getContentLanguages } from "@/lib/content-languages/service";
import { pickLanguage } from "@/lib/content-languages/settings";
import { chooseSubject, READY_HOUR, type Subject } from "@/lib/daily-posts/plan";
import { dailyApps, readDailySettings } from "@/lib/daily-posts/settings";
import { prisma } from "@/lib/db";
import { featureStatus } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { writerKnowledge } from "@/lib/knowledge/writer-context";
import { writingSubject } from "@/lib/knowledge/service";
import { getPlanLimits, getPlans } from "@/lib/plan-catalog";
import { skitsPerWeekLimit } from "@/lib/plans";
import { accountUsable } from "@/lib/publishing/service";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { dayKey, zonedParts } from "@/lib/publishing/time";
import { pushToLeadWatchers } from "@/lib/push/service";
import { pagesFirst } from "@/lib/social/choices";
import { isNetwork } from "@/lib/social/registry";
import type { Network } from "@/lib/social/types";
import { configuredModel } from "@/lib/studio/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { alertRecipients } from "@/lib/team/recipients";
import { mediaForPost } from "@/lib/visuals/post-media";
import { higgsfieldConfigured, HiggsfieldError, SKIT_MODEL, skitVideoStatus, submitSkitVideo } from "./higgsfield";
import { skitVideoPrompt } from "./prompt";
import { isSkitDay } from "./schedule";
import { checkVoice, MAX_OPEN_EXTRAS, missingVoices, readLines, readSpeakers, SKIT_SECONDS, type SkitStatus } from "./shared";
import { writeSkit, type SkitRequest } from "./writer";

const BUCKET = "media";
/** A failed write is tried this many times in all. */
export const MAX_WRITE_ATTEMPTS = 3;
/** A WRITING row quiet this long died (one text call takes seconds); it is retaken. */
export const STALE_WRITE_MS = 15 * 60 * 1000;
/** A video still not ready after this long is given up (Seedance takes minutes). */
export const VIDEO_TIMEOUT_MS = 3 * 60 * 60 * 1000;
/** The biggest finished video copied to storage (the media bucket takes 10 MB; a 10 s 480p clip is 2 to 5 MB). */
const VIDEO_MAX_BYTES = 10 * 1024 * 1024;
/** Networks a skit video goes to: the ones that post video. */
const VIDEO_NETWORKS: readonly Network[] = ["instagram", "facebook", "tiktok", "youtube"];
const DEFAULT_SKIT_NETWORKS: readonly Network[] = ["instagram", "facebook"];

export class SkitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkitError";
  }
}

const isDuplicate = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

// ---- The plan --------------------------------------------------------------------------------------------------------

/** Skits a week the company's plan makes: 0 without them, or without the Video feature usable now. */
export async function companySkitsPerWeek(businessId: string): Promise<number> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { user: { select: { subscription: { select: { plan: true } } } } } });
  const plan = business?.user.subscription?.plan;
  if (!plan) return 0;
  const perWeek = skitsPerWeekLimit(await getPlanLimits(plan));
  if (perWeek === 0) return 0;
  return (await featureStatus(businessId, "video")) === "ok" ? perWeek : 0;
}

/** The skit switch: real videos only with Admin -> Settings "Skit videos" on and Higgsfield's key set. */
export async function skitVideosOn(): Promise<boolean> {
  return higgsfieldConfigured() && (await getSetting("skitVideos"));
}

// ---- Writing ---------------------------------------------------------------------------------------------------------

/** Takes the day's skit for writing, or null when it is written, being written, or failed too often. */
export async function claimSkit(businessId: string, day: string, now: Date): Promise<{ id: string } | null> {
  const date = dayDate(day);
  try {
    return await prisma.skit.create({ data: { businessId, day: date, plannedDay: date, status: "WRITING" }, select: { id: true } });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
  }
  const row = await prisma.skit.findUnique({ where: { businessId_day_slot: { businessId, day: date, slot: 0 } }, select: { id: true, status: true, attempts: true, updatedAt: true } });
  if (!row || row.attempts >= MAX_WRITE_ATTEMPTS) return null;
  const stale = row.status === "WRITING" && now.getTime() - row.updatedAt.getTime() > STALE_WRITE_MS;
  if (!(stale || row.status === "WRITE_FAILED")) return null;
  // Compare-and-set, so two runs cannot both take it.
  const { count } = await prisma.skit.updateMany({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt }, data: { status: "WRITING", attempts: { increment: 1 }, error: null } });
  return count === 1 ? { id: row.id } : null;
}

async function subjectsFor(businessId: string, day: string): Promise<Subject[]> {
  const date = dayDate(day);
  const [campaigns, products] = await Promise.all([
    prisma.campaign.findMany({
      where: { businessId, status: "ACTIVE", AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: date } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: date } }] }] },
      orderBy: { createdAt: "asc" },
      take: 30,
      select: { id: true },
    }),
    prisma.product.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 60, select: { id: true } }),
  ]);
  return [...campaigns.map((c) => ({ kind: "campaign" as const, id: c.id })), ...products.map((p) => ({ kind: "product" as const, id: p.id })), { kind: "general" as const }];
}

/**
 * Writes one company's skit for its local day (claimed: once per company and day). The subject rotates over its
 * running campaigns, products and General like the daily posts; the lines are in the skit language
 * (lib/content-languages). Returns the skit id, or null when there was nothing to do.
 */
export async function writeDaySkit(businessId: string, day: string, now = new Date()): Promise<string | null> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, userId: true, name: true, description: true, industryDescription: true } });
  if (!business) return null;
  const claim = await claimSkit(businessId, day, now);
  if (!claim) return null;
  try {
    const recent = await prisma.skit.findMany({ where: { businessId, id: { not: claim.id }, status: { notIn: ["WRITING", "WRITE_FAILED", "ORDERED"] } }, orderBy: { day: "desc" }, take: 20, select: { title: true, subjectKind: true, subjectId: true } });
    const subject = chooseSubject(await subjectsFor(businessId, day), recent.map((r) => ({ kind: r.subjectKind, id: r.subjectId })));
    const [about, kb] = await Promise.all([subject && subject.kind !== "general" ? writingSubject(businessId, subject) : null, writerKnowledge(businessId)]);
    const language = pickLanguage((await getContentLanguages(businessId)).skits, { dayKey: day });
    const request: SkitRequest = {
      businessName: business.name,
      description: business.description ?? business.industryDescription ?? null,
      language,
      subject: about ? { title: about.title, context: about.context, price: about.price } : null,
      knowledgeBase: kb.knowledgeBase,
      voiceProfile: kb.voiceProfile,
      recent: recent.map((r) => r.title).filter(Boolean),
    };
    const configured = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();
    const { skit } = await withLedger({ userId: business.userId, businessId, feature: "skits" }, { provider: configured, model: configuredModel(configured) }, () => writeSkit(getTextProvider(), request), (r) => ({ provider: r.provider, model: r.model, usage: r.usage }));
    await prisma.skit.update({
      where: { id: claim.id },
      data: {
        status: "WAITING_VOICE",
        language,
        title: skit.title,
        scene: skit.scene,
        speakers: skit.speakers,
        lines: skit.lines,
        caption: skit.caption,
        hashtags: skit.hashtags,
        subjectKind: subject?.kind ?? "general",
        subjectId: subject && "id" in subject ? subject.id : null,
        voicePaths: skit.speakers.map(() => ""),
        error: null,
      },
    });
    return claim.id;
  } catch (error) {
    await logError(error, { source: "skits.write", businessId, level: "warn" });
    await prisma.skit.update({ where: { id: claim.id }, data: { status: "WRITE_FAILED", error: "The skit could not be written; it is tried again later." } }).catch(() => {});
    return null;
  }
}

// ---- Carry-over and notices ------------------------------------------------------------------------------------------

export type SkitCarry = { moved: number; expired: number };

/**
 * Skits still waiting for the voice after their day move to the business's today (and are announced again), like
 * missed posts (lib/content-board/carry-over.ts): after MAX_CARRY_OVERS moves the next miss makes them EXPIRED.
 */
export async function carryOverSkits(now = new Date()): Promise<SkitCarry> {
  const out: SkitCarry = { moved: 0, expired: 0 };
  const rows = await prisma.skit.findMany({
    where: { status: "WAITING_VOICE", plannedDay: { lt: dayDate(dayKey(now, "Pacific/Kiritimati")) } },
    orderBy: { plannedDay: "asc" },
    take: 200,
    select: { id: true, plannedDay: true, carryCount: true, updatedAt: true, business: { select: { timezone: true } } },
  });
  for (const r of rows) {
    const today = dayKey(now, r.business.timezone || "UTC");
    if (dateDay(r.plannedDay) >= today) continue;
    const guard = { id: r.id, status: "WAITING_VOICE", updatedAt: r.updatedAt };
    if (carryStep(r.carryCount) === "expire") {
      out.expired += (await prisma.skit.updateMany({ where: guard, data: { status: "EXPIRED" } })).count;
    } else {
      out.moved += (await prisma.skit.updateMany({ where: guard, data: { plannedDay: dayDate(today), carryCount: r.carryCount + 1, notifiedAt: null } })).count;
    }
  }
  return out;
}

/** "Record your skit for today", once per skit and day, from READY_HOUR local. Returns whether it went out. */
export async function sendSkitNotice(skitId: string, now = new Date()): Promise<boolean> {
  const skit = await prisma.skit.findUnique({ where: { id: skitId }, select: { id: true, status: true, plannedDay: true, notifiedAt: true, businessId: true, business: { select: { name: true, timezone: true, user: { select: { email: true } } } } } });
  if (!skit || skit.status !== "WAITING_VOICE" || skit.notifiedAt) return false;
  const zone = skit.business.timezone || "UTC";
  if (dateDay(skit.plannedDay) !== dayKey(now, zone) || zonedParts(now, zone).hour < READY_HOUR) return false;
  const { count } = await prisma.skit.updateMany({ where: { id: skit.id, notifiedAt: null }, data: { notifiedAt: now } });
  if (count === 0) return false;
  const title = "Record your skit for today";
  const body = `BuPulse wrote today's short skit for ${skit.business.name}. Open Posts, read the lines and record them with your voice (or send a WhatsApp voice note). BuPulse makes the video from it.`;
  const { html, text } = renderEmail({ heading: title, intro: body, button: { label: "Record your skit", url: `${publicSiteUrl()}/dashboard/content#skits` } });
  let any = false;
  for (const to of await alertRecipients(skit.businessId, skit.business.user.email)) {
    if (await sendEmail({ to, subject: title, html, text }).catch(() => false)) any = true;
  }
  if ((await pushToLeadWatchers(skit.businessId, { title, body: body.slice(0, 180), url: "/dashboard/content#skits", tag: `skit-${skit.id}` }).catch(() => 0)) > 0) any = true;
  return any;
}

// ---- The voice -------------------------------------------------------------------------------------------------------

const storage = () => createAdminClient().storage.from(BUCKET);

/**
 * Saves one speaker's voice note (1-based `speaker`) for a skit of the company, in the company account's folder. When
 * every speaker has one, the skit is VOICE_RECEIVED and its video starts (when the switch is on). A voice may be
 * recorded again until the video is being made.
 */
export async function saveSkitVoice(owner: { userId: string; businessId: string }, skitId: string, speaker: number, file: { type: string; size: number; name?: string; bytes: Uint8Array }, now = new Date()): Promise<{ status: SkitStatus; missing: number[] }> {
  const check = checkVoice(file);
  if (!check.ok) throw new SkitError(check.error);
  const skit = await prisma.skit.findFirst({ where: { id: skitId, businessId: owner.businessId }, select: { id: true, status: true, speakers: true, voicePaths: true, updatedAt: true } });
  if (!skit) throw new SkitError("We could not find that skit.");
  if (skit.status !== "WAITING_VOICE" && skit.status !== "VOICE_RECEIVED") throw new SkitError(skit.status === "MAKING" || skit.status === "READY" ? "This skit's video is already being made." : "This skit cannot take a voice now.");
  const count = readSpeakers(skit.speakers).length;
  if (!Number.isInteger(speaker) || speaker < 1 || speaker > count) throw new SkitError("Choose who is speaking.");

  const path = `${owner.userId}/skits/${skit.id}-${speaker}-${globalThis.crypto.randomUUID()}.${check.ext}`;
  const { error } = await storage().upload(path, file.bytes, { contentType: check.mime, upsert: false });
  if (error) throw new SkitError("We could not save the recording. Try again.");

  const paths = Array.from({ length: count }, (_, i) => skit.voicePaths[i] ?? "");
  const old = paths[speaker - 1];
  paths[speaker - 1] = path;
  const missing = missingVoices(count, paths);
  const status: SkitStatus = missing.length === 0 ? "VOICE_RECEIVED" : "WAITING_VOICE";
  // Compare-and-set: a second voice saved at the same moment must not overwrite this one.
  const { count: saved } = await prisma.skit.updateMany({ where: { id: skit.id, updatedAt: skit.updatedAt, status: skit.status }, data: { voicePaths: paths, status, voiceAt: status === "VOICE_RECEIVED" ? now : null, error: null } });
  if (saved === 0) {
    await storage().remove([path]).catch(() => {});
    throw new SkitError("The skit changed while saving. Try again.");
  }
  if (old) await storage().remove([old]).catch(() => {});
  if (status === "VOICE_RECEIVED") await startSkitVideo(skit.id, now).catch((e) => logError(e, { source: "skits.start", businessId: owner.businessId, level: "warn" }));
  return { status, missing };
}

// ---- The video -------------------------------------------------------------------------------------------------------

async function signedUrl(bucket: "media" | "brand", path: string): Promise<string | null> {
  const { data } = await createAdminClient().storage.from(bucket).createSignedUrl(path, 2 * 60 * 60);
  return data?.signedUrl ?? null;
}

/**
 * Sends a recorded skit to Higgsfield (compare-and-set VOICE_RECEIVED -> MAKING). Does nothing while the switch is off:
 * the skit stays "Voice received — video coming soon" and the sweep starts it once the switch is turned on.
 */
export async function startSkitVideo(skitId: string, now = new Date()): Promise<"started" | "off" | "not_ready" | "failed"> {
  if (!(await skitVideosOn())) return "off";
  const skit = await prisma.skit.findUnique({ where: { id: skitId }, select: { id: true, status: true, updatedAt: true, businessId: true, scene: true, speakers: true, lines: true, language: true, subjectKind: true, subjectId: true, voicePaths: true, business: { select: { name: true, userId: true, logoUrl: true } } } });
  if (!skit || skit.status !== "VOICE_RECEIVED") return "not_ready";
  const { count } = await prisma.skit.updateMany({ where: { id: skit.id, status: "VOICE_RECEIVED", updatedAt: skit.updatedAt }, data: { status: "MAKING", taskStartedAt: now, taskId: null, error: null } });
  if (count === 0) return "not_ready";
  const speakers = readSpeakers(skit.speakers);
  try {
    const subject = skit.subjectKind === "product" || skit.subjectKind === "campaign" ? (skit.subjectId ? await writingSubject(skit.businessId, { kind: skit.subjectKind, id: skit.subjectId }) : null) : null;
    const audio = await Promise.all(skit.voicePaths.slice(0, speakers.length).map((p) => signedUrl("media", p)));
    if (audio.some((u) => !u)) throw new HiggsfieldError("A voice note could not be read.", false);
    const images = (await Promise.all([...(subject?.photoPaths ?? []).slice(0, 4).map((p) => signedUrl("media", p)), skit.business.logoUrl ? signedUrl("brand", skit.business.logoUrl) : null])).filter((u): u is string => !!u);
    const prompt = skitVideoPrompt({ businessName: skit.business.name, scene: skit.scene, speakers, lines: readLines(skit.lines, speakers.length), language: skit.language, imageCount: images.length });
    const taskId = await withLedger(
      { userId: skit.business.userId, businessId: skit.businessId, feature: "skits" },
      { provider: "higgsfield", model: SKIT_MODEL },
      () => submitSkitVideo({ prompt, imageUrls: images, audioUrls: audio as string[], seconds: SKIT_SECONDS }),
      // Higgsfield bills in credits, entered as its monthly bill in Admin -> Money -> Costs.
      () => ({ provider: "higgsfield", model: SKIT_MODEL, usage: { inputTokens: 0, outputTokens: 0 } }),
    );
    await prisma.skit.update({ where: { id: skit.id }, data: { taskId } });
    return "started";
  } catch (error) {
    const retry = !(error instanceof HiggsfieldError) || error.retryable;
    await logError(error, { source: "skits.start", businessId: skit.businessId, level: "warn" });
    // A passing problem: back to "Voice received", tried again by the next sweep. Otherwise it waits for BuPulse.
    await prisma.skit.update({ where: { id: skit.id }, data: retry ? { status: "VOICE_RECEIVED", taskStartedAt: null, error: "The video could not start yet; it is tried again shortly." } : { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 300) : "The video could not be made." } });
    return "failed";
  }
}

/** The posts a finished skit becomes: one per video app the daily posts go to, waiting for approval (or scheduled). */
async function createSkitPosts(skit: { id: string; businessId: string; caption: string; hashtags: string[]; subjectKind: string | null; subjectId: string | null; plannedDay: Date }, videoPath: string, now: Date): Promise<string[]> {
  const [business, connections] = await Promise.all([
    prisma.business.findUnique({ where: { id: skit.businessId }, select: { dailyPostSettings: true, timezone: true } }),
    prisma.connection.findMany({ where: { businessId: skit.businessId, kind: "SOCIAL" }, orderBy: { createdAt: "asc" } }),
  ]);
  const usable = pagesFirst(connections).filter((c) => isNetwork(c.provider) && accountUsable(c));
  const picked = dailyApps(readDailySettings(business?.dailyPostSettings), usable.map((c) => c.provider as Network)).filter((n) => VIDEO_NETWORKS.includes(n));
  const networks = picked.length ? picked : [...DEFAULT_SKIT_NETWORKS];
  const today = dayKey(now, business?.timezone || "UTC");
  const rows: Prisma.PostCreateManyInput[] = networks.map((network) => {
    const connection = usable.find((c) => c.provider === network) ?? null;
    const media = mediaForPost({ network, format: "SCRIPT", rules: { formats: ["POST"], maxImages: 1, videoOnly: true }, images: [], video: videoPath });
    return {
      businessId: skit.businessId,
      connectionId: connection?.id ?? null,
      remindOnly: connection === null,
      network,
      groupId: `skit-${skit.id}`,
      productId: skit.subjectKind === "product" ? skit.subjectId : null,
      campaignId: skit.subjectKind === "campaign" ? skit.subjectId : null,
      status: "PENDING_APPROVAL",
      format: media.format,
      source: "DAILY",
      text: skit.caption,
      hashtags: skit.hashtags,
      mediaPaths: media.mediaPaths,
      plannedDay: dayDate(today),
      ...(media.note ? { reviewNote: media.note } : {}),
    };
  });
  const created = await prisma.$transaction(rows.map((data) => prisma.post.create({ data, select: { id: true } })));
  await autoSchedule(skit.businessId, created.map((p) => p.id), now).catch((e) => logError(e, { source: "skits.auto", businessId: skit.businessId, level: "warn" }));
  return created.map((p) => p.id);
}

/** Checks one skit being made: a finished video is copied to storage and becomes posts (READY). */
export async function checkSkitVideo(skitId: string, now = new Date()): Promise<"waiting" | "ready" | "failed" | "skipped"> {
  const skit = await prisma.skit.findUnique({ where: { id: skitId }, select: { id: true, status: true, taskId: true, taskStartedAt: true, updatedAt: true, businessId: true, caption: true, hashtags: true, subjectKind: true, subjectId: true, plannedDay: true, business: { select: { userId: true } } } });
  if (!skit || skit.status !== "MAKING" || !skit.taskId) return "skipped";
  const fail = async (error: string) => {
    await prisma.skit.updateMany({ where: { id: skit.id, status: "MAKING" }, data: { status: "FAILED", error: error.slice(0, 300) } });
    return "failed" as const;
  };
  let status;
  try {
    status = await skitVideoStatus(skit.taskId);
  } catch (error) {
    if (error instanceof HiggsfieldError && !error.retryable) return fail(error.message);
    return "waiting";
  }
  if (status.status === "waiting") {
    return skit.taskStartedAt && now.getTime() - skit.taskStartedAt.getTime() > VIDEO_TIMEOUT_MS ? fail("The video took too long to make.") : "waiting";
  }
  if (status.status === "failed" || !status.videoUrl) return fail(status.error ?? "The video could not be made.");
  // Claimed before the copy, so two sweeps never make the posts twice.
  const { count } = await prisma.skit.updateMany({ where: { id: skit.id, status: "MAKING", updatedAt: skit.updatedAt }, data: { taskId: null } });
  if (count === 0) return "skipped";
  try {
    const res = await fetch(status.videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`the video download answered ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > VIDEO_MAX_BYTES) return fail("The finished video is too big to keep.");
    const path = `${skit.business.userId}/skits/${skit.id}.mp4`;
    const { error } = await storage().upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`storage: ${error.message}`);
    await createSkitPosts(skit, path, now);
    await prisma.skit.update({ where: { id: skit.id }, data: { status: "READY", videoPath: path, postGroupId: `skit-${skit.id}`, error: null } });
    return "ready";
  } catch (error) {
    await logError(error, { source: "skits.finish", businessId: skit.businessId });
    return fail("The finished video could not be saved.");
  }
}

// ---- Extra skits -----------------------------------------------------------------------------------------------------

/**
 * "Order an extra skit — 5,000 RWF": a request for now (no payment code). It is kept as an ORDERED skit and BuPulse's
 * admins get an email; once paid, BuPulse writes it for the company.
 */
export async function orderExtraSkit(owner: { userId: string; businessId: string }, now = new Date()): Promise<{ id: string }> {
  const business = await prisma.business.findUnique({ where: { id: owner.businessId }, select: { name: true, timezone: true } });
  if (!business) throw new SkitError("We could not find your business.");
  const open = await prisma.skit.count({ where: { businessId: owner.businessId, extra: true, status: "ORDERED" } });
  if (open >= MAX_OPEN_EXTRAS) throw new SkitError(`You already have ${open} extra skits waiting. BuPulse will call you about them.`);
  const today = dayDate(dayKey(now, business.timezone || "UTC"));
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.skit.findFirst({ where: { businessId: owner.businessId, day: today }, orderBy: { slot: "desc" }, select: { slot: true } });
    try {
      const row = await prisma.skit.create({ data: { businessId: owner.businessId, day: today, plannedDay: today, slot: Math.max(1, (last?.slot ?? 0) + 1), extra: true, status: "ORDERED" }, select: { id: true } });
      await notifyAdminsOfOrder(business.name).catch((e) => logError(e, { source: "skits.order", businessId: owner.businessId, level: "warn" }));
      return row;
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }
  }
  throw new SkitError("We could not save the order. Try again.");
}

async function notifyAdminsOfOrder(businessName: string) {
  const title = `Extra skit ordered: ${businessName}`;
  const { html, text } = renderEmail({ heading: title, intro: `${businessName} asked for an extra talking skit (5,000 RWF). Call them to confirm and take the payment.`, button: { label: "Open Admin", url: `${publicSiteUrl()}/admin` } });
  for (const to of adminEmails()) await sendEmail({ to, subject: title, html, text }).catch(() => false);
}

// ---- The Posts page --------------------------------------------------------------------------------------------------

export type SkitCard = {
  id: string;
  status: SkitStatus;
  extra: boolean;
  day: string;
  plannedDay: string;
  carryCount: number;
  title: string;
  language: string;
  speakers: { name: string; hasVoice: boolean }[];
  lines: { speaker: number; text: string }[];
  error: string | null;
};

/** The open skits on the Posts page: the ones to record, the ones waiting for their video, and extra orders. */
export async function loadSkitCards(businessId: string): Promise<SkitCard[]> {
  const rows = await prisma.skit.findMany({
    where: { businessId, status: { in: ["ORDERED", "WAITING_VOICE", "VOICE_RECEIVED", "MAKING", "FAILED"] } },
    orderBy: [{ plannedDay: "asc" }, { slot: "asc" }],
    take: 10,
    select: { id: true, status: true, extra: true, day: true, plannedDay: true, carryCount: true, title: true, language: true, speakers: true, lines: true, voicePaths: true, error: true },
  });
  return rows.map((r) => {
    const speakers = readSpeakers(r.speakers);
    return {
      id: r.id,
      status: r.status as SkitStatus,
      extra: r.extra,
      day: dateDay(r.day),
      plannedDay: dateDay(r.plannedDay),
      carryCount: r.carryCount,
      title: r.title,
      language: r.language,
      speakers: speakers.map((s, i) => ({ name: s.name, hasVoice: !!r.voicePaths[i] })),
      lines: readLines(r.lines, speakers.length),
      error: r.status === "FAILED" ? r.error : null,
    };
  });
}

// ---- Who is due (the sweep) ------------------------------------------------------------------------------------------

/** Companies whose plan makes skits, with how many a week (plans read from the catalog, one query for the companies). */
export async function skitCompanies(): Promise<{ id: string; timezone: string; perWeek: number }[]> {
  const plans = (await getPlans()).filter((p) => skitsPerWeekLimit(p.limits) > 0);
  if (plans.length === 0) return [];
  const perWeek = new Map(plans.map((p) => [p.key, skitsPerWeekLimit(p.limits)]));
  const rows = await prisma.business.findMany({
    where: { user: { deletionScheduledFor: null, suspendedAt: null, subscription: { status: { in: ["TRIALING", "ACTIVE"] }, plan: { in: [...perWeek.keys()] } } } },
    orderBy: { id: "asc" },
    take: 1000,
    select: { id: true, timezone: true, user: { select: { subscription: { select: { plan: true } } } } },
  });
  return rows.map((b) => ({ id: b.id, timezone: b.timezone || "UTC", perWeek: perWeek.get(b.user.subscription?.plan ?? "") ?? 0 }));
}

/** Whether today is this company's skit day with no skit written yet (or one to try again). */
export async function skitDue(company: { id: string; timezone: string; perWeek: number }, now: Date): Promise<string | null> {
  const day = dayKey(now, company.timezone);
  if (!isSkitDay(company.perWeek, day)) return null;
  const row = await prisma.skit.findUnique({ where: { businessId_day_slot: { businessId: company.id, day: dayDate(day), slot: 0 } }, select: { status: true, attempts: true, updatedAt: true } });
  if (!row) return day;
  if (row.attempts >= MAX_WRITE_ATTEMPTS) return null;
  if (row.status === "WRITE_FAILED") return day;
  return row.status === "WRITING" && now.getTime() - row.updatedAt.getTime() > STALE_WRITE_MS ? day : null;
}
