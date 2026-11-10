// The Team page's chip filters (status and role) and their counts. Pure: tests/support-app/team-filters.test.ts.

export type TeamStatusFilter = "all" | "active" | "invited" | "locked";
export type TeamRoleFilter = "all" | "AGENT" | "TECH" | "SUPERVISOR";
type Row = { role: string; status: string; availability: string };

export function filterTeam<T extends Row>(team: T[], status: TeamStatusFilter, role: TeamRoleFilter): T[] {
  return team.filter((m) => (status === "all" || m.status === status) && (role === "all" || m.role === role));
}

/** How many people each chip would show, given the other filter. */
export function teamCounts(team: Row[], status: TeamStatusFilter, role: TeamRoleFilter) {
  const byStatus = (s: TeamStatusFilter) => filterTeam(team, s, role).length;
  const byRole = (r: TeamRoleFilter) => filterTeam(team, status, r).length;
  return {
    status: { all: byStatus("all"), active: byStatus("active"), invited: byStatus("invited"), locked: byStatus("locked") },
    role: { all: byRole("all"), AGENT: byRole("AGENT"), TECH: byRole("TECH"), SUPERVISOR: byRole("SUPERVISOR") },
    online: team.filter((m) => m.status === "active" && m.availability === "online").length,
  };
}
