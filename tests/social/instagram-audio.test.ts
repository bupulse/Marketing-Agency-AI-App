import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  audioConfiguration,
  cleanTrendingTips,
  fetchAudio,
  fetchTrendingAudio,
  IG_SOUND_VOLUME,
  isFacebookLoginToken,
  parseAudioList,
  parseTrendingLines,
  pickTrendingAudio,
  readAttachedSound,
  soundLabel,
  tipsFromAudio,
  trendingLines,
} from "@/lib/social/instagram-audio";
import { instagramProvider, POLL } from "@/lib/social/providers/instagram";

type Handler = (url: string, body: URLSearchParams | null) => unknown;
function fakeFetch(handler: Handler) {
  const calls: { url: string; body: URLSearchParams | null; auth: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body instanceof URLSearchParams ? init.body : null;
      calls.push({ url, body, auth: new Headers(init?.headers).get("authorization") });
      const out = handler(url, body);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), { status: 200 });
    }),
  );
  return calls;
}

beforeEach(() => {
  POLL.intervalMs = 1;
  POLL.deadlineMs = 200;
});
afterEach(() => vi.unstubAllGlobals());

// The docs' sample (search): an `audio` array; field names differ between search and metadata.
const SAMPLE = {
  audio: [
    { audio_id: "587784541076604", title: "Calm Down", display_artist: "Rema", duration_in_ms: 239000, audio_type: 1, cover_artwork_thumbnail_uri: "https://cdn.example.com/c.jpg", on_platform_audio_preview_link: "https://www.instagram.com/reels/audio/587784541076604/" },
    { audio_id: "222", title: "Explicit one", display_artist: "X", is_explicit: true },
    { audio_id: "333", title: "Original", ig_username: "someone", audio_type: "original_sound" },
    { title: "No id" },
    { audio_id: "587784541076604", title: "Duplicate" },
  ],
};

describe("parsing the Audio API's answers", () => {
  it("reads the docs' sample shape, defensively", () => {
    const list = parseAudioList(SAMPLE);
    expect(list.map((a) => a.id)).toEqual(["587784541076604", "222", "333"]);
    expect(list[0]).toEqual({ id: "587784541076604", title: "Calm Down", artist: "Rema", explicit: false, durationMs: 239000, coverUrl: "https://cdn.example.com/c.jpg", link: "https://www.instagram.com/reels/audio/587784541076604/", type: "music" });
    expect(list[1].explicit).toBe(true);
    expect(list[2]).toMatchObject({ artist: "someone", type: "original_sound" });
  });

  it("takes a data array, the metadata _url field and a string audio_type", () => {
    const [a] = parseAudioList({ data: [{ id: 99, name: "Song", artist_name: "Band", cover_artwork_thumbnail_url: "https://cdn.example.com/u.jpg", audio_type: "MUSIC" }] });
    expect(a).toMatchObject({ id: "99", title: "Song", artist: "Band", coverUrl: "https://cdn.example.com/u.jpg", type: "music" });
    expect(parseAudioList(null)).toEqual([]);
    expect(parseAudioList({ audio: "nope" })).toEqual([]);
    // Ids that could break a URL path are refused; http links are dropped.
    expect(parseAudioList([{ audio_id: "../x", title: "t" }])).toEqual([]);
    expect(parseAudioList([{ audio_id: "1", title: "t", on_platform_audio_preview_link: "http://x.example" }])[0].link).toBeNull();
  });

  it("picks the top trending song that is not explicit (music before original sounds)", () => {
    const list = parseAudioList(SAMPLE);
    expect(pickTrendingAudio(list)?.id).toBe("587784541076604");
    expect(pickTrendingAudio(list.slice(1))?.id).toBe("333");
    expect(pickTrendingAudio([list[1]])).toBeNull();
    expect(pickTrendingAudio([])).toBeNull();
  });

  it("builds audio_configuration with the voice-over first volumes, clamped to 1-100", () => {
    expect(JSON.parse(audioConfiguration("123"))).toEqual({ audio_id: "123", audio_volume: IG_SOUND_VOLUME.audio, video_volume: IG_SOUND_VOLUME.video });
    expect(IG_SOUND_VOLUME.audio).toBeGreaterThanOrEqual(35);
    expect(IG_SOUND_VOLUME.audio).toBeLessThanOrEqual(45);
    expect(JSON.parse(audioConfiguration("1", { audio: 0, video: 250 }))).toEqual({ audio_id: "1", audio_volume: 1, video_volume: 100 });
  });

  it("tells Facebook Login tokens from Instagram Login ones", () => {
    expect(isFacebookLoginToken("EAAB...")).toBe(true);
    expect(isFacebookLoginToken("IGQV...")).toBe(false);
    expect(isFacebookLoginToken("")).toBe(false);
  });
});

