import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { ensureAccount } from "@/lib/account";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";

// Creators' sign-in (docs/CREATOR_CAMPAIGNS.md, "People and links"). One login across companies: a creator's User row
// has a CreatorProfile and no Business or Membership. Their User row is made when they join (lib/creators/join.ts),
// before they first sign in, so ensureAccount() returns early and never makes them a Business. A company person can
// have a profile too (they applied with their own email): they keep the dashboard and also open /creator.

export type CreatorSession = { userId: string; email: string; profile: { id: string; name: string; phone: string | null } };

/** True when this person is a creator and nothing else: /dashboard sends them to /creator. */
export async function isCreatorOnly(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { creator: { select: { id: true } }, business: { select: { id: true } }, membership: { select: { userId: true } } } });
  return Boolean(row?.creator && !row.business && !row.membership);
}

/**
 * The signed-in creator, for the portal's pages and actions. Signed out: the sign-in page, back here after. A signed-in
 * person without a creator profile (a company person): the dashboard.
 */
export const requireCreator = cache(async (): Promise<CreatorSession> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/creator");
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { suspendedAt: true, deletionScheduledFor: true, creator: { select: { id: true, name: true, phone: true } } },
  });
  if (row?.suspendedAt) redirect("/suspended");
  if (row?.deletionScheduledFor) redirect("/account/deletion");
  if (!row?.creator) redirect("/dashboard");
  return { userId: user.id, email: user.email ?? "", profile: row.creator };
});

/** The Composio user a creator's connections belong to (never a business id, so the two never mix). */
export const composioCreatorId = (profileId: string) => `creator_${profileId}`;

export type PublicViewer = { kind: "guest" | "creator" | "company"; user: Awaited<ReturnType<typeof getCurrentUser>> };

/** Who opens a public creator page (/creators, /c/<slug>): a visitor, a creator (has a profile), or a company person. */
export async function publicViewer(): Promise<PublicViewer> {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.email_confirmed_at) return { kind: "guest", user: null };
  const profile = await prisma.creatorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  return { kind: profile ? "creator" : "company", user };
}
