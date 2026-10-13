import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    contentVisual: { findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    voiceClip: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), delete: vi.fn() },
  },
  featureStatus: vi.fn(),
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
  speak: vi.fn(),
  generate: vi.fn(),
  storage: { upload: vi.fn(), remove: vi.fn(), info: vi.fn() },
  mediaUsage: vi.fn(),
  assertPlatformRoom: vi.fn(),
  ledger: vi.fn(),
  logError: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/entitlements", () => ({ featureStatus: mocks.featureStatus }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/usage", () => {
  class UsageLimitError extends Error {
    constructor(
      public reason: string,
      public metric: string,
    ) {
      super("limit");
    }
  }
  return { consumeUsage: mocks.consumeUsage, refundUsage: mocks.refundUsage, UsageLimitError };
});
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: async (ctx: unknown, meta: unknown, call: () => Promise<unknown>, describe: (r: unknown) => unknown) => {
    const r = await call();
    mocks.ledger(ctx, meta, describe(r));
    return r;
  },
}));
vi.mock("@/lib/ai", () => ({ getCheapTextProvider: () => ({ provider: { name: "gemini", generate: mocks.generate }, model: "gemini-lite" }) }));
vi.mock("@/lib/ai/tts", () => ({ getTtsProvider: () => ({ name: "elevenlabs", model: "eleven_multilingual_v2", speak: mocks.speak }) }));
vi.mock("@/lib/content-board/settings-service", () => ({ getContentSettings: async () => ({ voiceId: "NZ8KtusXpnktPYja5Qko" }) }));
vi.mock("@/lib/media/service", () => {
  class MediaError extends Error {}
  return { mediaUsage: mocks.mediaUsage, assertPlatformRoom: mocks.assertPlatformRoom, MediaError };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => mocks.storage } }) }));

import { Prisma } from "@/lib/generated/prisma/client";
import { RateLimitError } from "@/lib/rate-limit";
import { UsageLimitError } from "@/lib/usage";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { ensureVoiceover, MAX_VOICE_CHARS, regenerateVoiceover, releaseClip, setVideoVoice, voiceHash, voicePath } from "@/lib/voice/service";
import { speechText, spokenLines } from "@/lib/voice/speech";

const owner = { userId: "u1", businessId: "b1" };
const VOICE = "NZ8KtusXpnktPYja5Qko";
const MODEL = "eleven_multilingual_v2";
const basePlan = () => buildVideoPlan({ script: "Hook: Fast phones.\nVO: All day battery.", hook: "Fast phones", businessName: "Kigali Phones", photos: [], pack: "clean" });
const text = () => speechText(spokenLines(basePlan())).text;
const HASH = () => voiceHash(VOICE, MODEL, text(), 0);
/** A fake voice: 60 ms a character. */
const voiceFor = (t: string, msPerChar = 60) => ({ audio: new Uint8Array(5000).fill(7), mimeType: "audio/mpeg", charStartsMs: [...t].map((_, i) => i * msPerChar), charEndsMs: [...t].map((_, i) => i * msPerChar + msPerChar), durationMs: t.length * msPerChar, characters: t.length, provider: "elevenlabs", model: MODEL });
const row = (plan: unknown = basePlan()) => ({ id: "v1", businessId: "b1", kind: "video", plan });
const duplicate = () => new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "7" });
const lineTimes = () => spokenLines(basePlan()).map((_, i) => ({ startMs: i * 1200, endMs: i * 1200 + 1000 }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.contentVisual.findFirst.mockResolvedValue(row());
  mocks.prisma.contentVisual.update.mockResolvedValue({});
  mocks.prisma.contentVisual.count.mockResolvedValue(0);
  mocks.prisma.voiceClip.create.mockResolvedValue({});
  mocks.prisma.voiceClip.findUnique.mockResolvedValue(null);
  mocks.prisma.voiceClip.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.voiceClip.deleteMany.mockResolvedValue({ count: 1 });
  mocks.featureStatus.mockResolvedValue("ok");
  mocks.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  mocks.refundUsage.mockResolvedValue(undefined);
  mocks.speak.mockImplementation(async ({ text }: { text: string }) => voiceFor(text));
  mocks.storage.upload.mockResolvedValue({ error: null });
  mocks.storage.remove.mockResolvedValue({});
  mocks.storage.info.mockResolvedValue({ data: { size: 5000 }, error: null });
  mocks.mediaUsage.mockResolvedValue({ count: 0, bytes: 0 });
  mocks.rateLimit.mockResolvedValue(undefined);
});

