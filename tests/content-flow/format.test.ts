import { describe, expect, it } from "vitest";
import { seededRandom } from "@/lib/autopilot/learning";
import { runCost, VIDEO_SECONDS_PER_VIDEO } from "@/lib/content-flow/cost";
import { decideFormats, expectedVideos, MAX_RUN_VIDEOS, recentFormatsOf, repeatedFormat, type FormatInput } from "@/lib/content-flow/format";
import { albumVideos, assignMedia } from "@/lib/content-flow/media";
import type { AngleId } from "@/lib/studio/angles";
import type { Network } from "@/lib/social/types";

const DAY = "2026-10-13";
const slot = (network: Network, angle: AngleId = "story") => ({ network, angle });
const base = (over: Partial<FormatInput> = {}): FormatInput => ({ slots: [slot("instagram")], day: DAY, videoInPlan: true, videoSecondsLeft: 10_000, maxVideos: 1, rng: seededRandom("t"), ...over });

/** The share of video posts on one app over many seeded runs (one post a run, so the budget never binds). */
function videoShare(network: Network, over: Partial<FormatInput> = {}, runs = 2000): number {
  const rng = seededRandom(`share|${network}`);
  let videos = 0;
  for (let i = 0; i < runs; i++) if (decideFormats(base({ slots: [slot(network)], rng, ...over })).choices[0].format === "video") videos++;
  return videos / runs;
}

describe("picture or video per app (BuPulse decides)", () => {
  it("follows the owner's shares per network with a seeded RNG", () => {
    expect(videoShare("tiktok", { photoApps: ["tiktok"] })).toBeGreaterThan(0.86);
    expect(videoShare("tiktok", { photoApps: ["tiktok"] })).toBeLessThan(0.94);
    // Without TikTok photo posting, and on YouTube, every post is a video.
    expect(videoShare("tiktok")).toBe(1);
    expect(videoShare("youtube")).toBe(1);
    const ig = videoShare("instagram");
    expect(ig).toBeGreaterThan(0.5);
    expect(ig).toBeLessThan(0.6);
    const fb = videoShare("facebook");
    expect(fb).toBeGreaterThan(0.3);
    expect(fb).toBeLessThan(0.4);
    const li = videoShare("linkedin");
    expect(li).toBeGreaterThan(0.16);
    expect(li).toBeLessThan(0.24);
  });

  it("leans to video or pictures when the owner asks, TikTok and YouTube staying videos", () => {
    expect(videoShare("instagram", { preference: "video" })).toBeGreaterThan(0.8);
    expect(videoShare("linkedin", { preference: "video" })).toBeGreaterThan(0.45);
    expect(videoShare("instagram", { preference: "image" })).toBeLessThan(0.2);
    expect(videoShare("facebook", { preference: "image" })).toBeLessThan(0.15);
    expect(videoShare("tiktok", { preference: "image" })).toBe(1);
  });

  it("gives non-video posts a carousel for list angles and a single picture otherwise", () => {
    const never = () => 0.999;
    const { choices } = decideFormats(base({ slots: [slot("instagram", "tips"), slot("instagram", "story"), slot("linkedin", "how-it-works")], rng: never }));
    expect(choices.map((c) => c.format)).toEqual(["carousel", "image", "carousel"]);
  });

  it("is the same for the same seed", () => {
    const slots = [slot("instagram"), slot("facebook"), slot("linkedin"), slot("tiktok"), slot("youtube")];
    const a = decideFormats(base({ slots, maxVideos: 5, rng: seededRandom("same") }));
    const b = decideFormats(base({ slots, maxVideos: 5, rng: seededRandom("same") }));
    expect(a).toEqual(b);
  });
});

describe("plan and budget fallbacks", () => {
  const always = () => 0;

  it("without video in the plan: pictures on feed apps, a script to film (or a photo post) on TikTok and YouTube, and says why", () => {
    const { choices, notes } = decideFormats(base({ slots: [slot("instagram"), slot("tiktok"), slot("youtube")], videoInPlan: false, rng: always }));
    expect(choices).toEqual([{ format: "image" }, { format: "video", film: true }, { format: "video", film: true }]);
    expect(notes).toEqual(["TikTok gets a video script to film yourself: videos are not in your plan.", "YouTube gets a video script to film yourself: videos are not in your plan."]);
    const photo = decideFormats(base({ slots: [slot("tiktok")], videoInPlan: false, photoApps: ["tiktok"], rng: always }));
    expect(photo.choices).toEqual([{ format: "image" }]);
    expect(photo.notes[0]).toBe("TikTok gets a picture instead of a video: videos are not in your plan.");
  });

  it("gives the month's video seconds to TikTok and YouTube first, then the feed apps", () => {
    const slots = [slot("instagram"), slot("facebook"), slot("tiktok"), slot("youtube")];
    const { choices, notes } = decideFormats(base({ slots, videoSecondsLeft: 2 * VIDEO_SECONDS_PER_VIDEO + 10, maxVideos: 5, rng: always }));
    expect(choices.map((c) => c.format)).toEqual(["image", "image", "video", "video"]);
    expect(choices.some((c) => c.film)).toBe(false);
    // Feed apps quietly get pictures (BuPulse decided); with "Mostly video" the run says why.
    expect(notes).toEqual([]);
    const leaning = decideFormats(base({ slots, videoSecondsLeft: 2 * VIDEO_SECONDS_PER_VIDEO, maxVideos: 5, preference: "video", rng: always }));
    expect(leaning.notes).toEqual(["Instagram gets a picture instead of a video: your video seconds for this month are used up.", "Facebook gets a picture instead of a video: your video seconds for this month are used up."]);
  });

  it("films TikTok when the month's video seconds are used up, and says so", () => {
    const { choices, notes } = decideFormats(base({ slots: [slot("tiktok")], videoSecondsLeft: 20, rng: always }));
    expect(choices).toEqual([{ format: "video", film: true }]);
    expect(notes).toEqual(["TikTok gets a video script to film yourself: your video seconds for this month are used up."]);
  });

  it("makes at most MAX_RUN_VIDEOS videos a run; the owner's album videos cost nothing", () => {
    const slots = Array.from({ length: 7 }, () => slot("tiktok"));
    const capped = decideFormats(base({ slots, maxVideos: undefined, rng: always }));
    expect(capped.choices.filter((c) => c.format === "video" && !c.film)).toHaveLength(MAX_RUN_VIDEOS);
    expect(capped.notes).toEqual([`TikTok gets a video script to film yourself: a run makes at most ${MAX_RUN_VIDEOS} videos.`]);
    const free = decideFormats(base({ slots, videoSecondsLeft: 0, freeVideo: () => true, rng: always }));
    expect(free.choices.every((c) => c.format === "video" && !c.film)).toBe(true);
    expect(free.notes).toEqual([]);
  });
});

