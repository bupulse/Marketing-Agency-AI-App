import "server-only";
import { prisma } from "@/lib/db";
import { accountUsable, createPosts, PublishingError, type Owner } from "@/lib/publishing/service";
import type { Network } from "@/lib/social/types";
import { scoreCaption, type CaptionScore } from "@/lib/video-engine/brain/score";
import { seedanceOverlayCaption } from "@/lib/video-engine/seedance-overlay";
import type { Ratio } from "@/lib/video-engine/spec";
import { withMusicCredit } from "@/lib/visuals/service";
import { loadBriefFacts } from "./brief";
import { VideoStudioError } from "./jobs";

// Scheduling a Video Studio MP4 (docs/VIDEO_APP_INTEGRATION.md, section 5, task 7): a studio video is a normal post with
// its one video in mediaPaths, made by createPosts (lib/publishing/service.ts) like the composer's, so every rule of
// the networks applies as it is (Instagram Reels and Facebook Page videos posted; TikTok and YouTube as the reminder
// with the video attached; the lengths; the queue). Each network gets its own caption: the design's own for the
// platform it was made for, else the Brain's caption for that network (seedanceOverlayCaption); the owner may change
// them, and each must pass the Brain's caption check (CAPTION_PASS) before anything is scheduled. A music credit line
// that the track's licence asks for goes at the end of every post.

/** The networks a studio video can go to. LinkedIn takes photos only from BuPulse. */
export const STUDIO_NETWORKS: readonly Network[] = ["instagram", "facebook", "tiktok", "youtube"];
/** The lowest caption check score a post may be scheduled with (the Brain's checks, lib/video-engine/brain/score.ts). */
export const CAPTION_PASS = 60;

const LABEL: Record<Network, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube Shorts", linkedin: "LinkedIn" };

export type NetworkCaption = { text: string; hashtags: string[]; score: number; missed: string[]; /** The design's own caption (made for this platform). */ own: boolean };
export type ScheduleAccount = { id: string; network: Network; name: string; usable: boolean };
export type ScheduleOptions = { accounts: ScheduleAccount[]; captions: Partial<Record<Network, NetworkCaption>>; credit: string | null; timezone: string };

async function readyJob(businessId: string, jobId: string) {
  const job = await prisma.videoJob.findFirst({
    where: { id: jobId, businessId, engine: "motion" },
    select: { id: true, status: true, videoPath: true, productId: true, caption: true, hashtags: true, platform: true, templateId: true, seconds: true, ratio: true, music: true, brief: true },
  });
  if (!job) throw new VideoStudioError("We could not find that video.", "not_found", 404);
  if (job.status !== "ready" || !job.videoPath || !job.productId) throw new VideoStudioError("Make the MP4 first: then it can be scheduled.", "invalid", 400);
  return job as typeof job & { videoPath: string; productId: string };
}

type Job = Awaited<ReturnType<typeof readyJob>>;
type Facts = Awaited<ReturnType<typeof loadBriefFacts>>;

const creditOf = (music: unknown): string | null => {
  const m = music as { attribution?: unknown; owned?: unknown } | null;
  return m && m.owned === false && typeof m.attribution === "string" && m.attribution.trim() ? m.attribution.trim() : null;
};

const scoreBrief = (job: Job, facts: Facts) => ({ business: facts.business, product: facts.product, styleId: job.templateId, seconds: job.seconds });

function check(job: Job, facts: Facts, network: Network, text: string, hashtags: string[]): CaptionScore {
  return scoreCaption(text, hashtags, scoreBrief(job, facts), { platform: network });
}

/** The caption a network starts with: the design's own when it was made for that platform (or for anywhere), else the Brain's. */
function defaultCaption(job: Job, facts: Facts, network: Network): NetworkCaption {
  const own = !job.platform || job.platform === network;
  if (own && job.caption.trim()) {
    const s = check(job, facts, network, job.caption, job.hashtags);
    return { text: job.caption, hashtags: job.hashtags, score: s.score, missed: s.missed, own: true };
  }
  const built = seedanceOverlayCaption({
    business: facts.business,
    product: facts.product,
    references: [],
    templateId: job.templateId ?? "product-hero",
    seconds: job.seconds,
    ratio: job.ratio as Ratio,
    audio: true,
    platform: network,
  });
  return { text: built.caption, hashtags: built.hashtags, score: built.score.score, missed: built.score.missed, own: false };
}

