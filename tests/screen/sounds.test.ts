import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    soundClip: { count: vi.fn(), create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  storage: { createSignedUploadUrl: vi.fn(), download: vi.fn(), remove: vi.fn(), upload: vi.fn(), createSignedUrls: vi.fn() },
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => h.storage } }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), RateLimitError: class extends Error {} }));

import { estimateCostUsd } from "@/lib/ai/pricing";
import { activeSoundUrls, finishSoundUpload, generateSoundEffect, setSoundActive, startSoundUpload } from "@/lib/screen/sounds";
import { MAX_ACTIVE_SOUNDS, nextSound, soundUploadProblem } from "@/lib/screen/shared";

const ctx = { actor: "staff:s1", viaApi: false };
const PATH = "123e4567-e89b-12d3-a456-426614174000.mp3";
const mp3 = (bytes = 2000) => {
  const b = new Uint8Array(bytes);
  b.set([0x49, 0x44, 0x33]);
  return b;
};
const blob = (b: Uint8Array) => ({ arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.prisma));
  h.prisma.soundClip.count.mockResolvedValue(2);
  h.prisma.soundClip.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "c1", ...data }));
  h.storage.createSignedUploadUrl.mockResolvedValue({ data: { path: PATH, token: "t" }, error: null });
  h.storage.remove.mockResolvedValue({});
});

