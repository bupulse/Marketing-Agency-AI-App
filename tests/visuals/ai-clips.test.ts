import { beforeEach, describe, expect, it, vi } from "vitest";

// The overnight AI clips (lib/visuals/ai-clips.ts) against an in-memory ContentVisual table that understands the
// filters the code uses (equality, null, in, notIn, lt, gte, OR, AND), so the leases and the refund-once updates are
// tested for real, and Google Veo as a fake fetch. Nothing real is called and nothing is paid.
const db = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), aiCalls: [] as { inputTokens: number; createdAt: Date }[] }));
const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    if (k === "AND") return (cond as Record<string, unknown>[]).every((w) => matches(row, w));
    const v = row[k] ?? null;
    if (cond === null) return v === null;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond === "object") {
      const c = cond as { in?: unknown[]; notIn?: unknown[]; lt?: Date; gte?: Date };
      if (c.in) return c.in.includes(v);
      if (c.notIn) return v !== null && !c.notIn.includes(v);
      if (c.lt) return v instanceof Date && v.getTime() < c.lt.getTime();
      if (c.gte) return v instanceof Date && v.getTime() >= c.gte.getTime();
    }
    return v === cond;
  });
const prisma = vi.hoisted(() => ({
  contentVisual: {
    findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => [...db.rows.values()].filter((r) => matches(r, where)).slice(0, take ?? 100)),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const r = db.rows.get(where.id);
      return r ? { ...r, business: { userId: "company-1", name: "LEAF", country: "Rwanda" } } : null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const [id, row] of db.rows) {
        if (!matches(row, where)) continue;
        db.rows.set(id, { ...row, ...data });
        count++;
      }
      return { count };
    }),
  },
  aiCall: { count: vi.fn(async ({ where }: { where: { createdAt: { gte: Date } } }) => db.aiCalls.filter((c) => c.inputTokens === 0 && c.createdAt >= where.createdAt.gte).length) },
  generatedContent: { findFirst: vi.fn(async () => ({ productId: "prod-1", campaignId: null })) },
  post: { findFirst: vi.fn(async () => null) },
  product: { findFirst: vi.fn(async () => ({ name: "LEAF Hydro Tower", summary: "A vertical garden for balconies." })) },
  campaign: { findFirst: vi.fn(async () => null) },
}));
const usage = vi.hoisted(() => ({
  consumeUsage: vi.fn<(...args: unknown[]) => Promise<{ periodStart: Date }>>(async () => ({ periodStart: new Date("2026-10-01T00:00:00Z") })),
  refundUsage: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
}));
const sw = vi.hoisted(() => ({ veoOn: true }));
const storage = vi.hoisted(() => ({
  uploads: [] as { bucket: string; path: string }[],
  removed: [] as string[],
  uploadError: null as null | { message: string },
}));
const ledger = vi.hoisted(() => ({ submits: 0, recorded: [] as number[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => undefined) }));
vi.mock("@/lib/usage", async (orig) => {
  const real = await orig<typeof import("@/lib/usage")>();
  return { ...real, consumeUsage: usage.consumeUsage, refundUsage: usage.refundUsage };
});
vi.mock("@/lib/admin/switch", async (orig) => {
  const real = await orig<typeof import("@/lib/admin/switch")>();
  return { ...real, isServiceEnabled: vi.fn(async () => sw.veoOn) };
});
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: vi.fn(async (_ctx: unknown, _meta: unknown, call: () => Promise<unknown>) => {
    const out = await call();
    ledger.submits += 1;
    db.aiCalls.push({ inputTokens: 0, createdAt: new Date() });
    return out;
  }),
  recordAiCall: vi.fn(async (_ctx: unknown, entry: { usage: { inputTokens: number } }) => void ledger.recorded.push(entry.usage.inputTokens)),
}));
vi.mock("@/lib/video-engine/veo-frame", () => ({ firstFrame: vi.fn(async () => Buffer.from("jpeg-frame")) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        download: vi.fn(async () => ({ data: new Blob([new Uint8Array(2000)]), error: null })),
        upload: vi.fn(async (path: string) => {
          if (storage.uploadError) return { error: storage.uploadError };
          storage.uploads.push({ bucket, path });
          return { error: null };
        }),
        remove: vi.fn(async (paths: string[]) => {
          storage.removed.push(...paths);
          return { error: null };
        }),
      }),
    },
  }),
}));

