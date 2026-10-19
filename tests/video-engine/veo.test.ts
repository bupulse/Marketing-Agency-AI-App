import { describe, expect, it, vi } from "vitest";
import { VEO_MODELS, VeoError, checkVeoConnection, defaultClipPlan, downloadVeo, getVeoOperation, makeVeoClip, submitVeo, veoBody, veoClipUsd, veoLedgerUsage, veoPrompt, veoUsdPerSecond, type VeoRequest } from "@/lib/video-engine/veo";
import { creditsForUsd, veoClipCredits } from "@/lib/video-engine/credits";
import { estimateCostUsd } from "@/lib/ai/pricing";

// All Veo calls are mocked: no test spends money.
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const mp4 = () => {
  const b = Buffer.alloc(4096);
  b.write("ftypisom", 4, "latin1");
  return new Response(new Uint8Array(b), { status: 200, headers: { "content-type": "video/mp4" } });
};
const req: VeoRequest = { prompt: "A hand lifts the tower.", image: { base64: "AAAA", mimeType: "image/jpeg" }, ratio: "9:16", seconds: 4, resolution: "720p" };
const o = (fetchImpl: typeof fetch) => ({ apiKey: "test-key", fetchImpl });

describe("veo request", () => {
  it("builds the predictLongRunning body (first frame in the predict format, 9:16, 720p, adults only)", () => {
    const b = veoBody(req) as { instances: Record<string, unknown>[]; parameters: Record<string, unknown> };
    expect(b.instances[0]).toEqual({ prompt: req.prompt, image: { bytesBase64Encoded: "AAAA", mimeType: "image/jpeg" } });
    expect(b.parameters).toEqual({ aspectRatio: "9:16", resolution: "720p", durationSeconds: 4, personGeneration: "allow_adult" });
  });

  it("text-only clips allow all people (the only value Veo takes there); 1080p under 8 s falls back to 720p", () => {
    const b = veoBody({ ...req, image: null, resolution: "1080p" }) as { parameters: Record<string, unknown> };
    expect(b.parameters.personGeneration).toBe("allow_all");
    expect(b.parameters.resolution).toBe("720p");
    expect((veoBody({ ...req, seconds: 8, resolution: "1080p" }) as { parameters: Record<string, unknown> }).parameters.resolution).toBe("1080p");
  });

  it("prices per second, with VEO_USD_PER_SECOND overriding", () => {
    expect(veoUsdPerSecond(VEO_MODELS.lite.id, "720p", {})).toBe(0.05);
    expect(veoClipUsd(4, VEO_MODELS.lite.id, "720p", {})).toBeCloseTo(0.2);
    expect(veoClipUsd(8, VEO_MODELS.fast.id, "720p", {})).toBeCloseTo(0.8);
    expect(veoUsdPerSecond(VEO_MODELS.lite.id, "720p", { VEO_USD_PER_SECOND: "0.07" })).toBe(0.07);
  });

  it("credits follow the owner's formula: 4 s 65, 6 s 95, 8 s 130", () => {
    expect(veoClipCredits(4, VEO_MODELS.lite.id, "720p", {})).toBe(65);
    expect(veoClipCredits(6, VEO_MODELS.lite.id, "720p", {})).toBe(95);
    expect(veoClipCredits(8, VEO_MODELS.lite.id, "720p", {})).toBe(130);
    expect(veoClipCredits(4, VEO_MODELS.lite.id, "720p", {})).toBe(creditsForUsd(0.2));
  });

  it("the ledger prices a clip's seconds at the list price", () => {
    const u = veoLedgerUsage(VEO_MODELS.lite.id, 4);
    expect(u.provider).toBe("veo");
    expect(estimateCostUsd(u.model, u.usage)).toBeCloseTo(0.2);
    expect(estimateCostUsd(VEO_MODELS.fast.id, { inputTokens: 6 })).toBeCloseTo(0.6);
  });
});

describe("veo prompts", () => {
  const facts = { productName: "LEAF Hydro Tower", summary: "A vertical hydroponic tower for growing greens at home.", country: "Rwanda" };

  it("keeps the product, forbids text and invented logos, adults only and East African, no speech", () => {
    const p = veoPrompt({ shot: "Hands harvest lettuce from the tower." }, facts);
    expect(p).toMatch(/Vertical 9:16/);
    expect(p).toMatch(/first frame shows the real product: LEAF Hydro Tower/);
    expect(p).toMatch(/Do not add any text.*logos, brand names/);
    expect(p).toMatch(/adults only, East African/);
    expect(p).toMatch(/no famous people/);
    expect(p).toMatch(/No dialogue/);
    expect(p).toMatch(/no change of scene/);
    expect(veoPrompt({ shot: "x" }, facts, { withImage: false })).toMatch(/Setting: a bright, tidy shop in Kigali, Rwanda/);
    expect(p.length).toBeLessThan(2400);
  });

  it("a shot without people says so, and links never reach the prompt", () => {
    const p = veoPrompt({ shot: "Close detail, see https://example.com/x", people: false }, facts);
    expect(p).toMatch(/No people in the shot/);
    expect(p).not.toMatch(/https?:/);
  });

  it("the default plan is in use, in a Kigali setting, then a close detail (2 or 3 clips)", () => {
    const plan = defaultClipPlan(facts, 3);
    expect(plan).toHaveLength(3);
    expect(plan[0].shot).toMatch(/hands pick up and use/);
    expect(plan[1].shot).toMatch(/Kigali/);
    expect(plan[2].shot).toMatch(/close-up/);
    expect(defaultClipPlan(facts, 2)).toHaveLength(2);
    expect(defaultClipPlan(facts, 9)).toHaveLength(3);
  });
});

