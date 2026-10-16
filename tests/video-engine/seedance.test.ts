import { describe, expect, it, vi } from "vitest";
import { SEEDANCE_MODELS, SeedanceError, cancelSeedanceTask, createSeedanceTask, estimateSeedanceUsd, getSeedanceTask, seedanceBody, type SeedanceRequest } from "@/lib/video-engine/seedance";
import { promptBriefText, writeSeedancePrompt } from "@/lib/video-engine/seedance-prompt";

const req: SeedanceRequest = {
  tier: "fast",
  prompt: "A hand lifts the phone from Image 1, slow dolly in, cafe sounds.",
  references: [
    { kind: "image", url: "data:image/jpeg;base64,AAAA", role: "first_frame" },
    { kind: "image", url: "data:image/jpeg;base64,BBBB" },
    { kind: "video", url: "data:video/mp4;base64,CCCC" },
    { kind: "audio", url: "data:audio/mpeg;base64,DDDD" },
  ],
  ratio: "9:16",
  seconds: 5,
  resolution: "720p",
  audio: true,
  fixedLens: false,
  seed: 42,
  flex: true,
};

describe("seedance request", () => {
  it("builds the BytePlus body as the docs describe", () => {
    const b = seedanceBody(req) as Record<string, unknown>;
    expect(b.model).toBe(SEEDANCE_MODELS.fast.id);
    const content = b.content as { type: string; role?: string }[];
    expect(content[0]).toEqual({ type: "text", text: req.prompt });
    expect(content[1]).toMatchObject({ type: "image_url", role: "first_frame" });
    expect(content[2]).toMatchObject({ type: "image_url", role: "reference_image" });
    expect(content[3]).toMatchObject({ type: "video_url", role: "reference_video" });
    expect(content[4]).toMatchObject({ type: "audio_url", role: "reference_audio" });
    expect(b).toMatchObject({ generate_audio: true, ratio: "9:16", duration: 5, resolution: "720p", camera_fixed: false, watermark: false, seed: 42, service_tier: "flex" });
    expect(b.draft).toBeUndefined();
  });

  it("clamps the duration, forces 480p for drafts and leaves the seed out when absent", () => {
    const b = seedanceBody({ ...req, seconds: 40, draft: true, seed: null, flex: false }) as Record<string, unknown>;
    expect(b.duration).toBe(15);
    expect(b.resolution).toBe("480p");
    expect(b.draft).toBe(true);
    expect("seed" in b).toBe(false);
    expect("service_tier" in b).toBe(false);
  });

  it("estimates by tier, resolution and seconds", () => {
    expect(estimateSeedanceUsd({ tier: "pro", resolution: "720p", seconds: 5 })).toBeCloseTo(0.75);
    expect(estimateSeedanceUsd({ tier: "mini", resolution: "480p", seconds: 10 })).toBeCloseTo(0.35);
  });
});

describe("seedance calls", () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("creates a task with the bearer key and returns its id", async () => {
    const fetchImpl = vi.fn(async () => ok({ id: "cgt-1" }));
    expect(await createSeedanceTask(req, { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("cgt-1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/contents/generations/tasks");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("reads a finished task: video url, tokens priced, seed", async () => {
    const fetchImpl = vi.fn(async () => ok({ id: "cgt-1", status: "succeeded", content: { video_url: "https://x.volces.com/v.mp4" }, usage: { completion_tokens: 100_000 }, seed: 7, duration: 5, resolution: "720p", ratio: "9:16" }));
    const t = await getSeedanceTask("cgt-1", { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(t).toMatchObject({ status: "succeeded", videoUrl: "https://x.volces.com/v.mp4", tokens: 100_000, seed: 7, seconds: 5, error: null });
    expect(t.costUsd).toBeCloseTo(0.7);
  });

  it("explains failures in plain words", async () => {
    const denied = vi.fn(async () => ok({ error: { code: "SensitiveContent" } }, 400));
    await expect(createSeedanceTask(req, { apiKey: "k", fetchImpl: denied as unknown as typeof fetch })).rejects.toThrow(/declined/);
    const broke = vi.fn(async () => ok({ error: { code: "InsufficientBalance" } }, 403));
    await expect(createSeedanceTask(req, { apiKey: "k", fetchImpl: broke as unknown as typeof fetch })).rejects.toThrow(/key is not valid|balance/);
    const failed = vi.fn(async () => ok({ id: "cgt-2", status: "failed", error: { code: "OutputModerationFailed" } }));
    const t = await getSeedanceTask("cgt-2", { apiKey: "k", fetchImpl: failed as unknown as typeof fetch });
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/declined/);
    await expect(getSeedanceTask("x", { apiKey: "k", fetchImpl: (async () => { throw new Error("net"); }) as unknown as typeof fetch })).rejects.toBeInstanceOf(SeedanceError);
  });

  it("cancel tolerates an already-gone task", async () => {
    const gone = vi.fn(async () => ok({}, 404));
    await expect(cancelSeedanceTask("cgt-3", { apiKey: "k", fetchImpl: gone as unknown as typeof fetch })).resolves.toBeUndefined();
  });
});

describe("seedance prompt writer", () => {
  const brief = { business: { name: "Nova Phones Kigali", language: "English" }, product: { name: "Galaxy A56", price: "420,000 RWF", usps: ["Big battery"] }, references: ["Image 1: the phone on a stand"], templateId: "ugc-review", seconds: 5, ratio: "9:16", audio: true, presenter: null };

  it("the brief carries the facts, the template and the references", () => {
    const t = promptBriefText(brief);
    expect(t).toContain("<<<PRODUCT");
    expect(t).toContain("Customer review");
    expect(t).toContain("Image 1: the phone on a stand");
    expect(t).toContain("No presenter");
  });

  it("returns Claude's text, fences removed, with the usage", async () => {
    const send = vi.fn(async () => ({ text: "```\n0-2s: a hand lifts the phone from Image 1.\n```", usage: { model: "m", inputTokens: 10, outputTokens: 5, costUsd: 0.001 }, stop: "end_turn" }));
    const out = await writeSeedancePrompt(brief, send, "m");
    expect(out.prompt).toBe("0-2s: a hand lifts the phone from Image 1.");
    expect(out.usage.costUsd).toBe(0.001);
    const call = (send.mock.calls as unknown as [{ maxTokens: number; system: string }][])[0][0];
    expect(call.maxTokens).toBe(800);
    expect(call.system).toContain("No invented prices");
  });
});