describe("asking Meta for trending audio", () => {
  it("calls ig_audio on graph.facebook.com without search words, the token in the Bearer header", async () => {
    const calls = fakeFetch(() => SAMPLE);
    const list = await fetchTrendingAudio("EAtoken", "17841");
    expect(list).toHaveLength(3);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/ig_audio$/);
    expect(url.searchParams.get("audio_type")).toBe("music");
    expect(url.searchParams.get("user_id")).toBe("17841");
    expect(url.searchParams.has("search_query")).toBe(false);
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(calls[0].auth).toBe("Bearer EAtoken");
  });

  it("passes search words when given, and reads one audio's metadata", async () => {
    const calls = fakeFetch((url) => (url.includes("/ig_audio") ? { audio: [] } : { audio_id: "5", title: "Meta song", display_artist: "A" }));
    await fetchTrendingAudio("EAtoken", "17841", { search: "afrobeat" });
    expect(new URL(calls[0].url).searchParams.get("search_query")).toBe("afrobeat");
    expect(await fetchAudio("EAtoken", "17841", "5")).toMatchObject({ id: "5", title: "Meta song" });
    expect(await fetchAudio("EAtoken", "17841", "../bad")).toBeNull();
  });

  it("throws a SocialError when Meta refuses (the caller falls back)", async () => {
    fakeFetch(() => new Response(JSON.stringify({ error: { message: "(#10) Application does not have permission", code: 10 } }), { status: 400 }));
    await expect(fetchTrendingAudio("EAtoken", "17841")).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("Instagram Reels with a trending sound", () => {
  const FB = { connectionId: "c", externalAccountId: "17841", accountType: "business", accessToken: "EAtoken" };
  const IG = { ...FB, accessToken: "IGtoken" };
  const variant = { url: "https://signed.example.com/v.nomusic.mp4", mimeType: "video/mp4" };
  const sound = { audioId: "587784541076604", audioVolume: 40, videoVolume: 100, fallbackVideoUrl: "https://signed.example.com/v.mp4", fallbackText: "Watch\n\nMusic: Song" };

  it("attaches the sound with audio_configuration on the reel without our music", async () => {
    const calls = fakeFetch((url) => {
      if (url.includes("content_publishing_limit")) return { data: [] };
      if (url.endsWith("/17841/media")) return { id: "reel1" };
      if (url.includes("/reel1?")) return { status_code: "FINISHED" };
      if (url.endsWith("/media_publish")) return { id: "media9" };
      return { permalink: "https://instagram.com/reel/x" };
    });
    const result = await instagramProvider.publish(FB, { format: "POST", text: "Watch", media: [variant], sound });
    expect(result).toMatchObject({ externalId: "media9", soundAttached: true });
    const creates = calls.filter((c) => c.url.endsWith("/17841/media"));
    expect(creates).toHaveLength(1);
    expect(creates[0].body!.get("video_url")).toBe(variant.url);
    expect(creates[0].body!.get("caption")).toBe("Watch");
    expect(JSON.parse(creates[0].body!.get("audio_configuration")!)).toEqual({ audio_id: "587784541076604", audio_volume: 40, video_volume: 100 });
  });

  it("falls back to the reel with its music (and its credit) when Instagram refuses the sound", async () => {
    const calls = fakeFetch((url, body) => {
      if (url.includes("content_publishing_limit")) return { data: [] };
      if (url.endsWith("/17841/media")) return body?.get("audio_configuration") ? new Response(JSON.stringify({ error: { message: "Permissions error", code: 200 } }), { status: 403 }) : { id: "plain1" };
      if (url.includes("/plain1?")) return { status_code: "FINISHED" };
      if (url.endsWith("/media_publish")) return { id: "media10" };
      return {};
    });
    const result = await instagramProvider.publish(FB, { format: "POST", text: "Watch", media: [variant], sound });
    expect(result).toMatchObject({ externalId: "media10", soundAttached: false });
    const plain = calls.filter((c) => c.url.endsWith("/17841/media")).at(-1)!;
    expect(plain.body!.get("audio_configuration")).toBeNull();
    expect(plain.body!.get("video_url")).toBe(sound.fallbackVideoUrl);
    expect(plain.body!.get("caption")).toBe(sound.fallbackText);
  });

  it("falls back when the reel with the sound fails processing", async () => {
    fakeFetch((url, body) => {
      if (url.includes("content_publishing_limit")) return { data: [] };
      if (url.endsWith("/17841/media")) return { id: body?.get("audio_configuration") ? "withsound" : "plain" };
      if (url.includes("/withsound?")) return { status_code: "ERROR", status: "bad audio" };
      if (url.includes("/plain?")) return { status_code: "FINISHED" };
      if (url.endsWith("/media_publish")) return { id: body?.get("creation_id") === "plain" ? "ok" : "wrong" };
      return {};
    });
    expect(await instagramProvider.publish(FB, { format: "POST", text: "Watch", media: [variant], sound })).toMatchObject({ externalId: "ok", soundAttached: false });
  });

  it("never sends audio_configuration with an Instagram Login token", async () => {
    const calls = fakeFetch((url) => {
      if (url.includes("content_publishing_limit")) return { data: [] };
      if (url.endsWith("/17841/media")) return { id: "r" };
      if (url.includes("/r?")) return { status_code: "FINISHED" };
      if (url.endsWith("/media_publish")) return { id: "m" };
      return {};
    });
    await instagramProvider.publish(IG, { format: "POST", text: "Watch", media: [variant], sound });
    const creates = calls.filter((c) => c.url.endsWith("/17841/media"));
    expect(creates).toHaveLength(1);
    expect(creates[0].body!.get("audio_configuration")).toBeNull();
    expect(creates[0].body!.get("video_url")).toBe(sound.fallbackVideoUrl);
  });

  it("stops on a rate limit instead of posting without the sound", async () => {
    fakeFetch((url) => {
      if (url.includes("content_publishing_limit")) return { data: [] };
      if (url.endsWith("/17841/media")) return new Response(JSON.stringify({ error: { message: "Too many calls", code: 4 } }), { status: 400 });
      return {};
    });
    await expect(instagramProvider.publish(FB, { format: "POST", text: "Watch", media: [variant], sound })).rejects.toMatchObject({ kind: "rate_limit" });
  });
});

describe("the trending sound tip", () => {
  it("reads the admin's lines: title | artist | Instagram link", () => {
    const tips = parseTrendingLines("Calm Down | Rema | https://www.instagram.com/reels/audio/1/\nJust a title\n  \nBad link | A | https://evil.example.com/x\n| no title");
    expect(tips).toEqual([
      { title: "Calm Down", artist: "Rema", link: "https://www.instagram.com/reels/audio/1/" },
      { title: "Just a title", artist: null, link: null },
      { title: "Bad link", artist: "A", link: null },
    ]);
    expect(parseTrendingLines(trendingLines(tips))).toEqual(tips);
  });

  it("keeps at most 10 and needs a title", () => {
    expect(cleanTrendingTips(Array.from({ length: 15 }, (_, i) => ({ title: `S${i}` })))).toHaveLength(10);
    expect(cleanTrendingTips([{ artist: "x" }, null, "x"])).toEqual([]);
    expect(cleanTrendingTips("nope")).toEqual([]);
  });

  it("turns API audio into tips, leaving explicit ones out", () => {
    expect(tipsFromAudio(parseAudioList(SAMPLE)).map((t) => t.title)).toEqual(["Calm Down", "Original"]);
  });

  it("labels a sound and reads Post.trendingSound back", () => {
    expect(soundLabel({ title: "Calm Down", artist: "Rema" })).toBe("Calm Down – Rema");
    expect(soundLabel({ title: "Solo", artist: null })).toBe("Solo");
    expect(readAttachedSound({ audioId: "1", title: "T", artist: "A", link: "https://www.instagram.com/x", attachedAt: "2026-11-13T10:00:00.000Z" })).toEqual({ audioId: "1", title: "T", artist: "A", link: "https://www.instagram.com/x", attachedAt: "2026-11-13T10:00:00.000Z" });
    expect(readAttachedSound(null)).toBeNull();
    expect(readAttachedSound({ title: "no id" })).toBeNull();
  });
});
