// Made-up people for the support app's dev-only preview (app/support/preview/team): example.com addresses, no database.

export function previewTeam(now = new Date()) {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  return {
    requests: [
      { id: "rq1", name: "Grace Ingabire", email: "grace@example.com", role: "AGENT", createdAt: at(95) },
      { id: "rq2", name: "Olivier Niyonzima", email: "olivier@example.com", role: "TECH", createdAt: at(26 * 60) },
    ],
    team: [
      { id: "m1", name: "Jean Mugisha", email: "jean@example.com", role: "SUPERVISOR", status: "active", availability: "online", lastSeenAt: at(1) },
      { id: "m2", name: "Aline Uwase", email: "aline@example.com", role: "AGENT", status: "active", availability: "online", lastSeenAt: at(3) },
      { id: "m3", name: "Eric Habimana", email: "eric@example.com", role: "TECH", status: "active", availability: "away", lastSeenAt: at(42) },
      { id: "m4", name: "Diane Keza", email: "diane@example.com", role: "AGENT", status: "active", availability: "offline", lastSeenAt: at(20 * 60) },
      { id: "m5", name: "Patrick Hakizimana", email: "patrick@example.com", role: "AGENT", status: "invited", availability: "offline", lastSeenAt: null },
      { id: "m6", name: "Samuel Bizimana", email: "samuel@example.com", role: "AGENT", status: "locked", availability: "offline", lastSeenAt: at(9 * 24 * 60) },
    ],
  };
}
