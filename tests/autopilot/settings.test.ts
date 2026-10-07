import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, readConfig, toRow } from "@/lib/autopilot/settings";

describe("autopilot settings mapping", () => {
  it("starts off, asking first, with free images", () => {
    expect(DEFAULT_CONFIG).toMatchObject({ enabled: false, autoPublish: false, useAiImages: false });
    expect(readConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it("round-trips the religious-holiday choice through its column", () => {
    const config = { ...DEFAULT_CONFIG, enabled: true, skipReligious: true, postingTimes: ["08:30", "17:00"] };
    const row = toRow(config);
    expect(row.postingTimes).toEqual(["08:30", "17:00"]);
    expect(row.skipReligiousHolidays).toBe(true);
    expect(readConfig(row)).toEqual(config);
    expect(readConfig(toRow({ ...config, skipReligious: false })).skipReligious).toBe(false);
  });

  it("falls back to default times and clamps the count for odd stored rows", () => {
    const row = { enabled: true, autoPublish: false, postsPerWeek: 99, connectionIds: [], postingTimes: ["nonsense"], useAiImages: false, skipReligiousHolidays: false };
    const config = readConfig(row);
    expect(config.postsPerWeek).toBe(14);
    expect(config.postingTimes).toEqual(["09:00", "18:00"]);
  });
});
