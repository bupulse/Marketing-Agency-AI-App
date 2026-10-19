import "server-only";
import { prisma } from "@/lib/db";
import { isServiceEnabled } from "@/lib/admin/switch";
import { resolveCompany } from "@/lib/team/company";
import { can, type Role } from "@/lib/team/roles";
import { hashToken, newInviteToken } from "@/lib/team/service";
import { getUsageSummary } from "@/lib/usage";

// One-click sign-in from BuPulse to the Video Studio (studio.bupulse.com, docs/VIDEO_STUDIO_SPLIT.md). "Open Video
// Studio" (/dashboard/video/open) checks the client may use the studio, writes a ticket and sends them to
// `${STUDIO_URL}/auth/bupulse?ticket=<token>&next=<path>`. The studio redeems the token once, within TICKET_TTL_MS, and
// sets its own session. Only the token's SHA-256 is stored, so a database read cannot sign anyone in.

export const DEFAULT_STUDIO_URL = "https://studio.bupulse.com";
export const TICKET_TTL_MS = 2 * 60_000;

/** The studio's address, without a trailing slash (STUDIO_URL, in Admin → Services → Video Studio). */
export function studioUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.STUDIO_URL?.trim() || DEFAULT_STUDIO_URL;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return DEFAULT_STUDIO_URL;
  }
}

/** A studio path to land on after sign-in: "/" unless it is a plain path on the studio (no other site, no "//"). */
export function studioPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next.slice(0, 500);
}

/** Where the studio sends a client who has no session there: back here for a fresh ticket. */
export const openStudioHref = (next?: string) => `/dashboard/video/open${next && next !== "/" ? `?next=${encodeURIComponent(studioPath(next))}` : ""}`;

/**
 * Why a client cannot open the studio right now, or null when they can.
 *   off         the studio is switched off in Admin → Services (not live yet)
 *   permission  their team role may not make content
 *   plan        their plan has no video credits (Trial, Starter, Standard, Business and Pro have them)
 */
export type StudioBlock = "off" | "permission" | "plan";

export async function studioBlock(input: { role: Role; companyUserId: string }): Promise<StudioBlock | null> {
  if (!(await isServiceEnabled("studio"))) return "off";
  if (!can(input.role, "content")) return "permission";
  const usage = await getUsageSummary(input.companyUserId);
  if (!(usage.limits.videoCredits > 0)) return "plan";
  return null;
}

/** Writes a ticket for this person and company and returns the studio address to send them to. */
export async function issueStudioTicket(input: { userId: string; businessId: string; next?: string | null }, now = new Date()): Promise<string> {
  const token = newInviteToken();
  await prisma.studioTicket.create({ data: { tokenHash: await hashToken(token), userId: input.userId, businessId: input.businessId, expiresAt: new Date(now.getTime() + TICKET_TTL_MS) } });
  // Old tickets are only kept for a day, for support questions.
  await prisma.studioTicket.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } } }).catch(() => {});
  const url = new URL("/auth/bupulse", studioUrl());
  url.searchParams.set("ticket", token);
  url.searchParams.set("next", studioPath(input.next));
  return url.toString();
}

/** Who a redeemed ticket signs in: the person, their company, the company account usage is charged to, their role. */
export type StudioSignIn = { userId: string; businessId: string; companyUserId: string; role: Role };

/**
 * The studio's side: uses the ticket (once: a conditional update, so two requests cannot both use it) and returns who it
 * signs in. Null when it is unknown, used or expired, or the person no longer belongs to that company or may not use
 * the studio (their company is being deleted or suspended).
 */
export async function redeemStudioTicket(token: string, now = new Date()): Promise<StudioSignIn | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await hashToken(token);
  const { count } = await prisma.studioTicket.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (count !== 1) return null;
  const ticket = await prisma.studioTicket.findUnique({ where: { tokenHash }, select: { userId: true, businessId: true } });
  if (!ticket) return null;
  const company = await resolveCompany(ticket.userId);
  if (!company || company.businessId !== ticket.businessId || company.ownerDeleting || company.ownerSuspended) return null;
  return { userId: ticket.userId, businessId: company.businessId, companyUserId: company.ownerId, role: company.role };
}
