import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Connecting Paddle from Admin -> Settings -> Card payments (lib/billing/paddle-config.ts, lib/billing/paddle-setup.ts):
// values stored encrypted and never shown again, the environment variables as the fallback, Test connection (read-only),
// Set up prices (plans, regional prices, webhook + its secret) and the status line. Paddle is a fake fetch here.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, sync: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
// The plan builder's own Paddle sync is tested with the plans; here only that each plan without prices is synced.
vi.mock("@/lib/admin/plans-service", () => ({ syncPlanToPaddle: h.sync }));

import { apiContext, consoleContext } from "@/lib/admin/types";
import { configState } from "@/lib/admin/services";
import { serviceInfo } from "@/lib/admin/service-catalog";
import { clearSwitchCache } from "@/lib/admin/switch";
import { paddle } from "@/lib/billing/paddle";
import { cardCheckoutConfigured } from "@/lib/billing/card-ready";
import { clearPaddleConfigCache, clearPaddleSettings, getPaddleConfig, PADDLE_SETTING_KEY, paddleValueProblem, savePaddleSettings } from "@/lib/billing/paddle-config";
import { PLANS_PER_STEP, paddleStatus, paddleStatusLine, REGION_PRICES_PER_STEP, setUpPaddle, setUpPaddleStep, testPaddleConnection } from "@/lib/billing/paddle-setup";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";

const CONSOLE = consoleContext("198.51.100.1");
const API = apiContext("key1", "203.0.113.5");
const KEY = "pdl_sdbx_apikey_01abcdefghijklmnopqrstuv_WXYZ";
const LIVE_KEY = "pdl_live_apikey_01abcdefghijklmnopqrstuv_LIVE";
const TOKEN = "test_0123456789abcdef9876";
const SECRET = "pdl_ntfset_01abcdefghijklmnop_SECR";
const ENV = ["PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_WEBHOOK_SECRET", "PADDLE_ENVIRONMENT", "PADDLE_PRICE_STANDARD_MONTH", "NEXT_PUBLIC_SITE_URL"] as const;
const saved: Record<string, string | undefined> = {};
const msg = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

