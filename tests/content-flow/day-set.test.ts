import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/music/service", () => ({ trackForVideo: vi.fn(async () => null) }));

import { clampImageCount, decideDayFormat, distributeRound, draftFormatOf, imageCountFor, packFormatOf, recentDayFormat, roundNeedsImages, roundsOf } from "@/lib/content-flow/day-set";
import { chooseDayVideoKind, studioVideoOptions } from "@/lib/content-flow/video-kind";
import { reelPlanFromSet } from "@/lib/content-flow/set-reel";
import { readSets, setLines } from "@/lib/ai/pack";
import { VIDEO_LIMITS } from "@/lib/visuals/types";

const DAY = "2026-11-11";
const fixed = (value: number) => () => value;

describe("the day's format, decided once", () => {
  it("is a pictures day without a video BuPulse can make, or when the owner asks for pictures", () => {
    expect(decideDayFormat({ day: DAY, videoPossible: false, rng: fixed(0) }).format).toBe("images");
    expect(decideDayFormat({ day: DAY, preference: "image", videoPossible: true, rng: fixed(0) }).format).toBe("images");
  });
  it("draws a video day by the share, more often after two pictures days, never after two video days", () => {
    expect(decideDayFormat({ day: DAY, videoPossible: true, rng: fixed(0.3) }).format).toBe("video");
    expect(decideDayFormat({ day: DAY, videoPossible: true, rng: fixed(0.5) }).format).toBe("images");
    const pictures = { facebook: [{ day: "2026-11-10", format: "image" as const }, { day: "2026-11-09", format: "carousel" as const }] };
    expect(decideDayFormat({ day: DAY, videoPossible: true, recent: pictures, rng: fixed(0.5) }).format).toBe("video");
    const videos = { facebook: [{ day: "2026-11-10", format: "video" as const }, { day: "2026-11-09", format: "video" as const }] };
    expect(decideDayFormat({ day: DAY, videoPossible: true, recent: videos, rng: fixed(0) }).format).toBe("images");
    expect(decideDayFormat({ day: DAY, preference: "video", videoPossible: true, recent: videos, rng: fixed(0.5) }).format).toBe("video");
  });
  it("tells a video day by Facebook, LinkedIn or X having a video (Instagram has a reel every day)", () => {
    expect(recentDayFormat({ instagram: [{ day: DAY, format: "video" }], facebook: [{ day: DAY, format: "image" }] }, DAY)).toBe("images");
    expect(recentDayFormat({ facebook: [{ day: DAY, format: "video" }] }, DAY)).toBe("video");
    expect(recentDayFormat({}, DAY)).toBeNull();
  });
});

describe("one shared set, distributed", () => {
  it("puts the k-th post of each app in round k", () => {
    expect(roundsOf(["linkedin", "facebook", "linkedin"])).toEqual([["linkedin", "facebook"], ["linkedin"]]);
  });
  it("pictures day: Instagram and TikTok the reel, Facebook, LinkedIn and X the pictures", () => {
    expect(distributeRound({ networks: ["instagram", "tiktok", "facebook", "linkedin", "twitter"], format: "images", reel: true })).toEqual([
      { network: "instagram", role: "reel" },
      { network: "tiktok", role: "reel" },
      { network: "facebook", role: "images" },
      { network: "linkedin", role: "images" },
      { network: "twitter", role: "images" },
    ]);
  });
  it("video day: Facebook gets two posts, the pictures and the reel", () => {
    expect(distributeRound({ networks: ["facebook", "youtube"], format: "video", reel: true })).toEqual([
      { network: "facebook", role: "images" },
      { network: "facebook", role: "reel", companion: true },
      { network: "youtube", role: "reel" },
    ]);
  });
  it("without a reel: Instagram gets the pictures, TikTok and YouTube the script to film, Facebook no second post", () => {
    expect(distributeRound({ networks: ["instagram", "tiktok", "facebook"], format: "video", reel: false }).map((s) => [s.network, s.role])).toEqual([
      ["instagram", "images"],
      ["tiktok", "film"],
      ["facebook", "images"],
    ]);
  });
  it("formats, and whether the pictures are drawn at all", () => {
    expect(packFormatOf("images", 3)).toBe("carousel");
    expect(packFormatOf("images", 1)).toBe("image");
    expect(packFormatOf("reel", 3)).toBe("video");
    expect(draftFormatOf("images")).toBe("POST");
    expect(draftFormatOf("film")).toBe("SCRIPT");
    expect(roundNeedsImages([{ network: "tiktok", role: "film" }], false)).toBe(false);
    expect(roundNeedsImages([{ network: "tiktok", role: "reel" }], true)).toBe(true);
    expect(roundNeedsImages([{ network: "tiktok", role: "reel" }], false)).toBe(false);
  });
  it("counts pictures by the idea (1 for a tip, 2 or 3 for an offer or before / after, 4 for a range) within what can be made", () => {
    expect(imageCountFor("tip-of-day", 5)).toBe(1);
    expect(imageCountFor("before-after", 5)).toBe(2);
    expect(imageCountFor("features", 5)).toBe(3);
    expect(imageCountFor("spotlight", 5)).toBe(4);
    expect(clampImageCount(4, { aiImages: 1, photos: 1 })).toBe(2);
    expect(clampImageCount(4, { aiImages: 9, photos: 0 })).toBe(4);
    expect(clampImageCount(3, { aiImages: 0, photos: 0 })).toBe(1);
  });
});

