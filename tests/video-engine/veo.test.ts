import { describe, expect, it, vi } from "vitest";
import { VEO_MODELS, VeoError, withoutMoney, checkVeoConnection, defaultClipPlan, downloadVeo, getVeoOperation, isOmniModel, makeVeoClip, omniBody, submitVeo, veoBody, veoClipBytes, veoClipUsd, veoLedgerUsage, veoModel, veoPrompt, veoTierOf, veoUsdPerSecond, type VeoRequest } from "@/lib/video-engine/veo";
import { creditsForUsd, veoClipCredits } from "@/lib/video-engine/credits";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { clipSoundCues, isAiClipUrl, videoClips } from "@/lib/video-engine/video-frames";
import type { MotionSpec } from "@/lib/video-engine/spec";

// All Veo calls are mocked: no test spends money.
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const mp4 = () => {
  const b = Buffer.alloc(4096);
  b.write("ftypisom", 4, "latin1");
  return new Response(new Uint8Array(b), { status: 200, headers: { "content-type": "video/mp4" } });
};
// The Veo request shape (predictLongRunning); the Gemini Omni tests below use `omniReq`.
const req: VeoRequest = { model: VEO_MODELS.lite.id, prompt: "A hand lifts the tower.", image: { base64: "AAAA", mimeType: "image/jpeg" }, ratio: "9:16", seconds: 4, resolution: "720p" };
const omniReq: VeoRequest = { ...req, model: VEO_MODELS.omni.id };
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

describe("AI clips in the mix", () => {
  it("never plays a Veo clip's own sound, even when a design or a hand edit asks for it; other clips keep theirs", () => {
    const layer = (url: string, sound: boolean) => ({ kind: "video", url, fit: "cover", start: 0, sound, x: 0.5, y: 0.5, w: 1, h: 1 });
    const spec = { scenes: [{ seconds: 4, layers: [layer("/videos/veo/vc-0123456789ab.mp4", true)] }, { seconds: 4, layers: [layer("/api/clip/um-0123456789ab", true)] }] } as unknown as Pick<MotionSpec, "scenes">;
    expect(isAiClipUrl("/videos/veo/vc-0123456789ab.mp4")).toBe(true);
    expect(isAiClipUrl("/videos/seedance/sd-0123456789ab.mp4")).toBe(false);
    expect(videoClips(spec)).toEqual([
      { url: "/videos/veo/vc-0123456789ab.mp4", sound: false },
      { url: "/api/clip/um-0123456789ab", sound: true },
    ]);
    expect(clipSoundCues(spec).map((c) => c.url)).toEqual(["/api/clip/um-0123456789ab"]);
  });
});

