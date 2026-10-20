// Premium 3D renders run one at a time (a second job waits as "queued"), and a render Blender cannot finish in time
// is stopped and its credits given back. The render is real: a stand-in Blender (BLENDER_BIN) that never finishes,
// and a time limit of half a second (BLENDER_TIMEOUT_MS).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/video-lab/data-source", () => ({ musicFor: vi.fn(), musicBytes: vi.fn() }));
vi.mock("@/video-lab/voice", () => ({ makeVoiceForJob: vi.fn(), readVoiceMp3: vi.fn() }));

let premium: typeof import("@/video-lab/premium-jobs");
let credits: typeof import("@/video-lab/credits");
const cwd = process.cwd();
let dir = "";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

beforeAll(async () => {
  // The jobs, the photos and the wallet are written under the working directory: a temporary one.
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "premium-queue-"));
  const blender = path.join(dir, "blender.sh");
  await fs.writeFile(blender, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Blender 5.2.0"; exit 0; fi\nexec sleep 30\n', { mode: 0o755 });
  process.env.BLENDER_BIN = blender;
  process.env.BLENDER_TIMEOUT_MS = "500";
  process.chdir(dir);
  premium = await import("@/video-lab/premium-jobs");
  credits = await import("@/video-lab/credits");
});

afterAll(async () => {
  process.chdir(cwd);
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Premium 3D render queue", () => {
  it("runs renders in the order they came, one at a time, and goes on after a failure", async () => {
    const order: string[] = [];
    const waited: string[] = [];
    const first = deferred();
    const a = premium.oneRenderAtATime(async () => {
      order.push("a starts");
      await first.promise;
      order.push("a ends");
    }, () => waited.push("a"));
    const b = premium.oneRenderAtATime(async () => void order.push("b"), () => waited.push("b"));
    const c = premium.oneRenderAtATime(async () => void order.push("c"), () => waited.push("c"));
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["a starts"]);
    expect(waited).toEqual(["b", "c"]);
    first.reject(new Error("Blender failed"));
    await expect(a).rejects.toThrow("Blender failed");
    await Promise.all([b, c]);
    expect(order).toEqual(["a starts", "b", "c"]);
    // The line is empty again: the next render starts at once.
    let waits = false;
    await premium.oneRenderAtATime(async () => undefined, () => (waits = true));
    expect(waits).toBe(false);
  });

  it("queues a second clip behind the first and gives the credits back when a render times out", async () => {
    const source = "bl-00000000000a";
    const folder = path.join(dir, "video-lab/data/blender");
    await fs.mkdir(path.join(folder, "jobs"), { recursive: true });
    await fs.mkdir(path.join(folder, "videos"), { recursive: true });
    await fs.mkdir(path.join(folder, "photos", source), { recursive: true });
    await fs.writeFile(path.join(folder, "photos", source, "photo-1.jpg"), "jpeg");
    await fs.writeFile(path.join(folder, "videos", `${source}.scene.json`), JSON.stringify({ product: { photo: 1 } }));
    const at = new Date().toISOString();
    await fs.writeFile(path.join(folder, "jobs", `${source}.json`), JSON.stringify({ id: source, createdAt: at, updatedAt: at, status: "succeeded", progress: 1, credits: 100, quality: "540p", parentId: null, photoFiles: [], businessId: "b", productId: "p", title: "Dress", templateId: "showroom-turntable", ratio: "9:16", seconds: 6, note: null, caption: null, hashtags: [], say: null, repairs: [], warnings: [], apiEquivalentUsd: 0, audio: { voice: false, music: false, voiceFile: null, voiceNote: null, voiceCredits: 0, musicFile: null, musicTitle: null }, renderSeconds: 60, bytes: 1, videoFile: `${source}.mp4`, error: null }));
    const start = (await credits.readWallet()).balance;

    const first = await premium.rerenderPremium(source, "540p");
    const second = await premium.rerenderPremium(source, "540p");
    expect((await credits.readWallet()).balance).toBe(start - 2 * credits.PREMIUM_RERENDER_CREDITS);
    await vi.waitFor(async () => {
      expect((await premium.getPremiumJob(first.id))?.status).toBe("rendering");
      expect((await premium.getPremiumJob(second.id))?.status).toBe("queued");
    });

    // The first is stopped by the time limit; only then does the second render, and it is stopped too.
    await vi.waitFor(async () => expect((await premium.getPremiumJob(first.id))?.status).toBe("failed"), { timeout: 10_000 });
    await vi.waitFor(async () => expect((await premium.getPremiumJob(second.id))?.status).toBe("failed"), { timeout: 10_000 });
    for (const id of [first.id, second.id]) expect((await premium.getPremiumJob(id))?.error).toMatch(/took longer than .* and was stopped\. The credits are given back\./);

    const wallet = await credits.readWallet();
    expect(wallet.balance).toBe(start);
    const refunds = wallet.history.filter((h) => h.delta > 0 && h.note === "Premium 3D re-render failed").map((h) => h.jobId);
    expect(refunds).toEqual([first.id, second.id]);
  }, 30_000);
});