describe("day to day variety", () => {
  const recent = (network: Network, ...formats: ("image" | "carousel" | "video")[]) => ({ [network]: formats.map((format, i) => ({ day: `2026-10-${String(12 - i).padStart(2, "0")}`, format })) });

  it("never puts the same format on an app three days running", () => {
    const always = () => 0;
    expect(decideFormats(base({ recent: recent("instagram", "video", "video"), rng: always })).choices[0].format).toBe("image");
    const never = () => 0.999;
    expect(decideFormats(base({ recent: recent("instagram", "image", "image"), rng: never })).choices[0].format).toBe("carousel");
    expect(decideFormats(base({ slots: [slot("facebook", "tips")], recent: recent("facebook", "carousel", "carousel"), rng: never })).choices[0].format).toBe("image");
    // Two days that were not both the same, or not the two days just before: no rule.
    expect(repeatedFormat(recent("instagram", "video", "image"), "instagram", DAY)).toBeNull();
    expect(repeatedFormat({ instagram: [{ day: "2026-10-11", format: "video" }, { day: "2026-10-10", format: "video" }] }, "instagram", DAY)).toBeNull();
  });

  it("keeps TikTok and YouTube on video every day", () => {
    expect(decideFormats(base({ slots: [slot("tiktok")], recent: recent("tiktok", "video", "video"), rng: () => 0 })).choices[0].format).toBe("video");
  });

  it("reads saved content into each app's formats by day, newest first", () => {
    const rows = [
      { network: "instagram", format: "image", day: "2026-10-11" },
      { network: "instagram", format: "video", day: "2026-10-12" },
      { network: "tiktok", format: "video", day: "2026-10-13" },
      { network: "facebook", format: null, day: "2026-10-12" },
    ];
    expect(recentFormatsOf(rows, DAY)).toEqual({ instagram: [{ day: "2026-10-12", format: "video" }, { day: "2026-10-11", format: "image" }] });
  });
});

describe("media follows the decided formats", () => {
  const gallery = [
    { path: "u/p1.jpg", name: "p1.jpg", mimeType: "image/jpeg" },
    { path: "u/v1.mp4", name: "v1.mp4", mimeType: "video/mp4" },
  ];

  it("uses the album's video where it fits, else makes one, and films when no video can be made", () => {
    const networks: Network[] = ["instagram", "facebook", "linkedin", "tiktok"];
    const media = assignMedia({ networks, gallery, day: DAY, videoInPlan: true, choices: [{ format: "video" }, { format: "video" }, { format: "video" }, { format: "video", film: true }] });
    expect(media.map((m) => m.kind)).toEqual(["gallery-video", "gallery-video", "render-video", "script"]);
    expect(albumVideos(["instagram", "instagram", "linkedin", "tiktok"], gallery).map((v) => v?.path ?? null)).toEqual(["u/v1.mp4", null, null, "u/v1.mp4"]);
    expect(assignMedia({ networks: ["instagram"], gallery, day: DAY, videoInPlan: true, choices: [{ format: "carousel" }] })[0].kind).toBe("image");
  });
});

describe("the dialog's cost line with video seconds", () => {
  it("counts the videos BuPulse is likely to make, within the seconds left and the run's limit", () => {
    const networks: Network[] = ["instagram", "facebook", "tiktok"];
    expect(expectedVideos({ networks, perApp: 1, videoInPlan: true, videoSecondsLeft: 600 })).toBe(2);
    expect(expectedVideos({ networks, perApp: 1, preference: "video", videoInPlan: true, videoSecondsLeft: 600 })).toBe(3);
    expect(expectedVideos({ networks, perApp: 1, preference: "image", videoInPlan: true, videoSecondsLeft: 600 })).toBe(1);
    expect(expectedVideos({ networks, perApp: 3, preference: "video", videoInPlan: true, videoSecondsLeft: 6000 })).toBe(MAX_RUN_VIDEOS);
    expect(expectedVideos({ networks, perApp: 1, videoInPlan: true, videoSecondsLeft: 45 })).toBe(1);
    expect(expectedVideos({ networks, perApp: 1, videoInPlan: false, videoSecondsLeft: 600 })).toBe(0);

    const videos = expectedVideos({ networks, perApp: 1, videoInPlan: true, videoSecondsLeft: 600 });
    const cost = runCost({ mode: "ai", design: "free", posts: 3, designed: 2, aiPhotos: false, textLeft: 10, imagesLeft: 0, videos, videoSecondsLeft: 600 });
    expect(cost.videoSeconds).toBe(60);
    expect(cost.message).toBe("Uses 3 text generations, no AI images and up to 60 video seconds; you have 10 text generations and 600 video seconds left this month.");
  });
});
