import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { musicTrack: { aggregate: vi.fn(), create: vi.fn(), findMany: vi.fn() }, $transaction: vi.fn(), $executeRaw: vi.fn() },
  upload: vi.fn(),
  audit: vi.fn(),
  ledger: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: mocks.audit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ upload: mocks.upload }) } }) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: async (ctx: unknown, meta: unknown, call: () => Promise<unknown>, describe: (r: unknown) => unknown) => {
    const r = await call();
    mocks.ledger(ctx, meta, describe(r));
    return r;
  },
}));

import { readFileSync } from "node:fs";
import { composeMusic } from "@/lib/ai/tts";
import { generateTrack } from "@/lib/music/service";
import { ELEVENLABS_MUSIC_LICENCE, isOwnedLicence, trackInputSchema } from "@/lib/music/tracks";
import { isMp3, moodUpdateSql, SEED_MOODS, seedPath, trackFromFilename } from "@/scripts/music/seed-lib.mjs";
import { MOODS } from "@/lib/music/tracks";

const ctx = { actor: "admin", viaApi: false };
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ELEVENLABS_API_KEY = "test-key";
  mocks.prisma.musicTrack.aggregate.mockResolvedValue({ _sum: { bytes: 0 } });
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.prisma) => unknown) => fn(mocks.prisma));
  mocks.prisma.musicTrack.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "t1", ...data }));
  mocks.upload.mockResolvedValue({ error: null });
  mocks.rateLimit.mockResolvedValue(undefined);
});

describe("owned music needs no credit line", () => {
  it("original ElevenLabs Music: no credit and the tool as source; other licences still need both", () => {
    expect(isOwnedLicence(ELEVENLABS_MUSIC_LICENCE)).toBe(true);
    expect(trackInputSchema.safeParse({ title: "A", moods: ["calm"], licence: ELEVENLABS_MUSIC_LICENCE, sourceUrl: "ElevenLabs Music", attribution: "" }).success).toBe(true);
    expect(trackInputSchema.safeParse({ title: "A", moods: ["calm"], licence: "CC BY 4.0", sourceUrl: "ElevenLabs Music", attribution: "x by y" }).success).toBe(false);
    expect(trackInputSchema.safeParse({ title: "A", moods: ["calm"], licence: "CC BY 4.0", sourceUrl: "https://x.org/t", attribution: "" }).success).toBe(false);
  });
});

describe("seeding the library from files", () => {
  it("titles and moods come from NN-mood-name.mp3; other files are skipped", () => {
    expect(trackFromFilename("02-amapiano-groove.mp3")).toEqual({ title: "Amapiano Groove", moods: ["afro", "upbeat"] });
    expect(trackFromFilename("10-chill-lofi.mp3")).toEqual({ title: "Chill Lofi", moods: ["calm"] });
    expect(trackFromFilename("08-mystery-tune.mp3")).toEqual({ title: "Mystery Tune", moods: ["upbeat"] });
    expect(trackFromFilename("notes.txt")).toBeNull();
    expect(trackFromFilename("cover.mp3")).toBeNull();
    expect(isMp3(mp3)).toBe(true);
    expect(isMp3(new Uint8Array([0x89, 0x50]))).toBe(false);
    expect(seedPath("02-Amapiano Groove.mp3")).toBe("seed-02-amapiano-groove.mp3");
  });

  it("the 20 original tracks carry the moods chosen for them: quiet subjects are never upbeat", () => {
    expect(Object.keys(SEED_MOODS)).toHaveLength(20);
    for (const moods of Object.values(SEED_MOODS)) expect(moods.every((m) => (MOODS as readonly string[]).includes(m))).toBe(true);
    expect(trackFromFilename("20-reflective-story.mp3")!.moods).toEqual(["inspiring", "warm", "calm"]);
    expect(trackFromFilename("17-education-focus.mp3")!.moods).toEqual(["calm", "inspiring"]);
    expect(trackFromFilename("15-beauty-spa.mp3")!.moods).toEqual(["calm"]);
    expect(trackFromFilename("08-elegant-luxury.mp3")!.moods).toEqual(["calm", "warm"]);
    expect(trackFromFilename("12-real-estate-calm.mp3")!.moods).toEqual(["calm"]);
    expect(trackFromFilename("06-tech-modern.mp3")!.moods).toEqual(["corporate"]);
    // Files outside the list still read their words: a quiet name is not upbeat.
    expect(trackFromFilename("33-quiet-study-spa.mp3")!.moods).toEqual(["calm"]);
  });

  it("already-seeded rows are corrected by a migration made from the same map (seeded rows only)", () => {
    const sql = readFileSync("prisma/migrations/20261017120000_music_seed_moods/migration.sql", "utf8");
    expect(sql).toContain(moodUpdateSql());
    expect(moodUpdateSql().split("\n")).toHaveLength(20);
    for (const line of moodUpdateSql().split("\n")) expect(line).toMatch(/WHERE "createdBy" = 'seed-music' AND "path" LIKE 'seed-__-[a-z-]+\.mp3';$/);
  });

  it("the runner lives in git-ignored scripts/local and uses the owned-music licence with no credit", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^scripts\/local\/$/m);
    expect(readFileSync("scripts/music/seed-lib.mjs", "utf8")).toContain("Original — generated with ElevenLabs Music for BuPulse (commercial use, paid plan)");
  });
});

