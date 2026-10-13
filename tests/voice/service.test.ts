import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    contentVisual: { findFirst: vi.fn(), update: vi.fn() },
    voiceClip: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  },
  featureStatus: vi.fn(),
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
  speak: vi.fn(),
  generate: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  mediaUsage: vi.fn(),
  assertPlatformRoom: vi.fn(),
  ledger: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/entitlements", () => ({ featureStatus: mocks.featureStatus }));
vi.mock("@/lib/usage", () => {
  class UsageLimitError extends Error {
    constructor(public reason: string, public metric: string) {
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
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) } }) }));

import { UsageLimitError } from "@/lib/usage";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { ensureVoiceover, forgetVoiceover, setVideoVoice, voiceHash, voicePath } from "@/lib/voice/service";
import { speechText, spokenLines } from "@/lib/voice/speech";

const owner = { userId: "u1", businessId: "b1" };
const basePlan = () => buildVideoPlan({ script: "Hook: Fast phones.\nVO: All day battery.", hook: "Fast phones", businessName: "Kigali Phones", photos: [], pack: "clean" });
const text = () => speechText(spokenLines(basePlan())).text;
/** A fake voice: 60 ms a character. */
const voiceFor = (t: string) => ({ audio: new Uint8Array(5000), mimeType: "audio/mpeg", charStartsMs: [...t].map((_, i) => i * 60), charEndsMs: [...t].map((_, i) => i * 60 + 60), durationMs: t.length * 60, characters: t.length, provider: "elevenlabs", model: "eleven_multilingual_v2" });
const row = (plan = basePlan()) => ({ id: "v1", businessId: "b1", kind: "video", plan });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.contentVisual.findFirst.mockResolvedValue(row());
  mocks.prisma.contentVisual.update.mockResolvedValue({});
  mocks.prisma.voiceClip.findUnique.mockResolvedValue(null);
  mocks.prisma.voiceClip.upsert.mockResolvedValue({});
  mocks.featureStatus.mockResolvedValue("ok");
  mocks.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  mocks.refundUsage.mockResolvedValue(undefined);
  mocks.speak.mockImplementation(async ({ text }: { text: string }) => voiceFor(text));
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({});
  mocks.mediaUsage.mockResolvedValue({ count: 0, bytes: 0 });
});

