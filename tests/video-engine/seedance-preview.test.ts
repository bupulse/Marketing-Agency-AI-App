import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SeedanceRequest } from "@/lib/video-engine/seedance";
import { buildStoryboard, frameSize, parseShots } from "@/video-lab/seedance-mock/storyboard";
import { previewDelayMs } from "@/video-lab/seedance-mock/preview";

const wallet = vi.hoisted(() => ({ charge: vi.fn(async () => ({})), refund: vi.fn(async () => ({})) }));
vi.mock("@/video-lab/credits", () => ({ charge: wallet.charge, refund: wallet.refund, seedanceCredits: () => 55 }));
vi.mock("@/video-lab/store", () => ({ record: vi.fn(async () => undefined) }));

const PROMPT = [
  "A vertical 9:16 product reveal ad for a phone shop in Rwanda. Light: rim light.",
  "0-3s: Macro shot, rack focus from the foreground to the subject: an edge of the Galaxy A56 from Image 1 emerges. Sound: a deep whoosh.",
  "3-6s: Close-up, slow orbit around the subject: the Galaxy A56 (Image 1) rotates <slowly>.",
  '6-8s: Clean hero shot, slow pull-back revealing the scene: it stands upright. A warm, friendly voice-over says in English: "Galaxy A56: 420,000 RWF."',
].join("\n");

let png = "";
let dir = "";
let jobs: typeof import("@/video-lab/seedance-jobs");
const req = (): SeedanceRequest => ({ tier: "mini", prompt: PROMPT, references: [{ kind: "image", url: png }], ratio: "9:16", seconds: 8, resolution: "480p", audio: true, fixedLens: false, seed: null });
const meta = { businessId: "b1", productId: "p1", title: "Galaxy A56", referenceNotes: ["Image 1: the phone on a stand"] };