describe("ensureVoiceover", () => {
  it("claims, speaks, bills, keeps the audio before storing, stores it by company, and times the scenes", async () => {
    const { plan, voiceDataUrl } = (await ensureVoiceover(owner, "v1"))!;
    const spoken = text();
    expect(mocks.prisma.voiceClip.create.mock.calls[0][0].data).toMatchObject({ businessId: "b1", hash: HASH(), status: "speaking" });
    expect(mocks.consumeUsage).toHaveBeenCalledWith("u1", "voiceCharacters", spoken.length);
    expect(mocks.ledger).toHaveBeenCalledWith(expect.objectContaining({ businessId: "b1", feature: "voice" }), { provider: "elevenlabs", model: MODEL }, expect.objectContaining({ usage: { inputTokens: spoken.length, outputTokens: 0 } }));
    const states = mocks.prisma.voiceClip.updateMany.mock.calls.map(([a]) => a.data.status);
    expect(states).toEqual(["spoken", "ready"]); // paid audio kept first, then stored
    expect(mocks.prisma.voiceClip.updateMany.mock.calls[0][0].data.pendingAudio).toBeInstanceOf(Buffer);
    expect(mocks.storage.upload).toHaveBeenCalledWith(voicePath("b1", HASH()), expect.any(Uint8Array), { contentType: "audio/mpeg", upsert: true });
    expect(voicePath("b1", HASH())).toMatch(/^voice\/b1\//);
    expect(plan.voice).toMatchObject({ enabled: true, path: voicePath("b1", HASH()), hash: HASH(), note: null });
    expect(voiceDataUrl).toBeUndefined();
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("characters stay counted once the voice service was paid, even when storing fails: this render gets the audio, the next one stores it", async () => {
    mocks.storage.upload.mockResolvedValueOnce({ error: { message: "storage down" } });
    const first = (await ensureVoiceover(owner, "v1"))!;
    expect(mocks.refundUsage).not.toHaveBeenCalled();
    expect(first.voiceDataUrl).toMatch(/^data:audio\/mpeg;base64,/);
    expect(first.plan.voice?.path).toBeNull();

    // The retry finds the paid audio waiting ("spoken") and stores it: no second call to the voice service.
    mocks.speak.mockClear();
    mocks.prisma.voiceClip.create.mockRejectedValueOnce(duplicate());
    mocks.prisma.voiceClip.findUnique.mockResolvedValueOnce({ status: "spoken", path: null, pendingAudio: Buffer.from(new Uint8Array(5000)), durationMs: first.plan.voice!.durationMs, timings: first.plan.voice!.timings, updatedAt: new Date() });
    const second = (await ensureVoiceover(owner, "v1"))!;
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(second.plan.voice?.path).toBe(voicePath("b1", HASH()));
  });

  it("a voice service error gives the characters back and releases the claim", async () => {
    mocks.speak.mockRejectedValueOnce(new Error("voice service down"));
    const { plan } = (await ensureVoiceover(owner, "v1"))!;
    expect(mocks.refundUsage).toHaveBeenCalledWith("u1", "voiceCharacters", new Date("2026-10-01"), text().length);
    expect(mocks.prisma.voiceClip.deleteMany).toHaveBeenCalledWith({ where: { businessId: "b1", hash: HASH(), status: "speaking" } });
    expect(plan.voice?.note).toMatch(/could not be made/);
  });

  it("a voice that ran past 30 seconds is remembered as too long and never spoken again", async () => {
    mocks.speak.mockImplementationOnce(async ({ text }: { text: string }) => voiceFor(text, 2000));
    const { plan } = (await ensureVoiceover(owner, "v1"))!;
    expect(plan.voice?.note).toMatch(/longer than 30 seconds/);
    expect(mocks.prisma.voiceClip.updateMany.mock.calls.at(-1)![0].data).toEqual({ status: "too_long", pendingAudio: null });
    expect(mocks.refundUsage).not.toHaveBeenCalled(); // it was paid

    mocks.speak.mockClear();
    mocks.prisma.voiceClip.create.mockRejectedValueOnce(duplicate());
    mocks.prisma.voiceClip.findUnique.mockResolvedValueOnce({ status: "too_long", path: null, pendingAudio: null, durationMs: 0, timings: [], updatedAt: new Date() });
    expect((await ensureVoiceover(owner, "v1"))!.plan.voice?.note).toMatch(/longer than 30 seconds/);
    expect(mocks.speak).not.toHaveBeenCalled();
  });

  it("the same text is reused when its file is really there; a row whose file is gone is spoken again", async () => {
    mocks.prisma.voiceClip.create.mockRejectedValueOnce(duplicate());
    mocks.prisma.voiceClip.findUnique.mockResolvedValueOnce({ status: "ready", path: "voice/b1/abc.mp3", pendingAudio: null, durationMs: 5000, timings: lineTimes(), updatedAt: new Date() });
    const { plan } = (await ensureVoiceover(owner, "v1"))!;
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(plan.voice?.path).toBe("voice/b1/abc.mp3");

    mocks.storage.info.mockResolvedValue({ data: null, error: { message: "not found" } });
    mocks.prisma.voiceClip.create.mockRejectedValueOnce(duplicate());
    mocks.prisma.voiceClip.findUnique.mockResolvedValueOnce({ status: "ready", path: "voice/b1/abc.mp3", pendingAudio: null, durationMs: 5000, timings: lineTimes(), updatedAt: new Date() });
    await ensureVoiceover(owner, "v1");
    expect(mocks.speak).toHaveBeenCalledTimes(1);
  });

  it("a plan pointing at a file that is gone is not trusted", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row({ ...basePlan(), voice: { enabled: true, voiceId: VOICE, hash: HASH(), path: "voice/b1/gone.mp3" } }));
    mocks.storage.info.mockResolvedValueOnce({ data: null, error: { message: "not found" } });
    await ensureVoiceover(owner, "v1");
    expect(mocks.prisma.voiceClip.create).toHaveBeenCalled();
  });

  it("another render speaking the same text: this one waits and uses its result (one paid call)", async () => {
    vi.useFakeTimers();
    try {
      mocks.prisma.voiceClip.create.mockRejectedValue(duplicate());
      mocks.prisma.voiceClip.findUnique
        .mockResolvedValueOnce({ id: "c", status: "speaking", updatedAt: new Date(), path: null, pendingAudio: null, durationMs: 0, timings: [] })
        .mockResolvedValueOnce({ status: "ready", path: "voice/b1/x.mp3", pendingAudio: null, durationMs: 5000, timings: lineTimes(), updatedAt: new Date() });
      const done = ensureVoiceover(owner, "v1");
      await vi.advanceTimersByTimeAsync(1500);
      const { plan } = (await done)!;
      expect(mocks.speak).not.toHaveBeenCalled();
      expect(plan.voice?.path).toBe("voice/b1/x.mp3");
    } finally {
      vi.useRealTimers();
    }
  });

  it("captions too long are shortened once and checked again; still too long (or not shortened): no voice call at all", async () => {
    const long = basePlan();
    long.scenes = long.scenes.map((s) => ({ ...s, text: "A very long caption line that goes on and on about the product and its many features, again and again, until nobody could say it in a short advert" }));
    const lines = spokenLines(long);
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row(long));
    const short = lines.map((_, i) => `Short line ${i + 1}.`);
    mocks.generate.mockResolvedValueOnce({ text: JSON.stringify({ lines: short }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    await ensureVoiceover(owner, "v1");
    expect(mocks.speak).toHaveBeenCalledTimes(1);
    expect(mocks.speak.mock.calls[0][0].text.length).toBeLessThan(200);

    // Eight full scenes (90 characters each, the most a scene holds): even "shortened" to the same lines it is too long.
    mocks.speak.mockClear();
    const full = { ...long, scenes: Array.from({ length: 8 }, (_, i) => ({ ...long.scenes[i % long.scenes.length], text: `Line ${i} `.padEnd(89, "x") + "." })) };
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row(full));
    mocks.generate.mockResolvedValueOnce({ text: JSON.stringify({ lines: spokenLines(full) }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    expect((await ensureVoiceover(owner, "v1"))!.plan.voice?.note).toMatch(/longer than 30 seconds/);
    mocks.generate.mockRejectedValueOnce(new Error("AI down"));
    expect((await ensureVoiceover(owner, "v1"))!.plan.voice?.note).toMatch(/longer than 30 seconds/);
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(mocks.consumeUsage).toHaveBeenCalledTimes(1);
    expect(MAX_VOICE_CHARS).toBe(600);
  });

  it("characters used up, voiceover not in the plan, or switched off: nothing spoken", async () => {
    mocks.consumeUsage.mockRejectedValueOnce(new UsageLimitError("limit_reached", "voiceCharacters"));
    expect((await ensureVoiceover(owner, "v1"))!.plan.voice?.note).toMatch(/characters for this month are used/);
    mocks.featureStatus.mockResolvedValueOnce("not_in_plan");
    expect((await ensureVoiceover(owner, "v1"))!.plan.voice).toMatchObject({ path: null, note: null });
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row({ ...basePlan(), voice: { enabled: false, voiceId: VOICE } }));
    expect((await ensureVoiceover(owner, "v1"))!.plan.voice?.enabled).toBe(false);
    expect(mocks.speak).not.toHaveBeenCalled();
  });
});

describe("the owner's voice choices", () => {
  it("switching voice or turning it off resets the voiceover and sends the video to be made again", async () => {
    const next = (await setVideoVoice(owner, "v1", { enabled: true, voiceId: "EXAVITQu4vr4xnSDxMaL" }))!;
    expect(next.voice).toMatchObject({ enabled: true, voiceId: "EXAVITQu4vr4xnSDxMaL", path: null, hash: null });
    expect(mocks.prisma.contentVisual.update.mock.calls[0][0].data).toMatchObject({ status: "pending", robotAttempts: 0 });
  });

  it("Regenerate voiceover asks for a new take; the old clip goes when no other video uses it; 3 a day, 30 s apart", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", plan: { ...basePlan(), voice: { enabled: true, voiceId: VOICE, take: 1, hash: "h1", path: "voice/b1/h1.mp3" } } });
    mocks.prisma.voiceClip.findUnique.mockResolvedValue({ id: "clip1", path: "voice/b1/h1.mp3" });
    await regenerateVoiceover(owner, "v1");
    expect(mocks.prisma.contentVisual.update.mock.calls[0][0].data.plan.voice).toMatchObject({ take: 2, hash: null });
    expect(mocks.rateLimit).toHaveBeenCalledWith("voice-regen-cooldown:v1", { limit: 1, windowSeconds: 30 });
    expect(mocks.rateLimit).toHaveBeenCalledWith("voice-regen:v1", { limit: 3, windowSeconds: 86400 });
    expect(mocks.prisma.voiceClip.delete).toHaveBeenCalledWith({ where: { id: "clip1" } });
    expect(mocks.storage.remove).toHaveBeenCalledWith(["voice/b1/h1.mp3"]);

    mocks.rateLimit.mockRejectedValueOnce(new RateLimitError(30));
    await expect(regenerateVoiceover(owner, "v1")).rejects.toThrow(/3 times a day per video, 30 seconds apart/);
  });

  it("a clip another video still uses is kept", async () => {
    mocks.prisma.contentVisual.count.mockResolvedValue(1);
    expect(await releaseClip(owner, "h1", "v1")).toBe(false);
    expect(mocks.prisma.contentVisual.count.mock.calls[0][0].where).toMatchObject({ businessId: "b1", id: { not: "v1" }, plan: { path: ["voice", "hash"], equals: "h1" } });
    expect(mocks.prisma.voiceClip.delete).not.toHaveBeenCalled();
  });
});
