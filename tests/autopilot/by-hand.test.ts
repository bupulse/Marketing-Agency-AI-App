import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { planConnections } from "@/lib/autopilot/data";

const ig = { id: "c-ig", provider: "instagram", status: "ACTIVE", postingMode: "AUTO" };

describe("planConnections", () => {
  it("writes for apps chosen while not connected, as reminders", () => {
    expect(planConnections([], ["network:instagram", "network:tiktok"])).toEqual([
      { id: "network:instagram", network: "instagram" },
      { id: "network:tiktok", network: "tiktok" },
    ]);
  });

  it("uses the app's account once it is connected, so future posts publish on their own", () => {
    expect(planConnections([ig], ["network:instagram"])).toEqual([{ id: "c-ig", network: "instagram" }]);
    expect(planConnections([ig], ["c-ig", "network:instagram"])).toEqual([{ id: "c-ig", network: "instagram" }]);
  });

  it("skips unusable or unchosen accounts", () => {
    expect(planConnections([{ ...ig, status: "REVOKED" }], ["c-ig"])).toEqual([]);
    expect(planConnections([ig], [])).toEqual([]);
  });
});
