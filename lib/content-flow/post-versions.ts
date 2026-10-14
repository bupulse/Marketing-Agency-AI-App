// Post versions in the database (docs/CONTENT.md, "Versions"). A change of a post's words is recorded in two steps:
// keepBaseline before it (the words as they are, when no version holds them yet: BuPulse's first text, or a change
// made elsewhere) and addVersion after it. Restoring adds a version too, so nothing is ever overwritten. Every read
// and write is scoped to the business.
import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { MAX_POST_VERSIONS, samePieces, type PostPieces, type RewritePart, type VersionKind } from "./versions";

type Db = Pick<Prisma.TransactionClient, "postVersion">;

const PIECES = { title: true, text: true, hashtags: true, videoScript: true, adHeadlines: true } as const;
const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/** The post as the baseline needs it. */
export type VersionedPost = { id: string; businessId: string; createdAt: Date; updatedAt: Date };

/**
 * Saves the post's words as they are now, unless its newest version already holds them. The first one is "original"
 * (dated when the post was made); a later one is a change made outside the versions ("edit", dated by the post's last
 * change).
 */
export async function keepBaseline(db: Db, post: VersionedPost, current: PostPieces, now = new Date()): Promise<void> {
  const latest = await db.postVersion.findFirst({ where: { postId: post.id, businessId: post.businessId }, orderBy: NEWEST_FIRST, select: PIECES });
  if (latest && samePieces(latest, current)) return;
  const at = new Date(Math.min((latest ? post.updatedAt : post.createdAt).getTime(), now.getTime() - 1));
  await db.postVersion.create({ data: { businessId: post.businessId, postId: post.id, kind: latest ? "edit" : "original", ...current, createdAt: at } });
}

/** Saves the post's new words as its newest version, then keeps the newest MAX_POST_VERSIONS. */
export async function addVersion(
  db: Db,
  post: Pick<VersionedPost, "id" | "businessId">,
  pieces: PostPieces,
  change: { kind: Exclude<VersionKind, "original">; part?: RewritePart; restoredFromId?: string; actorId?: string | null },
  now = new Date(),
): Promise<{ id: string }> {
  const created = await db.postVersion.create({
    data: { businessId: post.businessId, postId: post.id, kind: change.kind, part: change.part ?? null, restoredFromId: change.restoredFromId ?? null, actorId: change.actorId ?? null, ...pieces, createdAt: now },
    select: { id: true },
  });
  const old = await db.postVersion.findMany({ where: { postId: post.id, businessId: post.businessId }, orderBy: NEWEST_FIRST, skip: MAX_POST_VERSIONS, select: { id: true } });
  if (old.length > 0) await db.postVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) }, businessId: post.businessId } });
  return created;
}

export type StoredVersion = PostPieces & { id: string; kind: string; part: string | null; restoredFromId: string | null; actorId: string | null; createdAt: Date };

/** A post's versions, newest first (only the business's own). */
export async function listVersions(businessId: string, postId: string, db: Db = prisma): Promise<StoredVersion[]> {
  return db.postVersion.findMany({
    where: { postId, businessId },
    orderBy: NEWEST_FIRST,
    take: MAX_POST_VERSIONS,
    select: { ...PIECES, id: true, kind: true, part: true, restoredFromId: true, actorId: true, createdAt: true },
  });
}

/** One version of one of the business's posts, or null. */
export async function findVersion(businessId: string, postId: string, versionId: string): Promise<StoredVersion | null> {
  return prisma.postVersion.findFirst({
    where: { id: versionId, postId, businessId },
    select: { ...PIECES, id: true, kind: true, part: true, restoredFromId: true, actorId: true, createdAt: true },
  });
}