describe("Gemini Omni Flash (the default since the Veo 3.1 previews shut down, 22 October 2026)", () => {
  const MP4 = (() => {
    const b = Buffer.alloc(4096);
    b.write("ftypisom", 4, "latin1");
    return b;
  })();

  it("is the default model, priced at about $0.10 a second (190 credits for 6 s, 380 for an AI video of 2 clips)", () => {
    expect(veoModel({})).toBe("gemini-omni-1.1-flash");
    expect(veoModel({ VEO_MODEL: "veo-3.1-lite-generate-preview" })).toBe("veo-3.1-lite-generate-preview");
    expect(isOmniModel(veoModel({}))).toBe(true);
    expect(veoTierOf("gemini-omni-1.1-flash")).toBe("omni");
    expect(veoTierOf("veo-3.1-lite-generate-001")).toBe("lite");
    expect(veoUsdPerSecond(VEO_MODELS.omni.id, "720p", {})).toBe(0.1);
    expect(veoClipCredits(4, VEO_MODELS.omni.id, "720p", {})).toBe(130);
    expect(veoClipCredits(6, VEO_MODELS.omni.id, "720p", {})).toBe(190);
    expect(veoClipCredits(8, VEO_MODELS.omni.id, "720p", {})).toBe(255);
    // The ledger prices Omni seconds as video, not as a Gemini text model.
    expect(estimateCostUsd("gemini-omni-1.1-flash", veoLedgerUsage("gemini-omni-1.1-flash", 6).usage)).toBeCloseTo(0.6);
  });

  it("builds the Interactions request: the photo then the prompt, image to video, 9:16, in the background", () => {
    expect(omniBody(omniReq)).toEqual({
      model: "gemini-omni-1.1-flash",
      input: [{ type: "image", data: "AAAA", mime_type: "image/jpeg" }, { type: "text", text: req.prompt }],
      response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p", delivery: "uri" },
      generation_config: { video_config: { task: "image_to_video" } },
      background: true,
    });
    expect(omniBody({ ...omniReq, image: null })).toMatchObject({ input: req.prompt, generation_config: { video_config: { task: "text_to_video" } } });
  });

  it("submits to /interactions and names the operation interactions/<id>", async () => {
    const f = vi.fn(async () => ok({ id: "v1_abc", status: "in_progress" }));
    expect(await submitVeo(omniReq, o(f as unknown as typeof fetch))).toBe("interactions/v1_abc");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(JSON.parse(String(init.body)).model).toBe("gemini-omni-1.1-flash");
    // Omni's errors ({ error: { code, message } }) are explained in plain English too.
    const e = await submitVeo(omniReq, o((async () => ok({ error: { code: "invalid_request", message: "bad thing in project 99" } }, 400)) as unknown as typeof fetch)).then(() => null, (x: unknown) => x as VeoError);
    expect(e).toBeInstanceOf(VeoError);
    expect(e?.message).not.toMatch(/99/);
  });

  it("reads an interaction: working, the clip inline or as a link, a safety block, a failure", async () => {
    const read = (body: unknown) => getVeoOperation("interactions/v1_abc", o((async () => ok(body)) as unknown as typeof fetch));
    expect(await read({ id: "v1_abc", status: "in_progress" })).toMatchObject({ done: false, error: null });
    const inline = await read({ status: "completed", steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: MP4.toString("base64") }] }] });
    expect(inline.done).toBe(true);
    expect((await veoClipBytes(inline, o((async () => mp4()) as unknown as typeof fetch))).length).toBe(4096);
    const linked = await read({ status: "completed", steps: [{ type: "model_output", content: [{ type: "video", uri: "files/xyz" }] }] });
    expect(linked.videoUri).toBe("https://generativelanguage.googleapis.com/v1beta/files/xyz");
    const blocked = await read({ status: "failed", error: { code: "invalid_request", message: "The input violates our usage policies." } });
    expect(blocked.error?.kind).toBe("blocked");
    expect((await read({ status: "failed", error: { code: "internal", message: "Something broke" } })).error?.kind).toBe("failed");
    expect((await read({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "I can't make that." }] }] })).error?.kind).toBe("failed");
    await expect(veoClipBytes({ videoUri: null, videoBytes: Buffer.from("not a video at all, far too short") }, o((async () => mp4()) as unknown as typeof fetch))).rejects.toThrow(/not an MP4/);
  });

  it("downloads a Files API link through its download form", async () => {
    const f = vi.fn(async () => mp4());
    await downloadVeo("https://generativelanguage.googleapis.com/v1beta/files/xyz", o(f as unknown as typeof fetch));
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://generativelanguage.googleapis.com/v1beta/files/xyz:download?alt=media");
  });

  it("makes a clip end to end: submit, poll, the inline video, its cost", async () => {
    let polls = 0;
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("/interactions")) return ok({ id: "v1_x", status: "in_progress" });
      return ok(++polls < 2 ? { status: "in_progress" } : { status: "completed", steps: [{ type: "model_output", content: [{ type: "video", data: MP4.toString("base64") }] }] });
    });
    const clip = await makeVeoClip({ ...omniReq, seconds: 6 }, { ...o(f as unknown as typeof fetch), sleep: async () => {} });
    expect(clip).toMatchObject({ operation: "interactions/v1_x", model: "gemini-omni-1.1-flash", seconds: 6 });
    expect(clip.costUsd).toBeCloseTo(0.6);
  });

  it("asks for the clip's length in the prompt (Omni has no length setting)", () => {
    expect(veoPrompt({ shot: "Hands lift it.", seconds: 6 }, { productName: "LEAF Hydro Tower" })).toMatch(/Length: about 6 seconds/);
  });
});

describe("no money in clip prompts (Gemini Omni refuses a request that says a price)", () => {
  it("drops the sentences of the product's summary that mention money, and the amount in its name", () => {
    expect(withoutMoney("Grow greens at home. Only 45,000 RWF this week! Fits any balcony.")).toBe("Grow greens at home. Fits any balcony.");
    expect(withoutMoney("A tower for $120. Big discount for schools.")).toBe("");
    expect(withoutMoney("Igiciro: 30.000 Frw. Ibihingwa bishya buri munsi.")).toBe("Ibihingwa bishya buri munsi.");
    expect(withoutMoney("Grows 30 plants in a metre of space.")).toBe("Grows 30 plants in a metre of space.");
    const p = veoPrompt({ shot: "Hands lift it." }, { productName: "LEAF Hydro Tower - 45,000 RWF", summary: "Grow greens at home. Now 20% off!" });
    expect(p).toMatch(/LEAF Hydro Tower/);
    expect(p).not.toMatch(/45,000|RWF|20%|off!/);
    expect(defaultClipPlan({ productName: "LEAF Hydro Tower (45,000 RWF)" }, 2).map((n) => n.shot).join(" ")).not.toMatch(/45,000|RWF/);
  });

  it("cleans recipe and page shots too: a shot only about money becomes a plain product shot", () => {
    const p = veoPrompt({ shot: "The owner holds up a price card next to the tower.", setting: "A market stall with a 50% off sign" }, { productName: "LEAF Hydro Tower" });
    expect(p).not.toMatch(/price card|50%|off sign/i);
    expect(p).toMatch(/Shot: The LEAF Hydro Tower, shown clearly/);
    expect(veoPrompt({ shot: "Hands lift the tower. Then a 30,000 Frw label.", setting: null }, { productName: "LEAF Hydro Tower" })).toMatch(/Shot: Hands lift the tower\./);
  });
});

