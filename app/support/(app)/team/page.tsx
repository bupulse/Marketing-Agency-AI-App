import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { TeamView } from "@/components/support-app/team-view";
import { requireSupportAgentPage } from "@/lib/support/app-auth";
import { listJoinRequests, supportAppUrl, verifiedTotpUsers } from "@/lib/support/agents";
import { isSupportOwnerEmail } from "@/lib/support/owner";

export const metadata = { title: "Team" };

/**
 * admin@bupulse.com only: requests to join (approve / decline), adding a team member with a password, and everyone in
 * the support team with whether they have added their authenticator app (set a new password, ask for a new app).
 */
export default async function SupportTeamPage() {
  const me = await requireSupportAgentPage();
  if (!me.owner) notFound();
  const [requests, team] = await Promise.all([
    listJoinRequests(),
    prisma.supportAgent.findMany({
      where: { status: { not: "pending" } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, role: true, status: true, availability: true, lastSeenAt: true, userId: true },
    }),
  ]);
  const withApp = await verifiedTotpUsers(team.flatMap((t) => (t.userId ? [t.userId] : [])));
  return (
    <TeamView
      signInUrl={`${supportAppUrl()}/sign-in`}
      requests={requests}
      team={team.map(({ userId, ...t }) => ({
        ...t,
        lastSeenAt: t.lastSeenAt?.toISOString() ?? null,
        hasSignIn: !!userId,
        // null when it could not be read: nothing is claimed either way.
        authenticator: !userId ? false : withApp ? withApp.has(userId) : null,
        manageable: !!userId && !isSupportOwnerEmail(t.email),
      }))}
    />
  );
}
