import { getAppContext, PageHeader } from "@/components/app";
import { pageGate } from "@/components/app/no-access";
import { TeamManager } from "@/components/team/team-manager";
import { prisma } from "@/lib/db";
import { listTeam } from "@/lib/team/service";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const blocked = await pageGate("team");
  if (blocked) return blocked;
  const { actorId, role, business, user } = await getAppContext();
  const [team, history, mine] = await Promise.all([
    listTeam(business.id, user.id),
    teamHistory(business.id),
    prisma.membership.findUnique({ where: { userId: actorId }, select: { notifyEmail: true } }),
  ]);
  return (
    <>
      <PageHeader title="Team" description="Invite colleagues to work in your company. Everyone shares the same content, designs, leads, channels and credits." />
      <TeamManager
        me={actorId}
        role={role}
        limit={team.limit}
        alertsOn={Boolean(mine?.notifyEmail)}
        history={history}
        members={team.members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }))}
        invites={team.invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() }))}
      />
    </>
  );
}

const LABEL: Record<string, (b: Record<string, unknown> | null, a: Record<string, unknown> | null) => string> = {
  team_invite: (_b, a) => `invited ${String(a?.invited ?? "someone")} as ${String(a?.role ?? "a member").toLowerCase()}`,
  team_cancel_invite: (b) => `cancelled the invitation to ${String(b?.invited ?? "someone")}`,
  team_remove_member: (b) => `removed ${String(b?.removed ?? "a teammate")}`,
  team_change_role: (_b, a) => `changed a teammate's role to ${String(a?.role ?? "").toLowerCase()}`,
  team_transfer_ownership: () => "transferred ownership",
};

/** The last team changes (invites, removals, roles, ownership) with who did them. Emails are masked in the log. */
async function teamHistory(businessId: string) {
  const rows = await prisma.auditLog.findMany({ where: { target: `company:${businessId}`, action: { startsWith: "team_" } }, orderBy: { createdAt: "desc" }, take: 10 });
  const ids = [...new Set(rows.flatMap((r) => (r.actor.startsWith("user:") ? [r.actor.slice(5)] : [])))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const who = new Map(users.map((u) => [u.id, u.name || u.email]));
  return rows.map((r) => {
    const text = LABEL[r.action]?.((r.before as Record<string, unknown> | null) ?? null, (r.after as Record<string, unknown> | null) ?? null) ?? r.action;
    const actor = r.actor.startsWith("user:") ? (who.get(r.actor.slice(5)) ?? "A former teammate") : "BuPulse support";
    return { id: r.id, at: r.createdAt.toISOString(), text: `${actor} ${text}` };
  });
}
