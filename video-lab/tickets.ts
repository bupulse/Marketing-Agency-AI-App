// Redeeming the one-use ticket BuPulse hands over (docs/VIDEO_STUDIO_SPLIT.md). The real redeemer is
// redeemStudioTicket in lib/video-studio/ticket.ts (the BuPulse session's file, not landed yet): when it lands,
// `redeemer` below becomes that function and nothing else changes. Until then the only tickets are the test ones.
import type { StudioIdentity } from "./session";

export type TicketRedeemer = (token: string) => Promise<StudioIdentity | null>;

/**
 * Test tickets, off in production and unless STUDIO_DEV_TICKETS=1: "dev-<businessId>" signs in as that business's
 * owner, so a client session can be tried (and the QA run) without BuPulse.
 */
export const devRedeemer: TicketRedeemer = async (token) => {
  if (process.env.STUDIO_ENV === "production" || process.env.STUDIO_DEV_TICKETS !== "1" || !token.startsWith("dev-")) return null;
  const { prisma } = await import("@/lib/db");
  const business = await prisma.business.findUnique({ where: { id: token.slice(4) }, select: { id: true, userId: true } });
  return business ? { userId: business.userId, businessId: business.id, companyUserId: business.userId, role: "OWNER" } : null;
};

let redeemer: TicketRedeemer = devRedeemer;
/** Swapped for the real redeemer, or a fake one in tests. */
export const setTicketRedeemer = (fn: TicketRedeemer) => void (redeemer = fn);
export const redeemTicket = (token: string) => redeemer(token);
