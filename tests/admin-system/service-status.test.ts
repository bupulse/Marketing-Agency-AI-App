import { describe, expect, it } from "vitest";
import { HEALTH_PILL, ago, filterCounts, serviceFilterOf, sortServices, type ServiceHealth } from "@/components/admin/system/services/service-status";

const ALL: ServiceHealth[] = ["off", "down", "missing", "not_connected", "ok", "untested", "not_in_use"];

describe("service status", () => {
  it("says every state in words", () => {
    for (const h of ALL) expect(HEALTH_PILL[h].label).toBeTruthy();
  });

  it("down, missing keys and switched off need the owner", () => {
    expect(serviceFilterOf("down")).toBe("attention");
    expect(serviceFilterOf("missing")).toBe("attention");
    expect(serviceFilterOf("off")).toBe("attention");
    expect(serviceFilterOf("ok")).toBe("working");
    expect(serviceFilterOf("untested")).toBe("untested");
    expect(serviceFilterOf("not_connected")).toBe("setup");
    expect(serviceFilterOf("not_in_use")).toBe("setup");
  });

  it("puts what needs the owner first and keeps the catalogue order otherwise", () => {
    const list = [{ id: "a", health: "ok" as const }, { id: "b", health: "not_connected" as const }, { id: "c", health: "down" as const }, { id: "d", health: "ok" as const }, { id: "e", health: "off" as const }];
    expect(sortServices(list).map((s) => s.id)).toEqual(["c", "e", "a", "d", "b"]);
  });

  it("counts each chip", () => {
    expect(filterCounts(ALL.map((health) => ({ health })))).toEqual({ "": 7, attention: 3, working: 1, untested: 1, setup: 2 });
  });

  it("says how long ago in words", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(ago("2026-11-10T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-11-10T11:48:00Z", now)).toBe("12 min ago");
    expect(ago("2026-11-10T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-11-09T11:00:00Z", now)).toBe("1 day ago");
    expect(ago(new Date("2026-11-07T12:00:00Z"), now)).toBe("3 days ago");
  });
});
