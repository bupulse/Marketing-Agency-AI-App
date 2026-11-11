// Waiting posts that have no picture although their pictures are ready (owner report, 11 November 2026: three Daily
// posts said "No picture yet" while their pictures showed under "Pictures and videos"). Until then attachToContent
// reached only Studio's posts, so a Daily post's own picture, drawn per post before the day's shared sets, never got
// onto it; an attach can also miss a post that was locked or saved at the same moment.
// - findRepairs: the not-yet-posted posts (DRAFT / PENDING_APPROVAL, not edited by the owner, not being published) from
//   Studio, Daily posts and Autopilot with no media whose content or group has ready visuals that would fill them.
// - applyRepairs: puts them on through the normal attach (attachToContent / attachToGroup, limited to those posts), so
//   music credits and auto-approval work exactly as when a picture is finished.
// - healWaitingPosts: the same for the last few days' posts from the every-minute job loop, at most every 10 minutes.
// The tool scripts/self-host/tools/attach-ready-visuals.mjs runs the first two (dry run by default).
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { attachChange, attachToContent, attachToGroup, DRAFTED_SOURCES, readyMedia, type AttachChange, type AttachPost, type ReadyMedia } from "./service";

export const REPAIR_SOURCES = [...DRAFTED_SOURCES, "AUTOPILOT"] as const;
export const REPAIR_STATUSES = ["DRAFT", "PENDING_APPROVAL"] as const;

export type RepairPost = AttachPost & {
  id: string;
  businessId: string;
  source: string;
  contentId: string | null;
  groupId: string | null;
  ownerEditedAt: Date | null;
  lockedAt: Date | null;
};
export type RepairKey = { contentId: string } | { groupId: string };
export type Repair = { post: RepairPost; key: RepairKey; change: AttachChange; images: number; video: boolean };

/** One content row's or group's ready media, per business. */
export const mediaKey = (businessId: string, key: RepairKey) => `${businessId}|${"contentId" in key ? `c:${key.contentId}` : `g:${key.groupId}`}`;

/**
 * Where a post's pictures can come from, first match wins: its own content row's (a Studio or Daily post), then its
 * group's (a day's shared set, an Autopilot group). attachToContent never touches Autopilot's posts.
 */
export function keysOf(post: Pick<RepairPost, "source" | "contentId" | "groupId">): RepairKey[] {
  const keys: RepairKey[] = [];
  if (post.contentId && (DRAFTED_SOURCES as readonly string[]).includes(post.source)) keys.push({ contentId: post.contentId });
  if (post.groupId) keys.push({ groupId: post.groupId });
  return keys;
}

/**
 * Pure: the posts an attach would fill, from candidate posts and the ready media of their content rows and groups.
 * Only posts still waiting, untouched by the owner, not being published, from Studio / Daily / Autopilot, with no media
 * at all, and only when the attach would really give them a picture or video (attachChange, the same decision).
 */
export function pickRepairs(posts: readonly RepairPost[], media: ReadonlyMap<string, ReadyMedia>): Repair[] {
  const repairs: Repair[] = [];
  for (const post of posts) {
    if (!(REPAIR_STATUSES as readonly string[]).includes(post.status) || !(REPAIR_SOURCES as readonly string[]).includes(post.source)) continue;
    if (post.ownerEditedAt || post.lockedAt || post.mediaPaths.length > 0) continue;
    for (const key of keysOf(post)) {
      const ready = media.get(mediaKey(post.businessId, key));
      if (!ready) continue;
      const change = attachChange(post, ready);
      if (change && change.mediaPaths.length > 0) {
        repairs.push({ post, key, change, images: ready.images.length, video: !!ready.video });
        break;
      }
    }
  }
  return repairs;
}