import { CLIP_GIVE_UP_MS, readClipJobs, releaseClips, runAiClips } from "@/lib/visuals/ai-clips";
import { CLIP_NOTES } from "@/lib/visuals/clip-scenes";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { UsageLimitError } from "@/lib/usage";
import type { VideoPlan } from "@/lib/visuals/types";

const env = { GEMINI_API_KEY: "test-key" };
const T0 = new Date("2026-10-23T22:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const MP4 = (() => {
  const b = new Uint8Array(4000).fill(7);
  b.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
  return b;
})();

function plan(photos = ["company-1/projects/p1.jpg", "company-1/projects/p2.jpg"]): VideoPlan {
  const p = buildVideoPlan({ script: "Grow your own greens\nNo soil, no mess\nFits any balcony", hook: "Fresh lettuce at home", businessName: "LEAF", photos, pack: "bold" });
  return { ...p, quality: "ai" };
}

function addVisual(id: string, extra: Record<string, unknown> = {}) {
  db.rows.set(id, { id, businessId: "biz-1", contentId: "content-1", groupId: null, kind: "video", status: "pending", plan: plan(), clipState: "waiting", clipJobs: [], clipCredits: 0, clipPeriodStart: null, clipUntil: null, clipLeaseUntil: null, createdAt: T0, updatedAt: T0, ...extra });
}

