import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { musicTrack: { findMany: vi.fn(), aggregate: vi.fn(), create: vi.fn() }, $transaction: vi.fn() },
  storage: { createSignedUploadUrl: vi.fn(), info: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() },
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: mocks.audit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => mocks.storage } }) }));

import { ElevenLabsProvider, voicePreviewUrl } from "@/lib/ai/tts";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { finishTrackUpload, musicUrl, startTrackUpload, trackForVideo } from "@/lib/music/service";
import { moodFor, pickTrack, sniffAudio, trackInputSchema } from "@/lib/music/tracks";
import { ADDONS, quoteOffer, type OfferBase } from "@/lib/offers/shared";
import { SEED_PLANS, VOICE_PLAN_CHARACTERS } from "@/lib/plans";
import { FEATURES } from "@/lib/features";
import { audioUrlsFor } from "@/lib/visuals/robot";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { audioDataUrls } from "@/scripts/video-robot/robot.mjs";

const ctx = { actor: "admin", viaApi: false };

describe("ElevenLabs", () => {
  it("speaks with timestamps and returns the MP3 and every character's timing", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/NZ8KtusXpnktPYja5Qko/with-timestamps?output_format=mp3_44100_128");
      expect(new Headers(init?.headers).get("xi-api-key")).toBe("test-key");
      expect(JSON.parse(String(init?.body))).toMatchObject({ text: "Hi.", model_id: "eleven_multilingual_v2" });
      return new Response(JSON.stringify({ audio_base64: Buffer.from("ID3audio").toString("base64"), alignment: { characters: ["H", "i", "."], character_start_times_seconds: [0, 0.1, 0.2], character_end_times_seconds: [0.1, 0.2, 0.35] } }));
    });
    const r = await new ElevenLabsProvider("test-key", "eleven_multilingual_v2", fetchImpl as unknown as typeof fetch).speak({ text: "Hi.", voiceId: "NZ8KtusXpnktPYja5Qko" });
    expect(Buffer.from(r.audio).toString()).toBe("ID3audio");
    expect(r).toMatchObject({ charStartsMs: [0, 100, 200], charEndsMs: [100, 200, 350], durationMs: 350, characters: 3 });
  });

  it("errors carry only the status, never the answer or the key; bad voice ids are refused before any call", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret echo test-key", { status: 401 }));
    const p = new ElevenLabsProvider("test-key", "eleven_multilingual_v2", fetchImpl as unknown as typeof fetch);
    const error = await p.speak({ text: "Hi", voiceId: "NZ8KtusXpnktPYja5Qko" }).catch((e) => e);
    expect(error.message).toBe("The voice service refused the request (401)");
    expect(error.message).not.toMatch(/test-key|secret/);
    await expect(p.speak({ text: "Hi", voiceId: "../../admin" })).rejects.toThrow(/Unknown voice/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("previews a voice from its public sample, without the key set nothing is asked", async () => {
    Reflect.deleteProperty(process.env, "ELEVENLABS_API_KEY");
    expect(await voicePreviewUrl("NZ8KtusXpnktPYja5Qko")).toBeNull();
    process.env.ELEVENLABS_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ preview_url: "https://storage.googleapis.com/x.mp3" })));
    expect(await voicePreviewUrl("NZ8KtusXpnktPYja5Qko", fetchImpl as unknown as typeof fetch)).toBe("https://storage.googleapis.com/x.mp3");
    Reflect.deleteProperty(process.env, "ELEVENLABS_API_KEY");
  });

  it("characters are priced in the ledger (about $0.30 per 1,000)", () => {
    expect(estimateCostUsd("eleven_multilingual_v2", { inputTokens: 1000, outputTokens: 0 })).toBeCloseTo(0.3);
  });
});