describe("the studio decides the video", () => {
  it("a pictures day is the slideshow from its pictures; a skit day is the skit", () => {
    expect(chooseDayVideoKind({ format: "images" }).kind).toBe("slideshow");
    expect(chooseDayVideoKind({ format: "video", skitDay: true }).kind).toBe("skit");
  });
  it("a video day takes the first available kind that suits the idea, else the slideshow, and says why", () => {
    const ugc = { available: true };
    expect(chooseDayVideoKind({ format: "video", angle: "price", ugc }).kind).toBe("ugc");
    expect(chooseDayVideoKind({ format: "video", angle: "tip-of-day", ugc, seedance: { available: true } }).kind).toBe("slideshow");
    expect(chooseDayVideoKind({ format: "video", angle: "features", seedance: { available: true } }).kind).toBe("seedance");
    expect(chooseDayVideoKind({ format: "video", albumVideo: true }).kind).toBe("album");
    expect(chooseDayVideoKind({ format: "video", aiClips: true }).kind).toBe("ai-clips");
    const plain = chooseDayVideoKind({ format: "video", angle: "price", ...studioVideoOptions() });
    expect(plain.kind).toBe("slideshow");
    expect(plain.passed.map((p) => p.kind)).toEqual(["ugc", "seedance", "album"]);
  });
});

describe("the writer plans the sets in the captions' call", () => {
  it("tells it which posts share a set, the pictures' range and the reel with its voice-over", () => {
    const lines = setLines([{ slots: [0, 1, 2], maxImages: 4, reel: true }, { slots: [3], maxImages: 1, reel: false }]);
    expect(lines.join("\n")).toContain("Set 1 (posts 1, 2, 3): 1 to 4 pictures");
    expect(lines.join("\n")).toContain("voice-over line");
    expect(lines.join("\n")).toContain("Set 2 (posts 4): exactly 1 picture");
    expect(setLines([])).toEqual([]);
  });
  it("reads the sets leniently: pictures within the range, reel scenes only when the set has a reel", () => {
    const sets = readSets(
      [
        { set: 1, images: [1, 2, 3, 4, 5].map((n) => ({ headline: `H${n}`, idea: `I${n}` })), reel: { scenes: [{ onScreen: "A", voice: "Say A." }, { onScreen: "B", voice: "" }], cta: "Call" } },
        { set: 2, images: [{ headline: "Only", idea: "One" }], reel: { scenes: [{ onScreen: "X", voice: "x" }, { onScreen: "Y", voice: "y" }], cta: "" } },
      ],
      [{ slots: [0], maxImages: 3, reel: true }, { slots: [1], maxImages: 2, reel: false }, { slots: [2], maxImages: 1, reel: false }],
    );
    expect(sets[0]!.images.map((i) => i.headline)).toEqual(["H1", "H2", "H3"]);
    expect(sets[0]!.reel).toEqual({ scenes: [{ onScreen: "A", voice: "Say A." }, { onScreen: "B", voice: "B" }], cta: "Call" });
    expect(sets[1]!.reel).toBeNull();
    expect(sets[2]).toBeNull();
  });
});

describe("the reel made from the day's pictures", () => {
  const draft = { kind: "slideshow" as const, hook: "Greens at school", cta: "Message us", scenes: [{ onScreen: "Greens at school", voice: "Imagine fresh greens in class." }, { onScreen: "40 plants, one tower", voice: "One tower grows forty plants." }], language: "English", mood: "upbeat" };
  it("shows every picture in turn, with words on screen and one voice-over line per scene", () => {
    const plan = reelPlanFromSet(draft, ["u1/designs/a.png", "u1/designs/b.png"], { businessName: "Green Kigali", colors: ["#0a7"], pack: "fresh", groupId: "g1" });
    expect(plan.scenes.map((s) => [s.text, s.photoPath])).toEqual([
      ["Greens at school", "u1/designs/a.png"],
      ["40 plants, one tower", "u1/designs/b.png"],
      ["Message us", "u1/designs/a.png"],
    ]);
    expect(plan.voiceScript).toEqual(["Imagine fresh greens in class.", "One tower grows forty plants.", "Message us."]);
    expect(plan).toMatchObject({ videoKind: "slideshow", daySetId: "g1", language: "English" });
    expect(plan.totalMs).toBeGreaterThanOrEqual(VIDEO_LIMITS.minMs);
    expect(plan.totalMs).toBeLessThanOrEqual(VIDEO_LIMITS.maxMs);
  });
  it("marks a reel with AI clips for them", () => {
    expect(reelPlanFromSet({ ...draft, kind: "ai-clips" }, ["a.png"], { businessName: "B", colors: [], pack: "fresh", groupId: "g" }).quality).toBe("ai");
  });
});
