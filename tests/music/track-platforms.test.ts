import { describe, expect, it } from "vitest";
import { pickTrack, platformLimitLabel, trackInputSchema, trackUsableFor } from "@/lib/music/tracks";

const meta = ["facebook", "instagram"];
const tracks = [
  { id: "meta-1", moods: ["upbeat"], platforms: meta },
  { id: "free-1", moods: ["upbeat"], platforms: [] },
  { id: "free-2", moods: ["calm"] },
];

describe("tracks limited to some apps (Meta Sound Collection)", () => {
  it("a track without a limit fits every video", () => {
    expect(trackUsableFor({ platforms: [] }, ["tiktok"])).toBe(true);
    expect(trackUsableFor({}, undefined)).toBe(true);
    expect(trackUsableFor({ platforms: null }, [])).toBe(true);
  });

  it("a limited track fits only when every destination is in its list", () => {
    expect(trackUsableFor({ platforms: meta }, ["instagram"])).toBe(true);
    expect(trackUsableFor({ platforms: meta }, ["facebook", "instagram"])).toBe(true);
    // The shared day reel goes to many apps: one outside the list rules the track out.
    expect(trackUsableFor({ platforms: meta }, ["facebook", "instagram", "tiktok"])).toBe(false);
    expect(trackUsableFor({ platforms: meta }, ["youtube"])).toBe(false);
  });

  it("a video whose destinations are unknown never gets a limited track", () => {
    expect(trackUsableFor({ platforms: meta }, undefined)).toBe(false);
    expect(trackUsableFor({ platforms: meta }, [])).toBe(false);
  });

  it("the picker never puts a limited track in a video going outside its list", () => {
    for (let i = 0; i < 40; i++) {
      const seed = `seed-${i}`;
      expect(pickTrack(tracks, "upbeat", seed, ["instagram", "tiktok"])?.id).not.toBe("meta-1");
      expect(pickTrack(tracks, "upbeat", seed)?.id).not.toBe("meta-1");
      expect(pickTrack(tracks, null, seed, ["youtube"])?.id).not.toBe("meta-1");
    }
  });

  it("the picker may use a limited track for a video going only to Facebook and Instagram", () => {
    const picked = new Set(Array.from({ length: 40 }, (_, i) => pickTrack(tracks, "upbeat", `s${i}`, ["facebook", "instagram"])?.id));
    expect(picked.has("meta-1")).toBe(true);
    expect(pickTrack([tracks[0]], "upbeat", "x", ["instagram"])?.id).toBe("meta-1");
  });

  it("a library of only limited tracks gives no music to a video going elsewhere", () => {
    expect(pickTrack([tracks[0]], "upbeat", "x", ["tiktok"])).toBeNull();
    expect(pickTrack([tracks[0]], "upbeat", "x")).toBeNull();
  });

  it("the upload form's platforms: empty by default, Facebook and Instagram only allowed", () => {
    const base = { title: "Song", moods: ["calm"], licence: "Meta Sound Collection", sourceUrl: "https://www.facebook.com/sound/collection/", attribution: "Song by Artist" };
    expect(trackInputSchema.parse(base).platforms).toEqual([]);
    expect(trackInputSchema.parse({ ...base, platforms: ["facebook", "instagram"] }).platforms).toEqual(["facebook", "instagram"]);
    expect(trackInputSchema.safeParse({ ...base, platforms: ["tiktok"] }).success).toBe(false);
  });

  it("the admin list labels the limit", () => {
    expect(platformLimitLabel(meta)).toBe("Facebook and Instagram only");
    expect(platformLimitLabel(["instagram"])).toBe("Instagram only");
    expect(platformLimitLabel([])).toBeNull();
  });
});
