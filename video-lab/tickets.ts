// Redeeming the one-use ticket BuPulse hands over (docs/VIDEO_STUDIO_SPLIT.md): redeemStudioTicket in
// lib/video-studio/ticket.ts (a conditional update, so a ticket works once; 2 minutes; null for a used, expired, made-up
// or malformed one, or a person no longer in the company). The test tickets below are the only addition.
import { redeemStudioTicket, studioBlock, type StudioBlock } from "@/lib/video-studio/ticket";
import type { Role } from "@/lib/team/roles";
import type { StudioIdentity } from "./session";

export type TicketRedeemer = (token: string) => Promise<StudioIdentity | null>;

const devTickets = () => process.env.STUDIO_ENV !== "production" && process.env.STUDIO_DEV_TICKETS === "1";

/**
 * Test tickets, off in production and unless STUDIO_DEV_TICKETS=1: "dev-<businessId>" signs in as that business's
 * owner, so a client session can be tried (and the QA run) without BuPulse.
 */
export const devRedeemer: TicketRedeemer = async (token) => {
  if (!devTickets() || !token.startsWith("dev-")) return null;
  const { prisma } = await import("@/lib/db");
  const business = await prisma.business.findUnique({ where: { id: token.slice(4) }, select: { id: true, userId: true } });
  return business ? { userId: business.userId, businessId: business.id, companyUserId: business.userId, role: "OWNER" } : null;
};

export const realRedeemer: TicketRedeemer = (token) => redeemStudioTicket(token);

let redeemer: TicketRedeemer = (token) => (token.startsWith("dev-") ? devRedeemer(token) : realRedeemer(token));
/** Swapped for a fake one in tests. */
export const setTicketRedeemer = (fn: TicketRedeemer) => void (redeemer = fn);
export const redeemTicket = (token: string) => redeemer(token);

/** What to tell a person the studio cannot be used by, in plain English. */
export const BLOCK_MESSAGE: Record<StudioBlock, string> = {
  off: "The Video Studio is switched off for now. Please try again later.",
  permission: "Your role cannot make videos. Ask your company owner for access to videos.",
  plan: "Your plan has no video credits. Choose a plan with video credits on BuPulse to use the studio.",
};

let blockMemory = new Map<string, { at: number; value: StudioBlock | null }>();
/**
 * Whether the studio is closed to this person: switched off in Admin -> Services, no permission for videos, or a plan
 * without video credits (lib/video-studio/ticket.ts studioBlock, the same check BuPulse's button uses). Asked when a
 * session is made and before paid work; remembered for 30 seconds. Skipped for test tickets (STUDIO_DEV_TICKETS=1).
 */
export async function blockFor(identity: StudioIdentity, now = Date.now()): Promise<StudioBlock | null> {
  if (devTickets()) return null;
  const key = `${identity.companyUserId}:${identity.role}`;
  const known = blockMemory.get(key);
  if (known && now - known.at < 30_000) return known.value;
  const value = await studioBlock({ role: identity.role as Role, companyUserId: identity.companyUserId });
  if (blockMemory.size > 500) blockMemory = new Map();
  blockMemory.set(key, { at: now, value });
  return value;
}
