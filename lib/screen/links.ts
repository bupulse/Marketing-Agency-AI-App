// Links to the sales room TV (/screen/<token>). The token is shown once, when the link is made; only its SHA-256 is
// stored (ScreenLink.tokenHash), so a database leak does not open the screen. Revoking stops the link at once.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { siteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import { LINK_SEEN_EVERY_MS } from "./shared";

/** 32 random bytes, base64url: 43 characters. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** A token that could be real (cheap check before any rate limit or database work). */
export const isScreenTokenFormat = (token: string) => TOKEN.test(token);

export const hashScreenToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type ScreenLinkRow = { id: string; name: string; lastSeenAt: Date | null };

/** The live link for a token, or null (malformed, unknown or revoked: the screen answers 404). */
export async function screenByToken(token: string): Promise<ScreenLinkRow | null> {
  if (!TOKEN.test(token)) return null;
  const link = await prisma.screenLink.findUnique({ where: { tokenHash: hashScreenToken(token) }, select: { id: true, name: true, lastSeenAt: true, revokedAt: true } });
  if (!link || link.revokedAt) return null;
  return { id: link.id, name: link.name, lastSeenAt: link.lastSeenAt };
}

/** Notes that the screen is in use, at most once a minute per link. Never fails the request. */
export async function touchScreen(link: ScreenLinkRow, now = new Date()): Promise<void> {
  if (link.lastSeenAt && now.getTime() - link.lastSeenAt.getTime() < LINK_SEEN_EVERY_MS) return;
  await prisma.screenLink
    .updateMany({ where: { id: link.id, revokedAt: null, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - LINK_SEEN_EVERY_MS) } }] }, data: { lastSeenAt: now } })
    .catch(() => undefined);
}

export async function listScreenLinks() {
  return prisma.screenLink.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, createdAt: true, lastSeenAt: true, revokedAt: true } });
}

/** A new link: returns its full URL, the only time it is ever shown. */
export async function createScreenLink(ctx: AdminContext, rawName: string): Promise<{ id: string; url: string }> {
  const name = rawName.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  if (!name) throw new AdminError("invalid", "Give the screen a name, for example \"Sales room TV\".");
  const token = randomBytes(32).toString("base64url");
  const row = await prisma.$transaction(async (tx) => {
    const row = await tx.screenLink.create({ data: { name, tokenHash: hashScreenToken(token), createdBy: ctx.actor }, select: { id: true } });
    await writeAudit(tx, ctx, "create_screen_link", `screen:${row.id}`, null, { name });
    return row;
  });
  return { id: row.id, url: `${siteUrl()}/screen/${token}` };
}

export async function revokeScreenLink(ctx: AdminContext, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.screenLink.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) throw new AdminError("not_found", "That link is already revoked or gone.");
    await writeAudit(tx, ctx, "revoke_screen_link", `screen:${id}`, null, { revoked: true });
  });
}