describe("veo calls", () => {
  it("submits with the key header to the model's predictLongRunning", async () => {
    const f = vi.fn(async () => ok({ name: "models/veo-3.1-lite-generate-preview/operations/abc123" }));
    expect(await submitVeo(req, o(f as unknown as typeof fetch))).toBe("models/veo-3.1-lite-generate-preview/operations/abc123");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
  });

  it("explains billing, quota, key and server problems in plain English, never with Google's message", async () => {
    const run = (status: number, body: unknown) => submitVeo(req, o((async () => ok(body, status)) as unknown as typeof fetch)).then(() => new VeoError("no error", "invalid"), (e: unknown) => e as VeoError);
    const billing = await run(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric generate_requests_per_model, limit: 0, project 12345" } });
    expect(billing.kind).toBe("billing");
    expect(billing.message).not.toMatch(/12345/);
    expect((await run(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Too many requests" } })).kind).toBe("quota");
    expect((await run(400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } })).kind).toBe("key");
    expect((await run(400, { error: { status: "FAILED_PRECONDITION", message: "Billing is not enabled for this project" } })).kind).toBe("billing");
    const busy = await run(503, {});
    expect(busy.kind).toBe("busy");
    expect(busy.temporary).toBe(true);
  });

  it("reads a finished operation: the video, a safety block, or an error", async () => {
    const read = (body: unknown) => getVeoOperation("models/x/operations/1", o((async () => ok(body)) as unknown as typeof fetch));
    expect(await read({ done: false })).toMatchObject({ done: false, videoUri: null, error: null });
    expect(await read({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/a:download?alt=media" } }] } } })).toMatchObject({ done: true, videoUri: expect.stringContaining("files/a"), error: null });
    const blocked = await read({ done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["The photo may show a real person."] } } });
    expect(blocked.error?.kind).toBe("blocked");
    expect(blocked.error?.temporary).toBe(false);
    expect(blocked.error?.reasons).toEqual(["The photo may show a real person."]);
    const failed = await read({ done: true, error: { code: 13, message: "Internal error" } });
    expect(failed.error?.kind).toBe("failed");
    expect(failed.error?.temporary).toBe(true);
    await expect(getVeoOperation("../../evil", o((async () => ok({})) as unknown as typeof fetch))).rejects.toThrow(/not a Veo operation/);
  });

  it("downloads only from Google and only an MP4", async () => {
    await expect(downloadVeo("https://evil.example.com/x.mp4", o((async () => mp4()) as unknown as typeof fetch))).rejects.toThrow(/unexpected download address/);
    await expect(downloadVeo("https://generativelanguage.googleapis.com/f", o((async () => ok({ hi: 1 })) as unknown as typeof fetch))).rejects.toThrow(/not an MP4/);
    expect((await downloadVeo("https://generativelanguage.googleapis.com/f", o((async () => mp4()) as unknown as typeof fetch))).length).toBe(4096);
  });

  it("makes a clip: submit, poll until done, download, cost", async () => {
    let polls = 0;
    const f = vi.fn(async (url: string) => {
      if (url.endsWith(":predictLongRunning")) return ok({ name: "models/m/operations/op1" });
      if (url.endsWith("/operations/op1")) return ok(++polls < 2 ? { done: false } : { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/v:download" } }] } } });
      return mp4();
    });
    const states: string[] = [];
    const clip = await makeVeoClip({ ...req, model: VEO_MODELS.lite.id }, { ...o(f as unknown as typeof fetch), sleep: async () => {}, onState: (s) => void states.push(s) });
    expect(clip).toMatchObject({ operation: "models/m/operations/op1", seconds: 4, resolution: "720p", model: VEO_MODELS.lite.id });
    expect(clip.costUsd).toBeCloseTo(0.2);
    expect(clip.bytes.length).toBe(4096);
    expect(states).toEqual(["submitted", "downloading"]);
  });

  it("gives up after the longest wait with a temporary timeout", async () => {
    let t = 0;
    const f = vi.fn(async (url: string) => (url.endsWith(":predictLongRunning") ? ok({ name: "models/m/operations/slow" }) : ok({ done: false })));
    const e = await makeVeoClip(req, { ...o(f as unknown as typeof fetch), sleep: async () => {}, now: () => (t += 60_000), maxWaitMs: 300_000 }).then(() => null, (x: unknown) => x as VeoError);
    expect(e).toBeInstanceOf(VeoError);
    expect(e?.kind).toBe("timeout");
    expect(e?.temporary).toBe(true);
  });

  it("the readiness check is free (reads the model card) and says what to fix", async () => {
    expect((await checkVeoConnection({ apiKey: "" })).state).toBe("no key");
    expect((await checkVeoConnection({ apiKey: "k", fetchImpl: (async () => ok({ name: "models/veo" })) as unknown as typeof fetch })).state).toBe("connected");
    expect((await checkVeoConnection({ apiKey: "k", fetchImpl: (async () => ok({}, 404)) as unknown as typeof fetch })).state).toBe("no model");
    expect((await checkVeoConnection({ apiKey: "k", fetchImpl: (async () => ok({}, 403)) as unknown as typeof fetch })).state).toBe("key invalid");
  });
});
