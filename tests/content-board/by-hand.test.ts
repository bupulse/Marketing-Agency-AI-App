import { describe, expect, it } from "vitest";
import { byHandId, byHandNetwork, draftTargets } from "@/lib/content-board/by-hand";
import { autoDecision } from "@/lib/content-board/rules";

describe("apps that are not connected", () => {
  it("are named network:<app> and read back safely", () => {
    expect(byHandId("instagram")).toBe("network:instagram");
    expect(byHandNetwork("network:tiktok")).toBe("tiktok");
    expect(byHandNetwork("network:myspace")).toBeNull();
    expect(byHandNetwork("conn_123")).toBeNull();
  });

  it("get a reminder draft for each written-for app without an account", () => {
    const usable = [{ id: "c-ig", provider: "instagram" }];
    expect(draftTargets(usable, ["instagram", "facebook", "tiktok"])).toEqual([
      { connection: usable[0], network: "instagram" },
      { connection: null, network: "facebook" },
      { connection: null, network: "tiktok" },
    ]);
    expect(draftTargets([], []).map((t) => t.network)).toEqual(["instagram", "facebook", "linkedin"]);
  });

  it("are auto-approved as reminders, with the same picture and video checks", () => {
    const base = { network: "instagram", format: "POST", requireApproval: false, canSchedule: true, account: null, byHand: true, requiresMedia: true, hasMedia: true, hasVideo: false, videoPending: false, imagePending: false, issues: [] };
    expect(autoDecision(base)).toEqual({ action: "schedule" });
    expect(autoDecision({ ...base, byHand: false })).toMatchObject({ action: "review" });
    expect(autoDecision({ ...base, hasMedia: false, imagePending: true })).toMatchObject({ action: "review" });
    expect(autoDecision({ ...base, requireApproval: true })).toEqual({ action: "wait" });
  });
});
