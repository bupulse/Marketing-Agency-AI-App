import { describe, expect, it } from "vitest";
import { needsInstagramVariant, noMusicVariantOf, soundChoice, variantPathOf, type VariantPost } from "@/lib/visuals/ig-variant";
import { instagramSoundMode, isFacebookLoginInstagram } from "@/lib/social/instagram-sound-mode";
import { postSoundFields } from "@/lib/publishing/sound-fields";

const FB_LOGIN = { provider: "instagram", method: "DIRECT", scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "meta_uid:1"] };
const IG_LOGIN = { provider: "instagram", method: "DIRECT", scopes: ["instagram_business_basic", "instagram_business_content_publish", "meta_uid:2"] };
const COMPOSIO = { provider: "instagram", method: "COMPOSIO", scopes: ["composio", "composio_account:ca_1"] };

const post = (connection: VariantPost["connection"], over: Partial<VariantPost> = {}): VariantPost => ({ network: "instagram", status: "SCHEDULED", connection, ...over });

describe("which Instagram connections take a trending sound from BuPulse", () => {
  it("only Facebook Login, through BuPulse's own app", () => {
    expect(isFacebookLoginInstagram(FB_LOGIN)).toBe(true);
    expect(isFacebookLoginInstagram(IG_LOGIN)).toBe(false);
    expect(isFacebookLoginInstagram(COMPOSIO)).toBe(false);
    expect(isFacebookLoginInstagram({ ...FB_LOGIN, scopes: [...FB_LOGIN.scopes, "uploadpost"] })).toBe(false);
    expect(isFacebookLoginInstagram({ ...FB_LOGIN, provider: "facebook" })).toBe(false);
    expect(isFacebookLoginInstagram(null)).toBe(false);
    expect(instagramSoundMode(FB_LOGIN)).toBe("auto");
    expect(instagramSoundMode(IG_LOGIN)).toBe("tip");
    expect(instagramSoundMode(null)).toBe("tip");
  });
});

describe("the reel's Instagram version without music: made only when it will be used", () => {
  it("made for a reel with music and a Facebook Login Instagram post still to go out", () => {
    expect(needsInstagramVariant({ hasMusic: true, posts: [post(FB_LOGIN)] })).toBe(true);
    expect(needsInstagramVariant({ hasMusic: true, mimeType: "video/mp4", posts: [post(IG_LOGIN), post(FB_LOGIN, { status: "PENDING_APPROVAL" })] })).toBe(true);
  });

  it("not made without library music, for a WebM, or without such a post", () => {
    expect(needsInstagramVariant({ hasMusic: false, posts: [post(FB_LOGIN)] })).toBe(false);
    expect(needsInstagramVariant({ hasMusic: true, mimeType: "video/webm", posts: [post(FB_LOGIN)] })).toBe(false);
    expect(needsInstagramVariant({ hasMusic: true, posts: [] })).toBe(false);
    expect(needsInstagramVariant({ hasMusic: true, posts: [post(IG_LOGIN), post(COMPOSIO), post(null)] })).toBe(false);
    // Facebook, TikTok and YouTube keep the music: their posts never ask for the version.
    expect(needsInstagramVariant({ hasMusic: true, posts: [post({ ...FB_LOGIN, provider: "facebook" }, { network: "facebook" }), post(null, { network: "tiktok" })] })).toBe(false);
    // Posts that went out (or failed, were cancelled) do not need it any more.
    expect(needsInstagramVariant({ hasMusic: true, posts: [post(FB_LOGIN, { status: "PUBLISHED" }), post(FB_LOGIN, { status: "FAILED" })] })).toBe(false);
  });

  it("stored next to the reel as .nomusic.mp4, MP4 only, and found among the visual's items", () => {
    expect(variantPathOf("u1/videos/v1-abcd1.mp4")).toBe("u1/videos/v1-abcd1.nomusic.mp4");
    expect(variantPathOf("u1/videos/v1-abcd1.webm")).toBeNull();
    expect(variantPathOf("u1/videos/v1-abcd1.nomusic.mp4")).toBeNull();
    expect(noMusicVariantOf([{ path: "u1/videos/v1-a.mp4" }, { path: "u1/videos/v1-a.nomusic.mp4", variant: "no-music" }])).toBe("u1/videos/v1-a.nomusic.mp4");
    // A leftover from an older reel is not this reel's version.
    expect(noMusicVariantOf([{ path: "u1/videos/v1-b.mp4" }, { path: "u1/videos/v1-a.nomusic.mp4", variant: "no-music" }])).toBeNull();
    expect(noMusicVariantOf([{ path: "u1/videos/v1-a.mp4" }])).toBeNull();
    expect(noMusicVariantOf([])).toBeNull();
  });
});

describe("which file carries the trending sound (never two songs at once)", () => {
  it("a reel with library music: only through its version without music", () => {
    expect(soundChoice({ kind: "visual", mainPath: "m.mp4", hasMusic: true, variantPath: "m.nomusic.mp4" })).toEqual({ attach: true, path: "m.nomusic.mp4", withoutMusic: true });
    expect(soundChoice({ kind: "visual", mainPath: "m.mp4", hasMusic: true, variantPath: null })).toMatchObject({ attach: false });
  });

  it("a reel without music, or the company's own video: the reel itself", () => {
    expect(soundChoice({ kind: "visual", mainPath: "m.mp4", hasMusic: false, variantPath: null })).toEqual({ attach: true, path: "m.mp4", withoutMusic: false });
    expect(soundChoice({ kind: "own", mainPath: "o.mp4" })).toEqual({ attach: true, path: "o.mp4", withoutMusic: false });
  });

  it("a Video Studio MP4 keeps its own music: no sound", () => {
    expect(soundChoice({ kind: "studio", mainPath: "s.mp4" })).toMatchObject({ attach: false });
  });
});

describe("what the post screens get", () => {
  it("Instagram reels say how the sound comes; other posts say nothing", () => {
    expect(postSoundFields({ network: "instagram", format: "POST", mediaPaths: ["u/videos/a.mp4"], connection: { method: "DIRECT", scopes: FB_LOGIN.scopes } })).toEqual({ instagramSound: "auto" });
    expect(postSoundFields({ network: "instagram", format: "POST", mediaPaths: ["u/videos/a.mp4"], connection: { method: "COMPOSIO", scopes: COMPOSIO.scopes } })).toEqual({ instagramSound: "tip" });
    expect(postSoundFields({ network: "instagram", format: "SCRIPT", mediaPaths: [], connection: null })).toEqual({ instagramSound: "tip" });
    expect(postSoundFields({ network: "instagram", format: "POST", mediaPaths: ["u/a.jpg"], connection: null })).toEqual({});
    expect(postSoundFields({ network: "tiktok", format: "POST", mediaPaths: ["u/videos/a.mp4"], connection: null })).toEqual({});
  });

  it("the sound that went out is shown", () => {
    const out = postSoundFields({ network: "instagram", format: "POST", mediaPaths: ["u/videos/a.mp4"], trendingSound: { audioId: "1", title: "Calm Down", artist: "Rema", link: null, attachedAt: "x" }, connection: { method: "DIRECT", scopes: FB_LOGIN.scopes } });
    expect(out.trendingSound).toEqual({ title: "Calm Down", artist: "Rema", link: null });
  });
});