describe("voiceover in the plans", () => {
  it("is built: Business and Pro 5,000 characters, the trial 600, Starter and Standard none (an add-on)", () => {
    expect(FEATURES.find((f) => f.key === "voice")).toMatchObject({ status: "built", metric: "voiceCharacters", requires: ["video"], services: ["elevenlabs"] });
    expect(SEED_PLANS.PRO.limits.voiceCharacters).toBe(5000);
    expect(SEED_PLANS.TRIAL.limits.voiceCharacters).toBe(600);
    expect(SEED_PLANS.TRIAL.features).toContain("voice");
    expect(SEED_PLANS.STANDARD.features).not.toContain("voice");
    expect(ADDONS.find((a) => a.key === "voice")).toMatchObject({ kind: "feature", label: "Voiceover" });
    const sql = readFileSync("prisma/migrations/20261017100000_voice_and_music/migration.sql", "utf8");
    expect(sql).toMatch(/\('addon_rw_voice', 'voice', 'RW', 'RWF', 5000, 'migration', CURRENT_TIMESTAMP\)/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY[\s\S]*REVOKE ALL ON TABLE "VoiceClip", "MusicTrack"/);
    const base: OfferBase = { key: "STARTER", name: "Starter", monthlyMinor: 15000, yearlyMinor: 150000, features: ["content", "designs", "calendar", "gallery"], limits: { text: 60, image: 30, chat: 0, videoSeconds: 0, voiceCharacters: 0, seats: 1 } };
    const q = quoteOffer({ base, features: ["voice"], limits: { text: 60, image: 30, chat: 0, seats: 1 }, interval: "MONTH", currency: "RWF", regionKey: "RW", prices: [] });
    expect(q.added).toEqual(["video", "voice"]);
    expect(q.limits).toMatchObject({ voiceCharacters: VOICE_PLAN_CHARACTERS, videoSeconds: 240 });
  });
});

