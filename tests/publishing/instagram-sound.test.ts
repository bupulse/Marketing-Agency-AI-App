import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    contentVisual: { findFirst: vi.fn() },
    videoJob: { findFirst: vi.fn() },
  },
  trendingAudioFor: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/social/trending-sounds", () => ({ trendingAudioFor: mocks.trendingAudioFor }));

import { attachedSound, prepareInstagramSound, soundRequest } from "@/lib/publishing/instagram-sound";

const FB = { connectionId: "c", externalAccountId: "17841", accountType: "business", accessToken: "EAtoken", method: "DIRECT" as const };
const MAIN = "u1/videos/v1-abcd1.mp4";
const VARIANT = "u1/videos/v1-abcd1.nomusic.mp4";
const post = { id: "p1", businessId: "b1", network: "instagram", mediaPaths: [MAIN] };
const SONG = { id: "587784541076604", title: "Calm Down", artist: "Rema", explicit: false, durationMs: null, coverUrl: null, link: null, type: "music" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.logError.mockResolvedValue(undefined);
  mocks.trendingAudioFor.mockResolvedValue([SONG]);
  mocks.prisma.videoJob.findFirst.mockResolvedValue(null);
  mocks.prisma.contentVisual.findFirst.mockResolvedValue({ items: [{ path: MAIN }, { path: VARIANT, variant: "no-music" }], plan: { version: 1, scenes: [], music: { trackId: "t", title: "Song", path: "t.mp3", attribution: "" } } });
});

describe("the trending sound at publish time", () => {
  it("a BuPulse reel with music goes out as its version without music, with the top trending song", async () => {
    const prepared = await prepareInstagramSound(post, FB);
    expect(prepared).toEqual({ path: VARIANT, withoutMusic: true, audio: SONG });
    expect(mocks.trendingAudioFor).toHaveBeenCalledWith({ externalAccountId: "17841", accessToken: "EAtoken" }, expect.any(Date));
    expect(soundRequest(prepared!, "https://signed/main.mp4")).toMatchObject({ audioId: SONG.id, audioVolume: 40, videoVolume: 100, fallbackVideoUrl: "https://signed/main.mp4" });
    expect(attachedSound(SONG, new Date("2026-11-13T10:00:00Z"))).toEqual({ audioId: SONG.id, title: "Calm Down", artist: "Rema", link: null, attachedAt: "2026-11-13T10:00:00.000Z" });
  });

  it("no version without music: the reel goes out as before, with its music and no sound", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ items: [{ path: MAIN }], plan: { version: 1, scenes: [], music: { trackId: "t", title: "Song", path: "t.mp3", attribution: "" } } });
    expect(await prepareInstagramSound(post, FB)).toBeNull();
    expect(mocks.trendingAudioFor).not.toHaveBeenCalled();
  });

  it("the company's own uploaded video takes the sound as it is; a Video Studio MP4 does not", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(null);
    mocks.prisma.videoJob.findFirst.mockResolvedValue({ engine: "upload" });
    expect(await prepareInstagramSound(post, FB)).toMatchObject({ path: MAIN, withoutMusic: false });
    mocks.prisma.videoJob.findFirst.mockResolvedValue({ engine: "motion" });
    expect(await prepareInstagramSound(post, FB)).toBeNull();
  });

  it("only for a single video on a Facebook Login account through BuPulse's own app", async () => {
    expect(await prepareInstagramSound(post, { ...FB, accessToken: "IGtoken" })).toBeNull();
    expect(await prepareInstagramSound(post, { ...FB, method: "COMPOSIO" })).toBeNull();
    expect(await prepareInstagramSound(post, { ...FB, uploadPostProfile: "p" })).toBeNull();
    expect(await prepareInstagramSound({ ...post, network: "facebook" }, FB)).toBeNull();
    expect(await prepareInstagramSound({ ...post, mediaPaths: ["u1/a.jpg"] }, FB)).toBeNull();
    expect(mocks.trendingAudioFor).not.toHaveBeenCalled();
  });

  it("no trending song, or any error, never stops the post", async () => {
    mocks.trendingAudioFor.mockResolvedValue([]);
    expect(await prepareInstagramSound(post, FB)).toBeNull();
    mocks.prisma.contentVisual.findFirst.mockRejectedValue(new Error("db down"));
    expect(await prepareInstagramSound(post, FB)).toBeNull();
    expect(mocks.logError).toHaveBeenCalled();
  });
});
