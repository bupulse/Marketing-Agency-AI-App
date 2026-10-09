import { describe, expect, it } from "vitest";
import { assignableRoles, askMessage, atLeast, can, PERMISSIONS, type Permission, type Role } from "@/lib/team/roles";

// The role matrix from docs/STAGE1_IMPLEMENTATION_PLAN.md ("Companies and team members"), one row per permission.
const MATRIX: Record<Permission, Record<Role, boolean>> = {
  content: { OWNER: true, ADMIN: true, MEMBER: true },
  autopilotSettings: { OWNER: true, ADMIN: true, MEMBER: false },
  channels: { OWNER: true, ADMIN: true, MEMBER: false },
  connectors: { OWNER: true, ADMIN: true, MEMBER: false },
  widget: { OWNER: true, ADMIN: true, MEMBER: false },
  webhooks: { OWNER: true, ADMIN: true, MEMBER: false },
  settings: { OWNER: true, ADMIN: true, MEMBER: false },
  team: { OWNER: true, ADMIN: true, MEMBER: false },
  billing: { OWNER: true, ADMIN: false, MEMBER: false },
  company: { OWNER: true, ADMIN: false, MEMBER: false },
};

describe("role matrix", () => {
  for (const permission of Object.keys(MATRIX) as Permission[]) {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as Role[]) {
      it(`${role} ${MATRIX[permission][role] ? "may" : "may not"} ${permission}`, () => {
        expect(can(role, permission)).toBe(MATRIX[permission][role]);
      });
    }
  }

  it("covers every permission the code defines", () => {
    expect(Object.keys(MATRIX).sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });

  it("fails closed for an unknown or missing role", () => {
    expect(can(undefined as unknown as Role, "content")).toBe(false);
    expect(can("GUEST" as unknown as Role, "content")).toBe(false);
  });

  it("ranks Owner above Admin above Member", () => {
    expect(atLeast("OWNER", "ADMIN")).toBe(true);
    expect(atLeast("ADMIN", "OWNER")).toBe(false);
    expect(atLeast("MEMBER", "ADMIN")).toBe(false);
  });

  it("never lets anyone hand out the Owner role, and members hand out nothing", () => {
    expect(assignableRoles("OWNER")).toEqual(["ADMIN", "MEMBER"]);
    expect(assignableRoles("ADMIN")).toEqual(["ADMIN", "MEMBER"]);
    expect(assignableRoles("MEMBER")).toEqual([]);
  });

  it("names who to ask", () => {
    expect(askMessage("billing")).toBe("Ask your company owner to do this.");
    expect(askMessage("channels")).toBe("Ask your company owner or an admin to do this.");
  });
});