/** Google Veo as a fetch: each submit answers an operation; each operation answers from `ops` (by its number). */
function veo(ops: Record<number, "running" | "done" | "blocked" | "failed"> = {}, submit: number[] = []) {
  let n = 0;
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    if (u.endsWith(":predictLongRunning")) {
      n += 1;
      if (submit.includes(n)) return new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "bad" } }), { status: 400 });
      return Response.json({ name: `models/veo-3.1-lite-generate-preview/operations/op${n}` });
    }
    const op = u.match(/operations\/op(\d+)$/);
    if (op) {
      const state = ops[Number(op[1])] ?? "done";
      if (state === "running") return Response.json({ name: `op${op[1]}`, done: false });
      if (state === "blocked") return Response.json({ name: `op${op[1]}`, done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["celebrity"] } } });
      if (state === "failed") return Response.json({ name: `op${op[1]}`, done: true, error: { code: 13, message: "internal" } });
      return Response.json({ name: `op${op[1]}`, done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `https://generativelanguage.googleapis.com/v1beta/files/clip${op[1]}:download` } }] } } });
    }
    if (u.includes("/files/")) return new Response(MP4, { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const row = (id: string) => db.rows.get(id)!;
const rowPlan = (id: string) => row(id).plan as VideoPlan;

beforeEach(() => {
  db.rows.clear();
  db.aiCalls.length = 0;
  storage.uploads.length = 0;
  storage.removed.length = 0;
  storage.uploadError = null;
  ledger.submits = 0;
  ledger.recorded.length = 0;
  sw.veoOn = true;
  usage.consumeUsage.mockClear();
  usage.refundUsage.mockClear();
});

describe("AI clips: falling back before anything is paid", () => {
  it("the Veo switch off: a simple video, the mark cleared, no credits and no call", async () => {
    sw.veoOn = false;
    addVisual("v1");
    const g = veo();
    const out = await runAiClips(T0, { env, fetchImpl: g.fetchImpl });
    expect(out.fallback).toBe(1);
    expect(row("v1").clipState).toBe("fallback");
    expect(rowPlan("v1").quality).toBe("simple");
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.off);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
    expect(g.calls).toHaveLength(0);
  });

  it("no Gemini key: the same", async () => {
    addVisual("v1");
    await runAiClips(T0, { env: {}, fetchImpl: veo().fetchImpl });
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.off);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("not enough studio credits: a simple video, nothing sent to Google", async () => {
    usage.consumeUsage.mockRejectedValueOnce(new UsageLimitError("limit_reached", "videoCredits"));
    addVisual("v1");
    const g = veo();
    await runAiClips(T0, { env, fetchImpl: g.fetchImpl });
    expect(row("v1").clipState).toBe("fallback");
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.credits);
    expect(g.calls).toHaveLength(0);
    expect(usage.refundUsage).not.toHaveBeenCalled();
  });

  it("an account that cannot use credits (past due): its own message", async () => {
    usage.consumeUsage.mockRejectedValueOnce(new UsageLimitError("past_due", "videoCredits"));
    addVisual("v1");
    await runAiClips(T0, { env, fetchImpl: veo().fetchImpl });
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.blockedAccount);
  });

  it("no photo in the video: a simple video, no credits", async () => {
    addVisual("v1", { plan: plan([]) });
    await runAiClips(T0, { env, fetchImpl: veo().fetchImpl });
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.noPhoto);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("BuPulse's daily clip limit reached: a simple video, no credits", async () => {
    for (let i = 0; i < 9; i++) db.aiCalls.push({ inputTokens: 0, createdAt: T0 });
    addVisual("v1");
    await runAiClips(T0, { env: { ...env, VEO_CLIPS_PER_DAY: "10" }, fetchImpl: veo().fetchImpl });
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.busy);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("a video made meanwhile (no longer pending): left alone, nothing taken", async () => {
    addVisual("v1", { status: "ready" });
    await runAiClips(T0, { env, fetchImpl: veo().fetchImpl });
    expect(row("v1").clipState).toBeNull();
    expect(rowPlan("v1").quality).toBe("ai");
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });
});

describe("AI clips: made overnight", () => {
  it("takes 190 credits, submits 2 clips, then saves them into the plan's scenes", async () => {
    addVisual("v1");
    const g = veo();
    const first = await runAiClips(T0, { env, fetchImpl: g.fetchImpl });
    expect(first.started).toBe(1);
    expect(usage.consumeUsage).toHaveBeenCalledWith("company-1", "videoCredits", 190);
    expect(row("v1").clipState).toBe("making");
    expect(row("v1").clipCredits).toBe(190);
    expect(readClipJobs(row("v1").clipJobs).map((j) => j.status)).toEqual(["submitted", "submitted"]);
    expect(ledger.submits).toBe(2);

    const second = await runAiClips(later(4 * 60_000), { env, fetchImpl: g.fetchImpl });
    expect(second.made).toBe(2);
    expect(second.done).toBe(1);
    expect(row("v1").clipState).toBe("done");
    expect(row("v1").clipCredits).toBe(0);
    const p = rowPlan("v1");
    expect(p.quality).toBe("ai");
    expect(p.aiNote).toBeNull();
    const clipped = p.scenes.filter((s) => s.clipPath);
    expect(clipped).toHaveLength(2);
    expect(clipped.map((s) => s.clipPath)).toEqual(["company-1/aiclips/v1-0.mp4", "company-1/aiclips/v1-1.mp4"]);
    expect(storage.uploads.every((u) => u.bucket === "media")).toBe(true);
    // Clip scenes are held for the clip, the video still within 30 s.
    expect(clipped.every((s) => s.durationMs === 6000)).toBe(true);
    expect(p.totalMs).toBeLessThanOrEqual(30_000);
    // Google's billing: 6 seconds each in the ledger. Nothing given back.
    expect(ledger.recorded).toEqual([6, 6]);
    expect(usage.refundUsage).not.toHaveBeenCalled();
  });

  it("waits while Google is still making a clip", async () => {
    addVisual("v1");
    const g = veo({ 1: "running", 2: "running" });
    await runAiClips(T0, { env, fetchImpl: g.fetchImpl });
    await runAiClips(later(4 * 60_000), { env, fetchImpl: g.fetchImpl });
    expect(row("v1").clipState).toBe("making");
    expect(row("v1").clipCredits).toBe(190);
  });

  it("one clip blocked: keeps the good one, gives back its 95 credits, says why", async () => {
    addVisual("v1");
    const g = veo({ 2: "blocked" });
    await runAiClips(T0, { env, fetchImpl: g.fetchImpl });
    await runAiClips(later(4 * 60_000), { env, fetchImpl: g.fetchImpl });
    expect(row("v1").clipState).toBe("done");
    expect(rowPlan("v1").scenes.filter((s) => s.clipPath)).toHaveLength(1);
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.partial);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(usage.refundUsage).toHaveBeenCalledWith("company-1", "videoCredits", new Date("2026-10-01T00:00:00Z"), 95);
  });

  it("both clips blocked: a simple video, all 190 back exactly once", async () => {
    addVisual("v1");
    const g = veo({ 1: "blocked", 2: "blocked" });
    await runAiClips(T0, { env, fetchImpl: g.fetchImpl });
    await runAiClips(later(4 * 60_000), { env, fetchImpl: g.fetchImpl });
    await runAiClips(later(8 * 60_000), { env, fetchImpl: g.fetchImpl });
    expect(row("v1").clipState).toBe("fallback");
    expect(rowPlan("v1").quality).toBe("simple");
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.blocked);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(usage.refundUsage.mock.calls[0][3]).toBe(190);
  });

  it("Google refuses both submissions: a simple video, credits back once", async () => {
    addVisual("v1");
    await runAiClips(T0, { env, fetchImpl: veo({}, [1, 2]).fetchImpl });
    expect(row("v1").clipState).toBe("fallback");
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.failed);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(usage.refundUsage.mock.calls[0][3]).toBe(190);
  });

  it("too slow: given up after the limit, credits back, simple video", async () => {
    addVisual("v1");
    const g = veo({ 1: "running", 2: "running" });
    await runAiClips(T0, { env, fetchImpl: g.fetchImpl });
    await runAiClips(later(CLIP_GIVE_UP_MS + 60_000), { env, fetchImpl: g.fetchImpl });
    expect(row("v1").clipState).toBe("fallback");
    expect(rowPlan("v1").aiNote).toBe(CLIP_NOTES.timeout);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
  });

  it("a clip that cannot be saved is tried again on the next sweep", async () => {
    addVisual("v1");
    const g = veo();
    await runAiClips(T0, { env, fetchImpl: g.fetchImpl });
    storage.uploadError = { message: "storage down" };
    await runAiClips(later(4 * 60_000), { env, fetchImpl: g.fetchImpl });
    expect(row("v1").clipState).toBe("making");
    storage.uploadError = null;
    await runAiClips(later(8 * 60_000), { env, fetchImpl: g.fetchImpl });
    expect(row("v1").clipState).toBe("done");
  });

  it("a held row (another sweep's lease) is not touched", async () => {
    addVisual("v1", { clipLeaseUntil: later(60_000) });
    await runAiClips(T0, { env, fetchImpl: veo().fetchImpl });
    expect(row("v1").clipState).toBe("waiting");
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("a start that died after taking the credits (nothing at Google): the credits go back once", async () => {
    addVisual("v1", { clipCredits: 190, clipPeriodStart: new Date("2026-10-01T00:00:00Z") });
    await runAiClips(T0, { env, fetchImpl: veo().fetchImpl });
    await runAiClips(later(4 * 60_000), { env, fetchImpl: veo().fetchImpl });
    expect(row("v1").clipState).toBe("fallback");
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("a start that died after submitting: the clips at Google are followed up, not paid twice", async () => {
    addVisual("v1", { clipCredits: 190, clipPeriodStart: new Date("2026-10-01T00:00:00Z"), clipJobs: [{ scene: 0, photoPath: "company-1/projects/p1.jpg", operation: "models/veo-3.1-lite-generate-preview/operations/op1", status: "submitted" }] });
    const g = veo();
    await runAiClips(T0, { env, fetchImpl: g.fetchImpl });
    expect(row("v1").clipState).toBe("making");
    await runAiClips(later(4 * 60_000), { env, fetchImpl: g.fetchImpl });
    expect(row("v1").clipState).toBe("done");
    expect(usage.consumeUsage).not.toHaveBeenCalled();
    expect(ledger.submits).toBe(0);
  });
});

describe("releaseClips", () => {
  it("gives held credits back once and deletes the clip files", async () => {
    const p = plan();
    p.scenes[0].clipPath = "company-1/aiclips/v1-0.mp4";
    p.scenes[1].clipPath = "other-user/aiclips/v9-0.mp4";
    addVisual("v1", { plan: p, clipState: "making", clipCredits: 190, clipPeriodStart: new Date("2026-10-01T00:00:00Z") });
    await releaseClips("v1");
    await releaseClips("v1");
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(storage.removed).toContain("company-1/aiclips/v1-0.mp4");
    expect(storage.removed).not.toContain("other-user/aiclips/v9-0.mp4");
  });
});