/** The repairs due now (reads only). `since`: only posts made since then; `limit`: posts read at most. */
export async function findRepairs(options: { businessId?: string; since?: Date; limit?: number } = {}): Promise<Repair[]> {
  const posts = await prisma.post.findMany({
    where: {
      ...(options.businessId ? { businessId: options.businessId } : {}),
      status: { in: [...REPAIR_STATUSES] },
      source: { in: [...REPAIR_SOURCES] },
      ownerEditedAt: null,
      lockedAt: null,
      mediaPaths: { isEmpty: true },
      format: { notIn: ["ARTICLE", "THREAD"] },
      OR: [{ contentId: { not: null } }, { groupId: { not: null } }],
      ...(options.since ? { createdAt: { gte: options.since } } : {}),
    },
    select: { id: true, businessId: true, network: true, format: true, mediaPaths: true, status: true, lastError: true, text: true, source: true, contentId: true, groupId: true, ownerEditedAt: true, lockedAt: true },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 500,
  });
  if (posts.length === 0) return [];
  const contentIds = [...new Set(posts.flatMap((p) => (p.contentId ? [p.contentId] : [])))];
  const groupIds = [...new Set(posts.flatMap((p) => (p.groupId ? [p.groupId] : [])))];
  // One small read finds which content rows and groups have anything ready; their media is read only for those.
  const visuals = await prisma.contentVisual.findMany({
    where: {
      businessId: { in: [...new Set(posts.map((p) => p.businessId))] },
      AND: [{ OR: [{ contentId: { in: contentIds } }, { groupId: { in: groupIds } }] }, { OR: [{ status: "ready" }, { kind: "video" }] }],
    },
    select: { businessId: true, contentId: true, groupId: true },
  });
  const keys = new Map<string, { businessId: string; key: RepairKey }>();
  for (const v of visuals) {
    if (v.contentId && contentIds.includes(v.contentId)) keys.set(mediaKey(v.businessId, { contentId: v.contentId }), { businessId: v.businessId, key: { contentId: v.contentId } });
    if (v.groupId && groupIds.includes(v.groupId)) keys.set(mediaKey(v.businessId, { groupId: v.groupId }), { businessId: v.businessId, key: { groupId: v.groupId } });
  }
  const media = new Map<string, ReadyMedia>();
  for (const [k, { businessId, key }] of keys) media.set(k, await readyMedia(businessId, key));
  return pickRepairs(posts, media);
}

export type RepairResult = { candidates: number; attached: number; unchanged: number; failed: number };

/**
 * Puts the ready visuals on the repairs' posts through the normal attach, one call per content row or group, limited
 * to exactly those posts (onlyPosts), then counts the posts that now have media.
 */
export async function applyRepairs(repairs: readonly Repair[]): Promise<RepairResult> {
  const byKey = new Map<string, { businessId: string; key: RepairKey; ids: string[] }>();
  for (const r of repairs) {
    const k = mediaKey(r.post.businessId, r.key);
    const entry = byKey.get(k) ?? { businessId: r.post.businessId, key: r.key, ids: [] };
    entry.ids.push(r.post.id);
    byKey.set(k, entry);
  }
  let failedIds: string[] = [];
  for (const { businessId, key, ids } of byKey.values()) {
    try {
      if ("contentId" in key) await attachToContent(businessId, key.contentId, { onlyPosts: ids });
      else await attachToGroup(businessId, key.groupId, { onlyPosts: ids });
    } catch (error) {
      failedIds = [...failedIds, ...ids];
      await logError(error, { source: "visuals.reattach", level: "warn", businessId });
    }
  }
  const ids = repairs.map((r) => r.post.id);
  const after = ids.length ? await prisma.post.findMany({ where: { id: { in: ids } }, select: { id: true, mediaPaths: true } }) : [];
  const attached = after.filter((p) => p.mediaPaths.length > 0).length;
  return { candidates: repairs.length, attached, unchanged: repairs.length - attached - failedIds.length, failed: failedIds.length };
}

/** How often the job loop looks, and how far back. */
export const HEAL_EVERY_MS = 10 * 60_000;
export const HEAL_DAYS = 3;
let lastHeal = 0;

/**
 * The safety net (every-minute job loop, app/api/cron/publish): at most every 10 minutes, the last 3 days' waiting
 * posts get their ready pictures if an attach missed them. Two small reads when there is nothing to do.
 */
export async function healWaitingPosts(now = new Date()): Promise<RepairResult | null> {
  if (now.getTime() - lastHeal < HEAL_EVERY_MS) return null;
  lastHeal = now.getTime();
  try {
    const repairs = await findRepairs({ since: new Date(now.getTime() - HEAL_DAYS * 86_400_000), limit: 200 });
    return repairs.length ? await applyRepairs(repairs) : { candidates: 0, attached: 0, unchanged: 0, failed: 0 };
  } catch (error) {
    await logError(error, { source: "visuals.reattach", level: "warn" });
    return null;
  }
}

/** For tests: the next healWaitingPosts call looks again at once. */
export function resetHealClock(): void {
  lastHeal = 0;
}