beforeAll(async () => {
  png = `data:image/png;base64,${(await sharp({ create: { width: 400, height: 600, channels: 3, background: "#3366ff" } }).png().toBuffer()).toString("base64")}`;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "seedance-lab-"));
  process.env.SEEDANCE_LAB_DIR = dir;
  jobs = await import("@/video-lab/seedance-jobs");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  wallet.charge.mockClear();
  wallet.refund.mockClear();
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("storyboard", () => {
  it("reads the shots of a time-coded prompt: shot type, camera, sound, spoken line, references", () => {
    const { setting, shots } = parseShots(PROMPT, 8);
    expect(setting).toMatch(/^A vertical 9:16/);
    expect(shots.map((s) => [s.from, s.to])).toEqual([[0, 3], [3, 6], [6, 8]]);
    expect(shots[0]).toMatchObject({ shot: "Macro", cameraId: "rack-focus", sound: "a deep whoosh", references: ["Image 1"] });
    expect(shots[1].cameraId).toBe("orbit");
    expect(shots[2]).toMatchObject({ shot: "Hero end shot", cameraId: "pull-out", spoken: "Galaxy A56: 420,000 RWF." });
    expect(shots[2].action).not.toContain("420,000");
    expect(parseShots(PROMPT, 8, true).shots.every((s) => s.cameraId === "static")).toBe(true);
  });

  it("spreads a prompt without time codes over the clip", () => {
    const { shots } = parseShots("A hand lifts the phone. The camera pushes in. It glows on the table.", 9);
    expect(shots).toHaveLength(3);
    expect(shots.at(-1)?.to).toBe(9);
  });

  it("draws 3 or 4 frames as safe SVG, with the photo, the price and the notice", () => {
    const sb = buildStoryboard({ id: "sd-000000000000", title: "Galaxy A56", request: req(), referenceNotes: meta.referenceNotes, thumbs: ["data:image/jpeg;base64,THUMB"], credits: 55 });
    expect(sb.notice).toMatch(/^Preview: Seedance arrives with the BytePlus key/);
    expect(sb.frames.length).toBeGreaterThanOrEqual(3);
    expect(sb.frames.length).toBeLessThanOrEqual(4);
    expect(sb.frames[0].svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 180 320"/);
    expect(sb.frames[0].svg).toContain('href="data:image/jpeg;base64,THUMB"');
    expect(sb.frames.map((f) => f.svg).join("")).not.toContain("<slowly>");
    expect(sb.estimate).toEqual({ usd: 0.28, credits: 55, wait: "about 3 to 4 minutes" });
    expect(sb.references[0]).toMatchObject({ label: "Image 1: the phone on a stand", thumb: "data:image/jpeg;base64,THUMB" });
    const one = buildStoryboard({ id: "sd-000000000001", title: "x", request: { ...req(), prompt: "0-8s: a slow orbit around the phone." }, referenceNotes: [], thumbs: [], credits: 55 });
    expect(one.frames).toHaveLength(3);
    expect(frameSize("16:9")).toEqual({ w: 320, h: 180 });
  });

  it("waits 3 to 8 seconds, the same for the same job", () => {
    for (const id of ["sd-aaaaaaaaaaaa", "sd-0123456789ab", "sd-ffffffffffff"]) {
      expect(previewDelayMs(id)).toBeGreaterThanOrEqual(3000);
      expect(previewDelayMs(id)).toBeLessThanOrEqual(8000);
      expect(previewDelayMs(id)).toBe(previewDelayMs(id));
    }
  });
});

describe("preview jobs (no BytePlus key)", () => {
  it("submitSeedance does not throw: a free preview job that becomes a storyboard after the wait", async () => {
    vi.stubEnv("SEEDANCE_API_KEY", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-17T08:00:00Z").getTime();
    vi.setSystemTime(t0);
    expect(jobs.seedanceMode()).toBe("preview");
    const job = await jobs.submitSeedance(req(), meta);
    expect(job).toMatchObject({ status: "preview", credits: 0, taskId: null, preview: { wouldCostCredits: 55 } });
    expect(job.preview?.notice).toMatch(/Preview: Seedance arrives with the BytePlus key/);
    expect(wallet.charge).not.toHaveBeenCalled();

    const waiting = await jobs.getSeedancePreview(job.id);
    expect(waiting).toMatchObject({ ready: false });
    const wait = (waiting as { readyInMs: number }).readyInMs;
    expect(wait).toBeGreaterThanOrEqual(3000);
    expect(wait).toBeLessThanOrEqual(8000);

    vi.setSystemTime(t0 + wait);
    expect((await jobs.getSeedanceJob(job.id))?.status).toBe("preview-ready");
    const done = await jobs.getSeedancePreview(job.id);
    if (!done?.ready) throw new Error("not ready");
    expect(done.storyboard.shots).toHaveLength(3);
    expect(done.storyboard.references[0].thumb).toMatch(/^data:image\/jpeg;base64,/);
    expect(done.storyboard.frames[0].svg).toContain("<image href=\"data:image/jpeg;base64,");
    expect((await jobs.listSeedanceJobs()).some((j) => j.id === job.id && j.status === "preview-ready")).toBe(true);
    expect(wallet.charge).not.toHaveBeenCalled();
  });

  it("a preview can be cancelled while it renders, with nothing to refund", async () => {
    vi.stubEnv("SEEDANCE_API_KEY", "");
    const job = await jobs.submitSeedance(req(), meta);
    expect((await jobs.cancelSeedance(job.id))?.status).toBe("cancelled");
    expect(wallet.refund).not.toHaveBeenCalled();
    expect(await jobs.getSeedancePreview("sd-nothere")).toBeNull();
  });

  it("with the key, the real path is used: credits charged, the BytePlus task created", async () => {
    vi.stubEnv("SEEDANCE_API_KEY", "test-key");
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] }); // the 10 s poll never fires in the test
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "cgt-1" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(jobs.seedanceMode()).toBe("live");
    const job = await jobs.submitSeedance(req(), meta);
    expect(job).toMatchObject({ status: "queued", taskId: "cgt-1", credits: 55 });
    expect(job.preview).toBeUndefined();
    expect(wallet.charge).toHaveBeenCalledWith(55, "Seedance mini 480p 8s", job.id);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain("/contents/generations/tasks");
  });
});
