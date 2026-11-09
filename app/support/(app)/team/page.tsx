import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { TeamView } from "@/components/support-app/team-view";
import { requireSupportAgentPage } from "@/lib/support/app-auth";
import { listJoinRequests } from "@/lib/support/agents";

export const metadata = { title: "Team" };

/** admin@bupulse.com only: requests to join (approve / decline) and everyone in the support team. */
export default async function SupportTeamPage() {
  const me = await requireSupportAgentPage();
  if (!me.owner) notFound();
  const [requests, team] = await Promise.all([
    listJoinRequests(),
    prisma.supportAgent.findMany({
      where: { status: { not: "pending" } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, role: true, status: true, availability: true, lastSeenAt: true },
    }),
  ]);
  return <TeamView requests={requests} team={team.map((t) => ({ ...t, lastSeenAt: t.lastSeenAt?.toISOString() ?? null }))} />;
}
