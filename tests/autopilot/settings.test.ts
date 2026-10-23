import { describe, expect, it } from "vitest";
import { defaultAccountIds, DEFAULT_CONFIG, readConfig, settingsSchema, toRow } from "@/lib/autopilot/settings";

describe("autopilot settings mapping", () => {
  it("starts off and asking first, with AI photos of people on (docs/CONTENT_VISUALS.md)", () => {
    expect(DEFAULT_CONFIG).toMatchObject({ enabled: false, autoPublish: false, useAiImages: true });
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
    const row = { enabled: true, autoPublish: false, postsPerWeek: 99, connectionIds: [], postingTimes: ["nonsense"], useAiImages: false, skipReligiousHolidays: false, videoQuality: "fancy" };
    const config = readConfig(row);
    expect(config.postsPerWeek).toBe(14);
    expect(config.postingTimes).toEqual(["09:00", "18:00"]);
    expect(config.videoQuality).toBe("simple");
  });

  it("keeps simple videos by default and round-trips the video quality", () => {
    expect(DEFAULT_CONFIG.videoQuality).toBe("simple");
    expect(readConfig(toRow({ ...DEFAULT_CONFIG, videoQuality: "mix" })).videoQuality).toBe("mix");
    const { videoQuality, ...older } = DEFAULT_CONFIG;
    expect(videoQuality).toBe("simple");
    expect(settingsSchema.parse({ ...older }).videoQuality).toBe("simple");
    expect(settingsSchema.safeParse({ ...DEFAULT_CONFIG, videoQuality: "4k" }).success).toBe(false);
  });
});

describe("switching Autopilot on with no account chosen", () => {
  it("writes for the connected accounts (reminder-mode ones too), else every app as reminders", () => {
    const accounts = [
      { id: "c-ig", usable: true },
      { id: "c-fb", usable: false },
      { id: "network:linkedin", usable: true },
      { id: "network:tiktok", usable: true },
    ];
    expect(defaultAccountIds(accounts)).toEqual(["c-ig"]);
    expect(defaultAccountIds(accounts.slice(1))).toEqual(["network:linkedin", "network:tiktok"]);
    expect(defaultAccountIds([])).toEqual([]);
  });
});