describe("Generate a track (ElevenLabs Music)", () => {
  it("composes an instrumental, pays through the ledger, stores it and audits the prompt", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.elevenlabs.io/v1/music");
      expect(Object.keys(JSON.parse(String(init?.body))).sort()).toEqual(["music_length_ms", "prompt"]);
      expect(JSON.parse(String(init?.body))).toMatchObject({ music_length_ms: 30_000 });
      expect(new Headers(init?.headers).get("xi-api-key")).toBe("test-key");
      return new Response(mp3);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const row = await generateTrack(ctx, { title: "Kigali Morning", prompt: "Light afrobeats groove with guitar", mood: "afro", seconds: 30 });
    expect(mocks.ledger).toHaveBeenCalledWith({ feature: "music" }, { provider: "elevenlabs", model: "music_v1" }, expect.objectContaining({ usage: { inputTokens: 30, outputTokens: 0 } }));
    expect(mocks.upload).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}\.mp3$/), mp3, { contentType: "audio/mpeg", upsert: false });
    expect(row).toMatchObject({ title: "Kigali Morning", moods: ["afro"], licence: ELEVENLABS_MUSIC_LICENCE, attribution: "", durationMs: 30_000, createdBy: "admin" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), ctx, "generate_music_track", "music:t1", null, expect.objectContaining({ prompt: "Light afrobeats groove with guitar", seconds: 30 }));
    vi.unstubAllGlobals();
  });

  it("refuses more than 60 seconds, unknown moods, a full library and the 21st track of the day", async () => {
    await expect(generateTrack(ctx, { title: "A", prompt: "A long enough prompt", mood: "calm", seconds: 90 })).rejects.toThrow(/60 seconds/);
    await expect(generateTrack(ctx, { title: "A", prompt: "A long enough prompt", mood: "sad" as never, seconds: 30 })).rejects.toThrow();
    mocks.prisma.musicTrack.aggregate.mockResolvedValueOnce({ _sum: { bytes: 79 * 1024 * 1024 } });
    await expect(generateTrack(ctx, { title: "A", prompt: "A long enough prompt", mood: "calm", seconds: 30 })).rejects.toThrow(/library is full/);
    const { RateLimitError } = await import("@/lib/rate-limit");
    mocks.rateLimit.mockRejectedValueOnce(new RateLimitError(60));
    await expect(generateTrack(ctx, { title: "A", prompt: "A long enough prompt", mood: "calm", seconds: 30 })).rejects.toThrow(/20 tracks/);
  });

  it("the music service's errors keep only the status", async () => {
    const error = await composeMusic({ prompt: "x", seconds: 10 }, (async () => new Response("echo test-key", { status: 402 })) as unknown as typeof fetch).catch((e) => e);
    expect(error.message).toBe("The music service refused the request (402)");
  });
});
