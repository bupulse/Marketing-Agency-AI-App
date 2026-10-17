import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

type Job = Record<string, unknown> & { id: string };
const store = vi.hoisted(() => ({ jobs: new Map<string, Record<string, unknown>>(), next: 0 }));
const prisma = vi.hoisted(() => ({
  business: {
    findUnique: vi.fn(async (args: { where: { userId?: string; id?: string } }) =>
      args.where.userId ? { id: "b1" } : { name: "Nova Phones Kigali", description: "Phones in Kigali, with delivery", industryDescription: null, contentLanguage: "English", brandColors: ["#1f6feb"], phone: "+250 788 300 400", website: null, country: "Rwanda", tone: "friendly" },
    ),
  },
  product: { findFirst: vi.fn(async (): Promise<Record<string, unknown> | null> => ({ id: "p1", name: "Samsung Galaxy A56", summary: "A56 5G, 8 GB, 256 GB", description: null, priceModel: "FIXED", priceAmount: 420000, currency: "RWF", priceNote: null, usps: ["Genuine with 12-month warranty"], features: [], targetCustomer: null })) },
  mediaAsset: { findMany: vi.fn(async (): Promise<Record<string, unknown>[]> => []) },
  productPhoto: { findMany: vi.fn(async () => [{ asset: { path: "u1/gallery/a.jpg", width: 800, height: 1200, description: "the phone on a stand", kind: "photo", cutoutPath: null, cutoutBox: null } }]) },
  videoJob: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `vj${++store.next}`;
      store.jobs.set(id, { ...data, id, createdAt: new Date(), caption: "", hashtags: [], warnings: [], score: null, captionScore: null, error: null, spec: null, parentId: data.parentId ?? null });
      return { id };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const next = { ...store.jobs.get(where.id), ...data };
      store.jobs.set(where.id, next);
      return next;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string; refundedAt?: null }; data: Record<string, unknown> }) => {
      const cur = store.jobs.get(where.id);
      if (!cur || (where.status && cur.status !== where.status) || (where.refundedAt === null && cur.refundedAt)) return { count: 0 };
      store.jobs.set(where.id, { ...cur, ...data });
      return { count: 1 };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => store.jobs.get(where.id)!),
    findFirst: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
  },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {
    constructor(public reason: string) {
      super(reason);
    }
  }
  return { consumeUsage: vi.fn(async () => ({ periodStart: new Date("2026-10-01T00:00:00Z") })), refundUsage: vi.fn(async () => {}), UsageLimitError };
});
const ledger = vi.hoisted(() => ({ calls: [] as { feature: string; provider: string }[] }));
const switchState = vi.hoisted(() => ({ off: false }));
const photo = vi.hoisted(() => ({ bytes: new Uint8Array() }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/auth/require-user", () => ({ checkActiveUser: vi.fn(async () => ({ status: "ok", user: { id: "u1", actorId: "a1", role: "OWNER", businessId: "b1" } })) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/admin/switch", async (orig) => {
  const real = await orig<typeof import("@/lib/admin/switch")>();
  return { ...real, assertServiceEnabled: vi.fn(async (id: string) => { if (switchState.off) throw new real.ServiceDisabledError(id as "claude"); }) };
});
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: vi.fn(async (ctx: { feature: string }, meta: { provider: string }, call: () => Promise<unknown>) => {
    ledger.calls.push({ feature: ctx.feature, provider: meta.provider });
    return call();
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: (bucket: string) => ({ download: vi.fn(async (path: string) => (bucket === "media" && path === "u1/gallery/a.jpg" ? { data: new Blob([photo.bytes as BlobPart], { type: "image/png" }), error: null } : { data: null, error: new Error("not found") })) }) } }),
}));

import { sampleSpec } from "@/lib/video-engine/sample";
import { POST } from "@/app/api/video/design/route";
import * as stubs from "@/tests/stubs/entitlements";

const call = (body: unknown) => POST(new Request("https://x.test/api/video/design", { method: "POST", body: JSON.stringify(body) }));
const claudeAnswer = (status = 200) =>
  vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
    if (status !== 200) return new Response(JSON.stringify({ error: { type: "overloaded_error" } }), { status });
    const spec = sampleSpec({ business: "Nova Phones Kigali", product: "Samsung Galaxy A56", price: "420,000 RWF", photoCount: 1 });
    return new Response(JSON.stringify({ model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(spec) }], usage: { input_tokens: 9000, output_tokens: 4000 } }), { status: 200 });
  });

beforeEach(async () => {
  vi.clearAllMocks();
  store.jobs.clear();
  ledger.calls.length = 0;
  switchState.off = false;
  stubs.missing.clear();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  photo.bytes = new Uint8Array(await sharp({ create: { width: 64, height: 96, channels: 3, background: "#3366ff" } }).png().toBuffer());
});