describe("music library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.prisma) => unknown) => fn(mocks.prisma));
    mocks.storage.remove.mockResolvedValue({});
  });

  it("knows MP3 and M4A by their first bytes", () => {
    expect(sniffAudio(new Uint8Array([0x49, 0x44, 0x33, 4]))).toBe("audio/mpeg");
    expect(sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0]))).toBe("audio/mpeg");
    expect(sniffAudio(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))).toBe("audio/mp4");
    expect(sniffAudio(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it("a track needs a licence, an https source and a credit line", () => {
    const ok = { title: "Morning", moods: ["calm"], licence: "Pixabay Content License", sourceUrl: "https://pixabay.com/music/x", attribution: "Music: Morning by A (Pixabay)" };
    expect(trackInputSchema.safeParse(ok).success).toBe(true);
    expect(trackInputSchema.safeParse({ ...ok, attribution: "" }).success).toBe(false);
    expect(trackInputSchema.safeParse({ ...ok, sourceUrl: "http://x.com" }).success).toBe(false);
    expect(trackInputSchema.safeParse({ ...ok, moods: [] }).success).toBe(false);
  });

  it("the art director's mood picks a fitting track, varied by video; an empty library means no music", () => {
    const tracks = [{ id: "a", moods: ["calm"] }, { id: "b", moods: ["upbeat"] }, { id: "c", moods: ["upbeat", "energetic"] }];
    expect(["b", "c"]).toContain(pickTrack(tracks, "upbeat", "video-1")!.id);
    expect(new Set(["v1", "v2", "v3", "v4", "v5", "v6"].map((s) => pickTrack(tracks, "upbeat", s)!.id)).size).toBe(2);
    expect(pickTrack(tracks, "afro", "x")).not.toBeNull(); // no track with the mood: any track
    expect(pickTrack([], "calm", "x")).toBeNull();
    expect(moodFor({ angle: "how-it-works" })).toBe("corporate");
    expect(moodFor({ tone: "bold" })).toBe("energetic");
  });

  it("trackForVideo is null while the library is empty (graceful no music)", async () => {
    mocks.prisma.musicTrack.findMany.mockResolvedValue([]);
    expect(await trackForVideo("calm", "c1")).toBeNull();
  });

  it("uploads are checked: type, size, library room; a file that is not audio is deleted", async () => {
    await expect(startTrackUpload({ mimeType: "video/mp4", bytes: 100 })).rejects.toThrow(/MP3 or M4A/);
    await expect(startTrackUpload({ mimeType: "audio/mpeg", bytes: 7 * 1024 * 1024 })).rejects.toThrow(/6 MB/);
    mocks.prisma.musicTrack.aggregate.mockResolvedValue({ _sum: { bytes: 79 * 1024 * 1024 } });
    await expect(startTrackUpload({ mimeType: "audio/mpeg", bytes: 2 * 1024 * 1024 })).rejects.toThrow(/library is full/);
    mocks.prisma.musicTrack.aggregate.mockResolvedValue({ _sum: { bytes: 0 } });
    mocks.storage.createSignedUploadUrl.mockResolvedValue({ data: { path: "p.mp3", token: "t" }, error: null });
    expect(await startTrackUpload({ mimeType: "audio/mpeg", bytes: 1000 })).toEqual({ path: "p.mp3", token: "t" });

    const path = "0b5d5c1e-1111-4222-8333-444455556666.mp3";
    const input = { title: "Morning", moods: ["calm" as const], licence: "Pixabay Content License", sourceUrl: "https://pixabay.com/music/x", attribution: "Music: Morning (Pixabay)" };
    mocks.storage.info.mockResolvedValue({ data: { size: 1000 }, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))));
    await expect(finishTrackUpload(ctx, path, input)).rejects.toThrow(/not an MP3/);
    expect(mocks.storage.remove).toHaveBeenCalledWith([path]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0x49, 0x44, 0x33, 4]))));
    mocks.prisma.musicTrack.create.mockResolvedValue({ id: "t1", title: "Morning", licence: input.licence, sourceUrl: input.sourceUrl, bytes: 1000 });
    await finishTrackUpload(ctx, path, input);
    expect(mocks.prisma.musicTrack.create.mock.calls[0][0].data).toMatchObject({ title: "Morning", moods: ["calm"], attribution: input.attribution, mimeType: "audio/mpeg", createdBy: "admin" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), ctx, "create_music_track", "music:t1", null, expect.anything());
    vi.unstubAllGlobals();
    expect(musicUrl(path)).toBe(`https://proj.supabase.co/storage/v1/object/public/music/${path}`);
  });
});

describe("the video robot gets the sounds", () => {
  it("signs the owner's own voiceover and gives the public track URL", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    mocks.storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://proj.supabase.co/sign/voice" } });
    const plan = { ...buildVideoPlan({ script: "Hi", hook: "Hi", businessName: "B", photos: [], pack: "clean" }), voice: { enabled: true, voiceId: "x", path: "u1/voice/h.mp3" }, music: { trackId: "t", title: "T", path: "t.mp3", attribution: "" } };
    expect(await audioUrlsFor("u1", plan)).toEqual({ voice: "https://proj.supabase.co/sign/voice", music: "https://proj.supabase.co/storage/v1/object/public/music/t.mp3" });
    expect(await audioUrlsFor("someone-else", plan)).toEqual({ music: "https://proj.supabase.co/storage/v1/object/public/music/t.mp3" });
    expect(await audioUrlsFor("u1", { ...plan, voice: { ...plan.voice, enabled: false } })).not.toHaveProperty("voice");
  });

  it("the robot downloads them only from the storage origin, as data URLs", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([0x49, 0x44, 0x33]), { headers: { "content-type": "audio/mpeg" } }));
    const out = await audioDataUrls({ voice: "https://proj.supabase.co/sign/voice", music: "https://evil.example.com/x.mp3" }, "https://proj.supabase.co/upload/sign", fetchImpl);
    expect(Object.keys(out)).toEqual(["voice"]);
    expect((out as { voice?: string }).voice).toMatch(/^data:audio\/mpeg;base64,/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