/** A fake Paddle: records every call and answers by path. */
function fakePaddle(over: Record<string, (body: unknown) => unknown> = {}) {
  const calls: { url: string; method: string; auth: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/(sandbox-)?api\.paddle\.com/, "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method ?? "GET", auth: String((init.headers as Record<string, string>).Authorization), body });
    const key = `${init.method ?? "GET"} ${path.split("?")[0]}`;
    const data = over[key] ? over[key](body) : key === "GET /event-types" ? [{ name: "subscription.created" }] : key.startsWith("GET ") ? [] : { id: `${path.split("/")[1]}_new`, endpoint_secret_key: path.startsWith("/notification-settings") ? SECRET : undefined };
    return new Response(JSON.stringify(data instanceof Response ? null : { data }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  h.db = createFakeDb();
  h.sync.mockReset().mockResolvedValue({ created: ["product", "MONTH", "YEAR"] });
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.NEXT_PUBLIC_SITE_URL = "https://bupulse.com";
  clearPaddleConfigCache();
  clearSwitchCache();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("where the credentials come from", () => {
  it("nothing saved: the PADDLE_* environment variables, as before", async () => {
    process.env.PADDLE_API_KEY = "pdl_env_key_1234";
    process.env.PADDLE_ENVIRONMENT = "production";
    const c = await getPaddleConfig();
    expect(c).toMatchObject({ apiKey: "pdl_env_key_1234", environment: "production", clientToken: null, source: { apiKey: "env", clientToken: null, environment: "env" }, last4: { apiKey: "1234" } });
    expect(await paddle.isConfigured()).toBe(false);
  });

  it("a value saved in Settings wins over its variable; one not saved falls back to it; the environment goes with the saved key", async () => {
    process.env.PADDLE_API_KEY = "pdl_env_key_1234";
    process.env.PADDLE_WEBHOOK_SECRET = "env_secret_9999";
    process.env.PADDLE_ENVIRONMENT = "production";
    await savePaddleSettings(CONSOLE, { environment: "sandbox", apiKey: KEY, clientToken: TOKEN });
    const c = await getPaddleConfig();
    expect(c).toMatchObject({ apiKey: KEY, clientToken: TOKEN, webhookSecret: "env_secret_9999", environment: "sandbox", source: { apiKey: "settings", clientToken: "settings", webhookSecret: "env", environment: "settings" } });
    expect(await paddle.isConfigured()).toBe(true);
    // Card is offered to clients from these alone (no BILLING_PROVIDER, no PADDLE_CLIENT_TOKEN variable).
    expect(await cardCheckoutConfigured()).toBe(true);
    // And the Services page counts Paddle as configured.
    expect(configState(serviceInfo("paddle")!, { paddleSaved: true })).toBe("configured");
    expect(configState(serviceInfo("paddle")!, { paddleSaved: false })).toBe("missing");
  });
});

describe("saving", () => {
  it("is console only, checks each value against the environment, and refuses a sandbox key for live (and the reverse)", async () => {
    expect(await msg(savePaddleSettings(API, { apiKey: KEY }))).toMatch(/admin console only/);
    expect(await msg(savePaddleSettings(CONSOLE, { environment: "production", apiKey: KEY }))).toMatch(/sandbox API key, but the environment is live/);
    expect(await msg(savePaddleSettings(CONSOLE, { environment: "sandbox", apiKey: LIVE_KEY }))).toMatch(/live API key/);
    expect(await msg(savePaddleSettings(CONSOLE, { environment: "sandbox", clientToken: "live_0123456789abcdef" }))).toMatch(/live client-side token/);
    expect(await msg(savePaddleSettings(CONSOLE, { apiKey: "sk_live_stripe_key_123" }))).toMatch(/starts with pdl_/);
    expect(await msg(savePaddleSettings(CONSOLE, { apiKey: "pdl has spaces in it" }))).toMatch(/does not look right/);
    expect(paddleValueProblem("webhookSecret", SECRET, "production")).toBeNull();
    expect(h.db.adminSetting.rows).toHaveLength(0);
  });

  it("stores the values encrypted, never in clear, audits only the last 4 characters; an empty field keeps the saved value", async () => {
    const r = await savePaddleSettings(CONSOLE, { environment: "sandbox", apiKey: KEY, clientToken: TOKEN, webhookSecret: SECRET });
    expect(r).toEqual({ environment: "sandbox", changed: ["apiKey", "clientToken", "webhookSecret"] });
    const row = JSON.stringify(h.db.adminSetting.rows.find((x) => x.key === PADDLE_SETTING_KEY));
    for (const v of [KEY, TOKEN, SECRET]) expect(row).not.toContain(v);
    expect(row).toContain('"last4":"WXYZ"');
    const audit = h.db.auditLog.rows.find((a) => a.action === "set_paddle_settings");
    expect(audit).toMatchObject({ actor: "admin", target: "setting:billing.paddle", after: { environment: "sandbox", endings: { api: "WXYZ", client: "9876", webhook: "SECR" }, changed: ["api", "client", "webhook"] } });
    for (const v of [KEY, TOKEN, SECRET]) expect(JSON.stringify(h.db.auditLog.rows)).not.toContain(v);
    // Saving again with empty fields keeps everything (nothing to audit).
    expect(await savePaddleSettings(CONSOLE, { environment: "sandbox" })).toEqual({ environment: "sandbox", changed: [] });
    expect((await getPaddleConfig()).apiKey).toBe(KEY);
  });

  it("switching sandbox <-> live needs the other account's key and token, and drops the old webhook secret", async () => {
    await savePaddleSettings(CONSOLE, { environment: "sandbox", apiKey: KEY, clientToken: TOKEN, webhookSecret: SECRET });
    expect(await msg(savePaddleSettings(CONSOLE, { environment: "production", apiKey: LIVE_KEY }))).toMatch(/different Paddle accounts/);
    await savePaddleSettings(CONSOLE, { environment: "production", apiKey: LIVE_KEY, clientToken: "live_0123456789abcdef" });
    const c = await getPaddleConfig();
    expect(c).toMatchObject({ environment: "production", apiKey: LIVE_KEY, webhookSecret: null });
  });

  it("removing the saved values brings the environment variables back", async () => {
    process.env.PADDLE_API_KEY = "pdl_env_key_1234";
    await savePaddleSettings(CONSOLE, { apiKey: KEY });
    await clearPaddleSettings(CONSOLE);
    expect((await getPaddleConfig()).apiKey).toBe("pdl_env_key_1234");
    expect(h.db.auditLog.rows.some((a) => a.action === "clear_paddle_settings")).toBe(true);
  });
});

describe("calling Paddle with the saved key", () => {
  it("uses the saved key on the saved environment's API", async () => {
    await savePaddleSettings(CONSOLE, { environment: "sandbox", apiKey: KEY });
    const calls = fakePaddle();
    const r = await testPaddleConnection();
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/sandbox answered/) });
    expect(calls[0]).toMatchObject({ url: "https://sandbox-api.paddle.com/event-types", method: "GET", auth: `Bearer ${KEY}` });
  });

  it("Test connection with a key being typed is read-only and stores nothing; a refused key says so", async () => {
    const calls = fakePaddle();
    expect((await testPaddleConnection({ apiKey: LIVE_KEY, environment: "production" })).ok).toBe(true);
    expect(calls[0].url).toBe("https://api.paddle.com/event-types");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(h.db.adminSetting.rows).toHaveLength(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "authentication_failed", detail: "bad key" } }), { status: 401 })));
    expect(await testPaddleConnection({ apiKey: KEY, environment: "sandbox" })).toMatchObject({ ok: false, message: expect.stringMatching(/refused the key/) });
    expect(await testPaddleConnection()).toMatchObject({ ok: false, message: expect.stringMatching(/No API key yet/) });
  });
});