/** What the schedule step shows: the company's accounts a video can go to, each network's caption with its check, the music credit. */
export async function scheduleOptions(businessId: string, jobId: string): Promise<ScheduleOptions> {
  const job = await readyJob(businessId, jobId);
  const [facts, connections, business] = await Promise.all([
    loadBriefFacts(businessId, job.productId),
    prisma.connection.findMany({ where: { businessId, kind: "SOCIAL", provider: { in: [...STUDIO_NETWORKS] } }, orderBy: { createdAt: "asc" }, select: { id: true, provider: true, displayName: true, status: true, postingMode: true } }),
    prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } }),
  ]);
  const accounts = connections.map((c) => ({ id: c.id, network: c.provider as Network, name: c.displayName ?? LABEL[c.provider as Network], usable: accountUsable(c) }));
  const captions: Partial<Record<Network, NetworkCaption>> = {};
  for (const network of new Set(accounts.map((a) => a.network))) captions[network] = defaultCaption(job, facts, network);
  return { accounts, captions, credit: creditOf(job.music), timezone: business?.timezone || "UTC" };
}

export type ScheduleInput = {
  connectionIds: string[];
  when: { mode: "queue" } | { mode: "schedule"; local: string };
  /** The owner's captions per network (else each network's default). */
  captions?: Partial<Record<Network, { text: string; hashtags: string[] }>>;
};

/**
 * Schedules the MP4 on the chosen accounts: one post each (one group), each with its network's caption, which must
 * pass the caption check. Throws PublishingError (or VideoStudioError) in plain words; nothing is saved unless all pass.
 */
export async function scheduleJob(owner: Owner, jobId: string, input: ScheduleInput, now = new Date()) {
  const job = await readyJob(owner.businessId, jobId);
  const connections = await prisma.connection.findMany({ where: { id: { in: input.connectionIds }, businessId: owner.businessId, kind: "SOCIAL" }, select: { id: true, provider: true } });
  if (connections.length !== new Set(input.connectionIds).size || connections.length === 0) throw new PublishingError("Choose at least one connected account.", "not_found");
  const other = connections.find((c) => !STUDIO_NETWORKS.includes(c.provider as Network));
  if (other) throw new PublishingError(`${LABEL[other.provider as Network] ?? other.provider} takes photos only from BuPulse, so a studio video cannot go there.`, "invalid");

  const facts = await loadBriefFacts(owner.businessId, job.productId);
  const credit = creditOf(job.music);
  const networks = [...new Set(connections.map((c) => c.provider as Network))];
  const overrides: Record<string, { text: string; hashtags: string[] }> = {};
  const problems: string[] = [];
  for (const network of networks) {
    const given = input.captions?.[network];
    const chosen = given ? { text: given.text.trim(), hashtags: given.hashtags } : defaultCaption(job, facts, network);
    const s = check(job, facts, network, chosen.text, chosen.hashtags);
    if (s.score < CAPTION_PASS) problems.push(`${LABEL[network]} caption (${s.score}/100): ${s.missed.slice(0, 2).join(" ") || "add the product, the price and how to order."}`);
    overrides[network] = { text: withMusicCredit(chosen.text, credit), hashtags: chosen.hashtags };
  }
  if (problems.length) throw new PublishingError(`Improve the caption first. ${problems[0]}`, "invalid", { captions: problems.join(" ") });

  const first = overrides[networks[0]];
  return createPosts(owner, { connectionIds: input.connectionIds, text: first.text, hashtags: first.hashtags, overrides, mediaPaths: [job.videoPath], subjectId: job.productId, when: input.when }, now);
}

/** The posts already made from a job's MP4 (by its file), for the card: how many and when the next goes out. */
export async function scheduledPostsOf(businessId: string, videoPaths: string[]): Promise<Map<string, { count: number; next: Date | null }>> {
  const out = new Map<string, { count: number; next: Date | null }>();
  if (videoPaths.length === 0) return out;
  const posts = await prisma.post.findMany({ where: { businessId, mediaPaths: { hasSome: videoPaths }, status: { notIn: ["CANCELLED"] } }, select: { mediaPaths: true, scheduledAt: true, status: true }, take: 500 });
  for (const p of posts) {
    const path = p.mediaPaths.find((m) => videoPaths.includes(m));
    if (!path) continue;
    const cur = out.get(path) ?? { count: 0, next: null };
    cur.count += 1;
    if (p.status === "SCHEDULED" && p.scheduledAt && (!cur.next || p.scheduledAt < cur.next)) cur.next = p.scheduledAt;
    out.set(path, cur);
  }
  return out;
}
