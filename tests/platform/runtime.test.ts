import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cf = vi.hoisted(() => ({ context: null as null | { env: Record<string, unknown>; ctx: { waitUntil: (p: Promise<unknown>) => void } } }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!cf.context) throw new Error("not on Cloudflare");
    return cf.context;
  },
}));

import { waitUntil } from "@/lib/platform/background";
import { sharedCache } from "@/lib/platform/cache";
import { poolMax, requestDatabase } from "@/lib/platform/database";
import { hasShortRequestLimit, timeBudget } from "@/lib/platform/limits";

const NEXT_REQUEST_CONTEXT = Symbol.for("@next/request-context");
const g = globalThis as Record<symbol, unknown>;

beforeEach(() => {
  cf.context = null;
});

afterEach(() => {
  delete g[NEXT_REQUEST_CONTEXT];
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("waitUntil", () => {
  it("Cloudflare: hands the promise to ctx.waitUntil", () => {
    const wait = vi.fn();
    cf.context = { env: {}, ctx: { waitUntil: wait } };
    const p = Promise.resolve(1);
    expect(waitUntil(p, "cloudflare")).toBe(true);
    expect(wait).toHaveBeenCalledWith(p);
  });

  it("Netlify: uses the request context Netlify's Next.js runtime installs", () => {
    const wait = vi.fn();
    g[NEXT_REQUEST_CONTEXT] = { get: () => ({ waitUntil: wait }) };
    const p = Promise.resolve(1);
    expect(waitUntil(p, "netlify")).toBe(true);
    expect(wait).toHaveBeenCalledWith(p);
  });

  it("Netlify: falls back to Netlify.context.waitUntil (plain Netlify Functions)", () => {
    const context = { waitUntil: vi.fn() };
    vi.stubGlobal("Netlify", { context });
    const p = Promise.resolve(1);
    expect(waitUntil(p, "netlify")).toBe(true);
    expect(context.waitUntil).toHaveBeenCalledWith(p);
  });

  it("Netlify ignores Cloudflare's context, and Cloudflare ignores Netlify's", () => {
    const cfWait = vi.fn();
    const nfWait = vi.fn();
    cf.context = { env: {}, ctx: { waitUntil: cfWait } };
    g[NEXT_REQUEST_CONTEXT] = { get: () => ({ waitUntil: nfWait }) };
    waitUntil(Promise.resolve(), "netlify");
    waitUntil(Promise.resolve(), "cloudflare");
    expect(nfWait).toHaveBeenCalledTimes(1);
    expect(cfWait).toHaveBeenCalledTimes(1);
  });

  it("without a request context the promise just keeps running (false), and nothing throws", async () => {
    let done = false;
    const p = new Promise<void>((resolve) => setTimeout(() => ((done = true), resolve()), 5));
    expect(waitUntil(p, "node")).toBe(false);
    expect(waitUntil(p, "netlify")).toBe(false);
    g[NEXT_REQUEST_CONTEXT] = { get: () => undefined };
    expect(waitUntil(p, "netlify")).toBe(false);
    await p;
    expect(done).toBe(true);
  });

  it("plain Node tries Cloudflare (next dev with OpenNext) and then Netlify", () => {
    const nfWait = vi.fn();
    g[NEXT_REQUEST_CONTEXT] = { get: () => ({ waitUntil: nfWait }) };
    expect(waitUntil(Promise.resolve(), "node")).toBe(true);
    expect(nfWait).toHaveBeenCalledTimes(1);
  });

  it("a host's waitUntil that throws is reported as not taken", () => {
    g[NEXT_REQUEST_CONTEXT] = { get: () => ({ waitUntil: () => { throw new Error("closed"); } }) };
    expect(waitUntil(Promise.resolve(), "netlify")).toBe(false);
  });

  it("the app's runInBackground and trackEvent go through it", async () => {
    vi.doMock("@/lib/db", () => ({ prisma: { analyticsEvent: { create: vi.fn(async () => ({})) } } }));
    const wait = vi.fn();
    g[NEXT_REQUEST_CONTEXT] = { get: () => ({ waitUntil: wait }) };
    vi.stubEnv("PLATFORM", "netlify");
    const { runInBackground } = await import("@/lib/leads/background");
    const { trackEvent } = await import("@/lib/analytics/events");
    runInBackground(async () => {}, "test");
    trackEvent("signup");
    expect(wait).toHaveBeenCalledTimes(2);
    vi.doUnmock("@/lib/db");
  });
});

describe("shared cache", () => {
  it("Cloudflare: caches.default", async () => {
    const def = { match: vi.fn() } as unknown as Cache;
    vi.stubGlobal("caches", { default: def, open: vi.fn() });
    expect(await sharedCache("cloudflare")).toBe(def);
  });

  it("Netlify: caches.open('bupulse')", async () => {
    const named = { match: vi.fn() } as unknown as Cache;
    const open = vi.fn(async () => named);
    vi.stubGlobal("caches", { open });
    expect(await sharedCache("netlify")).toBe(named);
    expect(open).toHaveBeenCalledWith("bupulse");
  });

  it("absent in plain Node, and when opening fails", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await sharedCache("node")).toBeUndefined();
    expect(await sharedCache("netlify")).toBeUndefined();
    vi.stubGlobal("caches", { open: vi.fn(async () => { throw new Error("outside handler"); }) });
    expect(await sharedCache("netlify")).toBeUndefined();
  });
});

describe("database connection", () => {
  it("Cloudflare: Hyperdrive, scoped to the request", () => {
    const ctx = { waitUntil: vi.fn() };
    cf.context = { env: { HYPERDRIVE: { connectionString: "postgres://hyperdrive" } }, ctx };
    expect(requestDatabase("cloudflare")).toEqual({ connectionString: "postgres://hyperdrive", scope: ctx });
    expect(requestDatabase("node")).toEqual({ connectionString: "postgres://hyperdrive", scope: ctx });
  });

  it("Netlify never uses Hyperdrive (DATABASE_URL, pooled)", () => {
    cf.context = { env: { HYPERDRIVE: { connectionString: "postgres://hyperdrive" } }, ctx: { waitUntil: vi.fn() } };
    expect(requestDatabase("netlify")).toBeUndefined();
  });

  it("no binding or no Cloudflare context: DATABASE_URL", () => {
    expect(requestDatabase("cloudflare")).toBeUndefined();
    cf.context = { env: {}, ctx: { waitUntil: vi.fn() } };
    expect(requestDatabase("cloudflare")).toBeUndefined();
  });

  it("keeps the pool small on Netlify; DATABASE_POOL_MAX overrides within 1..20", () => {
    expect(poolMax("netlify")).toBe(3);
    expect(poolMax("cloudflare")).toBeUndefined();
    vi.stubEnv("DATABASE_POOL_MAX", "5");
    expect(poolMax("netlify")).toBe(5);
    expect(poolMax("node")).toBe(5);
    vi.stubEnv("DATABASE_POOL_MAX", "500");
    expect(poolMax("netlify")).toBe(3);
  });
});

describe("time limits", () => {
  it("cuts budgets on Netlify only", () => {
    expect(timeBudget(45_000, 15_000, "netlify")).toBe(15_000);
    expect(timeBudget(10_000, 15_000, "netlify")).toBe(10_000);
    expect(timeBudget(45_000, 15_000, "cloudflare")).toBe(45_000);
    expect(timeBudget(45_000, 15_000, "node")).toBe(45_000);
    expect(hasShortRequestLimit("netlify")).toBe(true);
    expect(hasShortRequestLimit("cloudflare")).toBe(false);
  });
});