describe("POST /api/video/design", () => {
  it("designs with the API key only, charges the credits first, saves the design, caption and scores", async () => {
    const fetchMock = claudeAnswer();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call({ productId: "p1", templateId: "product-hero", seconds: 15, platform: "tiktok", versions: 2 });
    expect(res.status).toBe(200);
    const { jobs } = (await res.json()) as { jobs: Job[] };
    expect(jobs).toHaveLength(2);
    // One reservation for both versions, before any job or call.
    expect(usage.consumeUsage).toHaveBeenCalledTimes(1);
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "videoCredits", 70);
    expect(prisma.videoJob.create.mock.invocationCallOrder[0]).toBeGreaterThan(usage.consumeUsage.mock.invocationCallOrder[0]);
    expect((prisma.videoJob.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data).toMatchObject({ businessId: "b1", userId: "a1", productId: "p1", engine: "motion", status: "designing", credits: 35, platform: "tiktok" });
    // The job keeps the brief without image bytes: the photo by its path.
    expect(JSON.stringify((prisma.videoJob.create.mock.calls[0] as unknown as [{ data: { brief: unknown } }])[0].data.brief)).toContain("u1/gallery/a.jpg");
    expect(JSON.stringify((prisma.videoJob.create.mock.calls[0] as unknown as [{ data: { brief: unknown } }])[0].data.brief)).not.toContain("base64");
    for (const j of jobs) {
      expect(j).toMatchObject({ status: "designed", engine: "motion", credits: 35 });
      expect((j.spec as { scenes: unknown[] }).scenes.length).toBeGreaterThan(1);
      expect(typeof j.caption).toBe("string");
      expect(j.score).toMatchObject({ score: expect.any(Number) });
      expect(j.captionScore).toMatchObject({ score: expect.any(Number) });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ledger.calls).toEqual([{ feature: "video-design", provider: "claude" }, { feature: "video-design", provider: "claude" }]);
    expect(usage.refundUsage).not.toHaveBeenCalled();
    // The lease outlasts the route's 300 s, so the sweep never takes a request that is still working.
    const lease = (prisma.videoJob.create.mock.calls[0] as unknown as [{ data: { leaseUntil: Date } }])[0].data.leaseUntil;
    expect(lease.getTime() - Date.now()).toBeGreaterThan(300_000);
  });

  it("a design the sweep already failed and refunded stays failed: finishing late refunds and charges nothing again", async () => {
    const fetchMock = vi.fn(async () => {
      // While Claude works, the sweep takes the job (its lease passed).
      for (const [id, j] of store.jobs) store.jobs.set(id, { ...j, status: "failed", refundedAt: new Date(), error: "swept" });
      return claudeAnswer()("https://api.anthropic.com/v1/messages", { headers: { "x-api-key": "sk-ant-test" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await call({ productId: "p1" });
    const out = (await res.json()) as { jobs: Job[] };
    expect(out.jobs[0]).toMatchObject({ status: "failed", error: "swept" });
    expect(usage.refundUsage).not.toHaveBeenCalled();
  });

  it("an opening line the owner picked reaches Claude in the research block", async () => {
    const fetchMock = claudeAnswer();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call({ productId: "p1", platform: "tiktok", hookId: "price-banner", chosenHook: { hookId: "price-banner", line: "Galaxy A56 at 420,000 RWF" } });
    expect(res.status).toBe(200);
    const sent = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(sent).toContain("Galaxy A56 at 420,000 RWF");
    expect(sent).toContain("RESEARCH");
  });

  it("503 in plain English without the Claude key, before charging anything", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await call({ productId: "p1" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "unavailable", message: expect.stringMatching(/not available right now/) });
    expect(usage.consumeUsage).not.toHaveBeenCalled();
    expect(prisma.videoJob.create).not.toHaveBeenCalled();
  });

  it("503 when Claude is switched off in Admin → Services, before charging anything", async () => {
    switchState.off = true;
    const res = await call({ productId: "p1" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "unavailable", message: "Video design is paused right now. Please try again later." });
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("a failed design gives its credits back and says why", async () => {
    vi.stubGlobal("fetch", claudeAnswer(529));
    const res = await call({ productId: "p1" });
    expect(res.status).toBe(502);
    const out = (await res.json()) as { jobs: Job[] };
    expect(out.jobs[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/Claude could not design the video \(529/) });
    expect(usage.refundUsage).toHaveBeenCalledWith("u1", "videoCredits", new Date("2026-10-01T00:00:00Z"), 35);
    expect(store.jobs.get(out.jobs[0].id)).toMatchObject({ refundedAt: expect.any(Date) });
  });

  it("402 when the month's video credits are used up: no job, no call", async () => {
    usage.consumeUsage.mockRejectedValueOnce(new usage.UsageLimitError("limit_reached"));
    vi.stubGlobal("fetch", claudeAnswer());
    const res = await call({ productId: "p1" });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "usage_blocked", reason: "limit_reached", message: "Your video credits for this month are used up." });
    expect(prisma.videoJob.create).not.toHaveBeenCalled();
  });

  it("refuses a plan without the Video Studio, photos that are not the company's, and an edit of an unknown video, before charging", async () => {
    stubs.missing.add("videoStudio");
    expect((await call({ productId: "p1" })).status).toBe(403);
    stubs.missing.clear();
    prisma.mediaAsset.findMany.mockResolvedValueOnce([{ path: "u1/gallery/a.jpg", kind: "photo", width: 1, height: 1, description: null, cutoutPath: null, cutoutBox: null }]);
    const bad = await call({ productId: "p1", photoPaths: ["u1/gallery/a.jpg", "someone-else/b.jpg"] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_photo" });
    expect((await call({ productId: "p1", mode: "edit" })).status).toBe(400);
    expect((await call({ productId: "p1", mode: "edit", parentId: "vj-missing" })).status).toBe(404);
    prisma.product.findFirst.mockResolvedValueOnce(null);
    expect((await call({ productId: "p-other" })).status).toBe(404);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("refuses a bad request and a signed-out caller", async () => {
    expect((await call({ productId: "p1", seconds: 99 })).status).toBe(400);
    const { checkActiveUser } = await import("@/lib/auth/require-user");
    vi.mocked(checkActiveUser).mockResolvedValueOnce({ status: "signed_out" });
    expect((await call({ productId: "p1" })).status).toBe(401);
  });
});
