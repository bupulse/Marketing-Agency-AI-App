import { describe, expect, it } from "vitest";
import { acceptsVideo, composerMediaFor, mediaForPost } from "@/lib/visuals/post-media";

const IG = { formats: ["POST", "CAROUSEL", "SCRIPT"], maxImages: 10, videoOnly: false };
const FB = { formats: ["POST", "CAROUSEL"], maxImages: 10, videoOnly: false };
const LI = { formats: ["POST", "CAROUSEL", "ARTICLE"], maxImages: 9, videoOnly: false };
const TT = { formats: ["SCRIPT"], maxImages: 35, videoOnly: true };
const slides = ["u/designs/1.png", "u/designs/2.png", "u/designs/3.png"];
const video = "u/videos/v1-abcd.mp4";

describe("mediaForPost", () => {
  it("feed posts take the carousel where the network has carousels, else the first slide", () => {
    expect(mediaForPost({ network: "instagram", format: "POST", rules: IG, images: slides, video })).toEqual({ format: "CAROUSEL", mediaPaths: slides });
    expect(mediaForPost({ network: "linkedin", format: "POST", rules: { ...LI, formats: ["POST"] }, images: slides, video })).toEqual({ format: "POST", mediaPaths: [slides[0]] });
    expect(mediaForPost({ network: "facebook", format: "CAROUSEL", rules: { ...FB, maxImages: 2 }, images: slides, video: null })).toEqual({ format: "CAROUSEL", mediaPaths: slides.slice(0, 2) });
    expect(mediaForPost({ network: "facebook", format: "POST", rules: FB, images: [slides[0]], video: null })).toEqual({ format: "POST", mediaPaths: [slides[0]] });
  });

  it("video ideas become video posts on Instagram and Facebook, and keep the reminder with the video on TikTok", () => {
    expect(mediaForPost({ network: "instagram", format: "SCRIPT", rules: IG, images: slides, video })).toEqual({ format: "POST", mediaPaths: [video] });
    expect(mediaForPost({ network: "facebook", format: "SCRIPT", rules: FB, images: slides, video })).toEqual({ format: "POST", mediaPaths: [video] });
    expect(mediaForPost({ network: "tiktok", format: "SCRIPT", rules: TT, images: slides, video })).toEqual({ format: "SCRIPT", mediaPaths: [video] });
    expect(mediaForPost({ network: "instagram", format: "SCRIPT", rules: IG, images: slides, video: null })).toEqual({ format: "SCRIPT", mediaPaths: [] });
  });

  it("Instagram takes MP4 only; articles carry nothing", () => {
    expect(acceptsVideo("instagram", "u/videos/v-abcd.webm")).toBe(false);
    expect(acceptsVideo("facebook", "u/videos/v-abcd.webm")).toBe(true);
    expect(acceptsVideo("linkedin", video)).toBe(false);
    expect(mediaForPost({ network: "instagram", format: "SCRIPT", rules: IG, images: [], video: "u/videos/v-abcd.webm" })).toEqual({ format: "SCRIPT", mediaPaths: ["u/videos/v-abcd.webm"] });
    expect(mediaForPost({ network: "linkedin", format: "ARTICLE", rules: LI, images: slides, video })).toEqual({ format: "ARTICLE", mediaPaths: [] });
  });
});

describe("composerMediaFor", () => {
  it("a video goes alone where it can, with TikTok's reminder, and LinkedIn gets the pictures", () => {
    expect(composerMediaFor("instagram", false, [video, slides[0]], slides)).toEqual([video]);
    expect(composerMediaFor("tiktok", true, [video], slides)).toEqual([video]);
    expect(composerMediaFor("linkedin", false, [video, slides[0]], slides)).toEqual([slides[0]]);
    expect(composerMediaFor("linkedin", false, [video], slides)).toEqual(slides);
    expect(composerMediaFor("facebook", false, slides, [])).toEqual(slides);
  });
});