describe("sound rotation", () => {
  const sounds = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("plays the active sounds in order and starts over after the last", () => {
    let last: string | null = null;
    const order: string[] = [];
    for (let i = 0; i < 7; i++) {
      last = nextSound(sounds, last)!.id;
      order.push(last);
    }
    expect(order).toEqual(["a", "b", "c", "a", "b", "c", "a"]);
  });
  it("a removed sound restarts the turn; no sounds, no sound", () => {
    expect(nextSound(sounds, "gone")?.id).toBe("a");
    expect(nextSound([], "a")).toBeNull();
  });
  it("the screen gets the active sounds oldest first with signed URLs", async () => {
    h.prisma.soundClip.findMany.mockResolvedValue([{ id: "a", path: "a.mp3" }, { id: "b", path: "b.mp3" }]);
    h.storage.createSignedUrls.mockResolvedValue({ data: [{ path: "b.mp3", signedUrl: "https://s/b" }, { path: "a.mp3", signedUrl: "https://s/a" }], error: null });
    expect(await activeSoundUrls()).toEqual([{ id: "a", url: "https://s/a" }, { id: "b", url: "https://s/b" }]);
    expect(h.prisma.soundClip.findMany.mock.calls[0][0]).toMatchObject({ where: { active: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  });
});

describe("sound uploads", () => {
  it("the rules: rights box, size, 10 active, MP3", () => {
    expect(soundUploadProblem({ bytes: 1000, rights: false, activeCount: 0 })).toMatch(/rights/);
    expect(soundUploadProblem({ bytes: 1024 * 1024 + 1, rights: true, activeCount: 0 })).toMatch(/1 MB/);
    expect(soundUploadProblem({ bytes: 1000, rights: true, activeCount: MAX_ACTIVE_SOUNDS })).toMatch(/already 10 active/);
    expect(soundUploadProblem({ bytes: 1000, rights: true, activeCount: 0, head: new TextEncoder().encode("RIFF") })).toMatch(/not an MP3/);
    expect(soundUploadProblem({ bytes: 1000, rights: true, activeCount: 9, head: new Uint8Array([0xff, 0xfb, 0x90, 0]) })).toBeNull();
  });

  it("refuses to start without the rights box, too big, or with 10 active", async () => {
    await expect(startSoundUpload({ bytes: 1000, rights: false })).rejects.toThrow(/rights/);
    await expect(startSoundUpload({ bytes: 2 * 1024 * 1024, rights: true })).rejects.toThrow(/1 MB/);
    h.prisma.soundClip.count.mockResolvedValue(10);
    await expect(startSoundUpload({ bytes: 1000, rights: true })).rejects.toThrow(/already 10 active/);
    expect(h.storage.createSignedUploadUrl).not.toHaveBeenCalled();
    h.prisma.soundClip.count.mockResolvedValue(3);
    expect(await startSoundUpload({ bytes: 1000, rights: true })).toEqual({ path: PATH, token: "t" });
  });

  it("deletes a file that is not an MP3", async () => {
    h.storage.download.mockResolvedValue({ data: blob(new TextEncoder().encode("<html>not audio</html>")), error: null });
    await expect(finishSoundUpload(ctx, PATH, { name: "Ding", rights: true })).rejects.toThrow(/not an MP3/);
    expect(h.storage.remove).toHaveBeenCalledWith([PATH]);
    expect(h.prisma.soundClip.create).not.toHaveBeenCalled();
  });

  it("deletes a file over 1 MB", async () => {
    h.storage.download.mockResolvedValue({ data: blob(mp3(1024 * 1024 + 10)), error: null });
    await expect(finishSoundUpload(ctx, PATH, { name: "Ding", rights: true })).rejects.toThrow(/1 MB/);
    expect(h.storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("refuses the 11th active sound under the lock, and a missing rights box", async () => {
    h.storage.download.mockResolvedValue({ data: blob(mp3()), error: null });
    h.prisma.soundClip.count.mockResolvedValue(10);
    await expect(finishSoundUpload(ctx, PATH, { name: "Ding", rights: true })).rejects.toThrow(/already 10 active/);
    expect(h.prisma.$executeRaw).toHaveBeenCalled();
    expect(h.prisma.soundClip.create).not.toHaveBeenCalled();
    await expect(finishSoundUpload(ctx, PATH, { name: "Ding", rights: false })).rejects.toThrow(/rights/);
  });

  it("saves a good MP3 and audits it", async () => {
    h.storage.download.mockResolvedValue({ data: blob(mp3(5000)), error: null });
    await finishSoundUpload(ctx, PATH, { name: " Ding ", rights: true });
    expect(h.prisma.soundClip.create.mock.calls[0][0].data).toEqual({ name: "Ding", path: PATH, source: "upload", bytes: 5000, createdBy: "staff:s1" });
    expect(h.audit).toHaveBeenCalledWith(h.prisma, ctx, "create_sound", "sound:c1", null, expect.objectContaining({ rights: true }));
  });

  it("refuses a path it did not hand out", async () => {
    await expect(finishSoundUpload(ctx, "../music/x.mp3", { name: "Ding", rights: true })).rejects.toThrow(/could not be used/);
    expect(h.storage.download).not.toHaveBeenCalled();
  });

  it("turning an 11th sound on is refused", async () => {
    h.prisma.soundClip.count.mockResolvedValue(10);
    await expect(setSoundActive(ctx, "c1", true)).rejects.toThrow(/already 10 active/);
    expect(h.prisma.soundClip.updateMany).not.toHaveBeenCalled();
    h.prisma.soundClip.updateMany.mockResolvedValue({ count: 1 });
    await setSoundActive(ctx, "c1", false);
    expect(h.prisma.soundClip.updateMany).toHaveBeenCalledWith({ where: { id: "c1" }, data: { active: false } });
  });
});

describe("ElevenLabs Sound Effects", () => {
  const KEY = "sk_test_never_print_me";
  afterEach(() => {
    Reflect.deleteProperty(process.env, "ELEVENLABS_API_KEY");
    vi.restoreAllMocks();
  });

  it("posts text, duration and prompt influence with the key in xi-api-key only, and never logs the key", async () => {
    process.env.ELEVENLABS_API_KEY = KEY;
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(mp3(3000), { headers: { "content-type": "audio/mpeg" } }));
    const r = await generateSoundEffect("Cash register ding with coins", 9, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/sound-generation");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("xi-api-key")).toBe(KEY);
    expect(headers.get("accept")).toBe("audio/mpeg");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Cash register ding with coins", duration_seconds: 5, prompt_influence: 0.5 });
    expect(String(init?.body)).not.toContain(KEY);
    expect(url).not.toContain(KEY);
    expect(r).toMatchObject({ seconds: 5, provider: "elevenlabs", model: "sound_effects" });
    expect(r.audio.length).toBe(3000);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
  });

  it("an error keeps only the status, never the answer or the key", async () => {
    process.env.ELEVENLABS_API_KEY = KEY;
    const fetchImpl = vi.fn(async () => new Response(`bad key ${KEY}`, { status: 401 }));
    const error = await generateSoundEffect("Coins", 3, fetchImpl as unknown as typeof fetch).catch((e: Error) => e);
    expect((error as Error).message).toBe("The sound service refused the request (401)");
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it("without the key nothing is asked", async () => {
    const fetchImpl = vi.fn();
    await expect(generateSoundEffect("Coins", 3, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/not set up/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("seconds are priced in the ledger (an estimate of about $0.012 a second)", () => {
    expect(estimateCostUsd("sound_effects", { inputTokens: 5, outputTokens: 0 })).toBeCloseTo(0.06);
  });
});