describe("Set up prices", () => {
  it("syncs the plans without prices, creates the Rwandan card prices, creates the webhook with every event and stores its secret", async () => {
    await savePaddleSettings(CONSOLE, { environment: "sandbox", apiKey: KEY, clientToken: TOKEN });
    h.db.planRegionPrice.rows.push({ id: "prp", planKey: "STANDARD", regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000, cardMonthlyUsdCents: 1200, cardYearlyUsdCents: 11600, paddleMonthlyPriceId: null, paddleYearlyPriceId: null });
    const calls = fakePaddle();
    const r = await setUpPaddle(CONSOLE);
    expect(r.problems).toEqual([]);
    expect(h.sync).toHaveBeenCalledWith(CONSOLE, "STANDARD");
    expect(r).toMatchObject({ regionPrices: 2, webhook: "created", secretStored: true });
    expect(h.db.planRegionPrice.rows[0]).toMatchObject({ paddleMonthlyPriceId: "prices_new", paddleYearlyPriceId: "prices_new" });
    const hook = calls.find((c) => c.method === "POST" && c.url.endsWith("/notification-settings"));
    expect(hook?.body).toMatchObject({ destination: "https://bupulse.com/api/billing/webhooks/paddle", type: "url" });
    expect((hook?.body as { subscribed_events: string[] }).subscribed_events).toEqual(expect.arrayContaining(["transaction.completed", "adjustment.created", "adjustment.updated", "subscription.created"]));
    // The secret is now saved (encrypted): card is configured without any environment variable.
    expect(await getPaddleConfig()).toMatchObject({ webhookSecret: SECRET, source: { webhookSecret: "settings" } });
    expect(await paddle.isConfigured()).toBe(true);
    expect(h.db.auditLog.rows.some((a) => a.action === "paddle_set_up")).toBe(true);
    expect(JSON.stringify(h.db.auditLog.rows)).not.toContain(SECRET);
  });

  it("runs in short steps that fit a request: a few plans or prices per call, `more` until done, a failing plan never retried in the run", async () => {
    await savePaddleSettings(CONSOLE, { environment: "sandbox", apiKey: KEY, clientToken: TOKEN });
    // Three extra plans without Paddle prices, the second one failing in Paddle.
    for (const key of ["EXTRA1", "EXTRA2", "EXTRA3"]) h.db.planDefinition.rows.push({ ...h.db.planDefinition.rows.find((p) => p.key === "STANDARD"), id: key, key, name: key, paddleProductId: null, paddleMonthlyPriceId: null, paddleYearlyPriceId: null });
    resetPlanCache();
    h.sync.mockImplementation(async (_ctx: unknown, key: string) => {
      if (key === "EXTRA2") throw new Error("Paddle said no");
      return { created: ["product"] };
    });
    let attempted: string[] = [];
    let calls = 0;
    const seen: string[] = [];
    for (;;) {
      const r = await setUpPaddleStep(CONSOLE, "plans", attempted);
      calls++;
      expect(r.attempted.length - attempted.length).toBeLessThanOrEqual(PLANS_PER_STEP);
      seen.push(...r.attempted.slice(attempted.length));
      attempted = r.attempted;
      if (!r.more) break;
    }
    expect(calls).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(seen.length); // nothing tried twice, the failing plan included
    expect(seen).toEqual(expect.arrayContaining(["EXTRA1", "EXTRA2", "EXTRA3"]));

    // Regional prices: 3 Rwandan plans x 2 intervals = 6 prices, REGION_PRICES_PER_STEP per call.
    for (const key of ["STANDARD", "PRO", "EXTRA1"]) h.db.planRegionPrice.rows.push({ id: `prp_${key}`, planKey: key, regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000, cardMonthlyUsdCents: 1200, cardYearlyUsdCents: 11600, paddleMonthlyPriceId: null, paddleYearlyPriceId: null });
    fakePaddle();
    const first = await setUpPaddleStep(CONSOLE, "regions");
    expect(first).toMatchObject({ more: true, problems: [] });
    expect(first.done).toHaveLength(REGION_PRICES_PER_STEP);
    const second = await setUpPaddleStep(CONSOLE, "regions");
    expect(second.done).toHaveLength(6 - REGION_PRICES_PER_STEP);
    expect(second.more).toBe(false);
    expect(h.db.planRegionPrice.rows.every((r) => r.paddleMonthlyPriceId && r.paddleYearlyPriceId)).toBe(true);
    expect(h.db.auditLog.rows.filter((a) => a.action === "paddle_set_up").length).toBe(calls + 2);
  });

  it("needs a saved API key, and is console only", async () => {
    expect(await msg(setUpPaddle(CONSOLE))).toMatch(/API key first/);
    expect(await msg(setUpPaddle(API))).toMatch(/admin console only/);
  });
});

describe("the status line", () => {
  const rw = (priced: number) => ({ key: "RW", name: "Rwanda", priced, total: 2 });
  it("says what is missing, or ready", () => {
    expect(paddleStatusLine({ missing: "client-side token, webhook secret", switchedOn: true, regions: [rw(2)] })).toEqual({ ready: false, line: "Card payments: not set up — missing client-side token, webhook secret." });
    expect(paddleStatusLine({ missing: null, switchedOn: false, regions: [rw(2)] }).line).toMatch(/switched off/);
    expect(paddleStatusLine({ missing: null, switchedOn: true, regions: [rw(0)] }).line).toMatch(/no plan has a Paddle price yet/);
    expect(paddleStatusLine({ missing: null, switchedOn: true, regions: [rw(1)] })).toMatchObject({ ready: true, line: expect.stringMatching(/not for every plan in Rwanda/) });
    expect(paddleStatusLine({ missing: null, switchedOn: true, regions: [rw(2)] })).toEqual({ ready: true, line: "Card payments: ready." });
  });

  it("from the real state: nothing set up", async () => {
    const s = await paddleStatus();
    expect(s.ready).toBe(false);
    expect(s.line).toMatch(/missing api key, client-side token, webhook secret/);
  });
});
