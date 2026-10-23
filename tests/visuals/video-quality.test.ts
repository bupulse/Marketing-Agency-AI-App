import { describe, expect, it } from "vitest";
import { MIX_EVERY, readVideoQuality, videoGetsAiClips, videoQualityChoices } from "@/lib/visuals/video-quality";
import { readDailySettings, dailySettingsSchema, DEFAULT_DAILY_SETTINGS } from "@/lib/daily-posts/settings";

describe("video quality for the videos BuPulse makes by itself", () => {
  it("is simple unless the owner chose otherwise", () => {
    expect(readVideoQuality(undefined)).toBe("simple");
    expect(readVideoQuality("4k")).toBe("simple");
    expect(readVideoQuality("ai")).toBe("ai");
    expect(videoGetsAiClips(undefined, "g1")).toBe(false);
    expect(videoGetsAiClips("simple", "g1")).toBe(false);
    expect(videoGetsAiClips("ai", "g1")).toBe(true);
  });

  it("gives about one video in four AI clips in a mix, the same video every time", () => {
    const seeds = Array.from({ length: 400 }, (_, i) => `group-${i}`);
    const ai = seeds.filter((s) => videoGetsAiClips("mix", s)).length;
    expect(ai).toBeGreaterThan(400 / MIX_EVERY - 40);
    expect(ai).toBeLessThan(400 / MIX_EVERY + 40);
    expect(seeds.map((s) => videoGetsAiClips("mix", s))).toEqual(seeds.map((s) => videoGetsAiClips("mix", s)));
  });

  it("says what each choice costs", () => {
    const [simple, mix, ai] = videoQualityChoices(190);
    expect(simple.hint).toContain("No studio credits");
    expect(mix.hint).toContain("about 190 studio credits");
    expect(ai.label).toBe("AI videos");
  });

  it("is kept in the daily posts settings, simple for settings saved before it", () => {
    expect(DEFAULT_DAILY_SETTINGS.videoQuality).toBe("simple");
    expect(readDailySettings({ enabled: true }).videoQuality).toBe("simple");
    expect(readDailySettings({ videoQuality: "mix" }).videoQuality).toBe("mix");
    const { videoQuality, ...older } = DEFAULT_DAILY_SETTINGS;
    expect(videoQuality).toBe("simple");
    expect(dailySettingsSchema.parse(older).videoQuality).toBe("simple");
  });
});
