import { describe, expect, it } from "vitest";
import { filterTeam, teamCounts } from "@/components/support-app/team/team-filters";

const team = [
  { id: "1", role: "SUPERVISOR", status: "active", availability: "online" },
  { id: "2", role: "AGENT", status: "active", availability: "away" },
  { id: "3", role: "AGENT", status: "invited", availability: "offline" },
  { id: "4", role: "TECH", status: "locked", availability: "online" },
];

describe("Team page filters", () => {
  it("filters by status and role together", () => {
    expect(filterTeam(team, "all", "all").map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
    expect(filterTeam(team, "active", "all").map((m) => m.id)).toEqual(["1", "2"]);
    expect(filterTeam(team, "all", "AGENT").map((m) => m.id)).toEqual(["2", "3"]);
    expect(filterTeam(team, "active", "AGENT").map((m) => m.id)).toEqual(["2"]);
  });
  it("each chip counts what it would show given the other filter; online counts active people only", () => {
    const c = teamCounts(team, "all", "AGENT");
    expect(c.status).toEqual({ all: 2, active: 1, invited: 1, locked: 0 });
    expect(c.role).toEqual({ all: 4, AGENT: 2, TECH: 1, SUPERVISOR: 1 });
    expect(c.online).toBe(1);
  });
});