describe("ensureVoiceover", () => {
  it("speaks the captions in the company's voice, bills the characters, stores the MP3 and times the scenes to it", async () => {
    const plan = (await ensureVoiceover(owner, "v1"))!;
    const spoken = text();
    expect(mocks.consumeUsage).toHaveBeenCalledWith("u1", "voiceCharacters", spoken.length);
    expect(mocks.speak).toHaveBeenCalledWith({ text: spoken, voiceId: "NZ8KtusXpnktPYja5Qko" });
    // Through the ledger, characters recorded as input tokens.
    expect(mocks.ledger).toHaveBeenCalledWith(expect.objectContaining({ businessId: "b1", feature: "voice" }), { provider: "elevenlabs", model: "eleven_multilingual_v2" }, expect.objectContaining({ usage: { inputTokens: spoken.length, outputTokens: 0 } }));
    const hash = voiceHash("NZ8KtusXpnktPYja5Qko", "eleven_multilingual_v2", spoken);
    expect(mocks.upload).toHaveBeenCalledWith(voicePath("u1", hash), expect.any(Uint8Array), { contentType: "audio/mpeg", upsert: true });
    expect(plan.voice).toMatchObject({ enabled: true, path: voicePath("u1", hash), hash, durationMs: spoken.length * 60, note: null });
    expect(plan.voice!.timings).toHaveLength(plan.scenes.length);
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("the same words in the same voice are reused, free", async () => {
    const spoken = text();
    mocks.prisma.voiceClip.findUnique.mockResolvedValue({ path: "u1/voice/abc.mp3", durationMs: 5000, timings: spokenLines(basePlan()).map((_, i) => ({ startMs: i * 1200, endMs: i * 1200 + 1000 })) });
    const plan = (await ensureVoiceover(owner, "v1"))!;
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(plan.voice).toMatchObject({ path: "u1/voice/abc.mp3", hash: voiceHash("NZ8KtusXpnktPYja5Qko", "eleven_multilingual_v2", spoken) });
    // Already voiced for this text: nothing at all happens.
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row(plan));
    mocks.prisma.voiceClip.findUnique.mockClear();
    await ensureVoiceover(owner, "v1");
    expect(mocks.prisma.voiceClip.findUnique).not.toHaveBeenCalled();
  });

  it("characters used up: no voiceover this time, a note, and nothing spoken", async () => {
    mocks.consumeUsage.mockRejectedValueOnce(new UsageLimitError("limit_reached", "voiceCharacters"));
    const plan = (await ensureVoiceover(owner, "v1"))!;
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(plan.voice).toMatchObject({ enabled: true, path: null, note: expect.stringMatching(/characters for this month are used/) });
  });

  it("voiceover not in the plan, or switched off for this video: no voice, no charge", async () => {
    mocks.featureStatus.mockResolvedValueOnce("not_in_plan");
    expect((await ensureVoiceover(owner, "v1"))!.voice).toMatchObject({ path: null, note: null });
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row({ ...basePlan(), voice: { enabled: false, voiceId: "NZ8KtusXpnktPYja5Qko" } }));
    expect((await ensureVoiceover(owner, "v1"))!.voice?.enabled).toBe(false);
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
  });

  it("a voice error gives the characters back and the video goes without a voiceover", async () => {
    mocks.speak.mockRejectedValueOnce(new Error("voice service down"));
    const plan = (await ensureVoiceover(owner, "v1"))!;
    expect(mocks.refundUsage).toHaveBeenCalledWith("u1", "voiceCharacters", new Date("2026-10-01"), text().length);
    expect(plan.voice?.note).toMatch(/could not be made/);
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("captions too long for 30 seconds are shortened by the AI before speaking", async () => {
    const long = basePlan();
    long.scenes = long.scenes.map((s) => ({ ...s, text: "A very long caption line that goes on and on about the product and its many features, again and again, until nobody could say it in a short advert at all" }));
    mocks.prisma.contentVisual.findFirst.mockResolvedValue(row(long));
    mocks.generate.mockResolvedValue({ text: JSON.stringify({ lines: long.scenes.map((_, i) => `Short line ${i + 1}.`) }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    const plan = (await ensureVoiceover(owner, "v1"))!;
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(plan.scenes.map((s) => s.text)).toEqual(long.scenes.map((_, i) => `Short line ${i + 1}.`));
    expect(mocks.speak.mock.calls[0][0].text).toBe(long.scenes.map((_, i) => `Short line ${i + 1}.`).join(" "));
  });

  it("a full media quota stops the voiceover with the quota message; the characters are given back", async () => {
    mocks.mediaUsage.mockResolvedValueOnce({ count: 500, bytes: 0 });
    const plan = (await ensureVoiceover(owner, "v1"))!;
    expect(plan.voice?.note).toMatch(/gallery is full/);
    expect(mocks.refundUsage).toHaveBeenCalled();
  });
});

describe("the owner's voice choices", () => {
  it("switching voice or turning it off resets the voiceover and sends the video to be made again", async () => {
    const next = (await setVideoVoice(owner, "v1", { enabled: true, voiceId: "EXAVITQu4vr4xnSDxMaL" }))!;
    expect(next.voice).toEqual({ enabled: true, voiceId: "EXAVITQu4vr4xnSDxMaL", path: null, hash: null, note: null });
    expect(mocks.prisma.contentVisual.update.mock.calls[0][0].data).toMatchObject({ status: "pending", robotAttempts: 0 });
    // An unknown voice id keeps the current one.
    expect((await setVideoVoice(owner, "v1", { enabled: false, voiceId: "not-a-voice" }))!.voice).toMatchObject({ enabled: false, voiceId: "NZ8KtusXpnktPYja5Qko" });
  });

  it("Regenerate voiceover forgets the cached clip so it is spoken again", async () => {
    mocks.prisma.contentVisual.findFirst.mockResolvedValue({ plan: { ...basePlan(), voice: { enabled: true, voiceId: "x", hash: "h1", path: "u1/voice/h1.mp3" } } });
    mocks.prisma.voiceClip.findUnique.mockResolvedValue({ id: "clip1", path: "u1/voice/h1.mp3" });
    await forgetVoiceover(owner, "v1");
    expect(mocks.prisma.voiceClip.delete).toHaveBeenCalledWith({ where: { id: "clip1" } });
    expect(mocks.remove).toHaveBeenCalledWith(["u1/voice/h1.mp3"]);
  });
});
