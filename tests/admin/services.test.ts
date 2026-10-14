import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, fetch: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle", () => ({ paddle: {}, paddleApi: vi.fn(async () => [1, 2, 3]) }));

import { effectiveBudgetUsd, assertWithinBudget, clearBudgetCache, AIBudgetExceededError } from "@/lib/ai/budget";
import { withLedger } from "@/lib/ai/ledger";
import { getAiBudgetStatus, monthBounds, projectMonthEnd, setAiBudget } from "@/lib/admin/ai-usage";
import { scrubSecrets } from "@/lib/admin/scrub";
import { NETWORK_SERVICE, SERVICES, SERVICE_IDS } from "@/lib/admin/service-catalog";
import { getServicesAttention, listServices, setServiceEnabled, testService } from "@/lib/admin/services";
import { clearSwitchCache, disabledNetworks, isServiceEnabled, ServiceDisabledError } from "@/lib/admin/switch";
import { AdminError, apiContext, consoleContext } from "@/lib/admin/types";
import { sendEmail } from "@/lib/publishing/email";

const API = apiContext("key1", "203.0.113.5", "all");
const CONSOLE = consoleContext("198.51.100.1");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);
const audit = () => h.db.auditLog.rows;
const lastAudit = () => audit()[audit().length - 1];

const SECRETS: Record<string, string> = {
  GEMINI_API_KEY: "AIzaSyFAKE-gemini-secret-value-0001",
  RESEND_API_KEY: "re_FAKEresendSecretValue0002",
  PADDLE_API_KEY: "pdl_FAKEpaddleSecret0003",
  PADDLE_WEBHOOK_SECRET: "pdl_ntfset_FAKEwebhook0004",
  SUPABASE_SECRET_KEY: "sb_secret_FAKE0005supabase",
  FACEBOOK_APP_SECRET: "fbsecretFAKE0006abcdef",
  TIKTOK_CLIENT_SECRET: "tiktokSECRETfake0007",
  DATABASE_URL: "postgresql://postgres:SuperSecretPw0008@db.example.com:5432/postgres",
};

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  clearSwitchCache();
  clearBudgetCache();
  for (const [k, v] of Object.entries(SECRETS)) process.env[k] = v;
  h.fetch.mockReset();
  vi.stubGlobal("fetch", h.fetch);
  delete process.env.AI_MONTHLY_BUDGET_USD;
});

describe("service registry", () => {
  it("covers every service the code uses and the networks map to services", () => {
    expect(SERVICES.map((s) => s.id).sort()).toEqual([...SERVICE_IDS].sort());
    for (const id of Object.values(NETWORK_SERVICE)) expect(SERVICE_IDS).toContain(id);
    const names = SERVICES.flatMap((s) => s.env);
    expect(names).toEqual(expect.arrayContaining(["GEMINI_API_KEY", "RESEND_API_KEY", "PADDLE_API_KEY", "FACEBOOK_APP_ID", "LINKEDIN_CLIENT_ID", "TIKTOK_CLIENT_KEY", "GOOGLE_YOUTUBE_CLIENT_ID", "CANVA_CLIENT_ID", "DROPBOX_APP_KEY", "SHOPIFY_API_KEY", "TURNSTILE_SECRET_KEY"]));
  });

  it("reports env vars as set/missing and never contains a secret value", async () => {
    h.db.errorLog.rows.push({ id: "e1", createdAt: new Date(), source: "billing.webhook", message: `boom using ${SECRETS.PADDLE_API_KEY} and Bearer abcdefghijkl123456` });
    h.db.serviceCheck.rows.push({ service: "resend", ok: false, latencyMs: 5, message: "Resend returned 401.", checkedAt: new Date() });
    const views = await listServices();
    const gemini = views.find((v) => v.id === "gemini")!;
    expect(gemini.env).toEqual([{ name: "GEMINI_API_KEY", set: true }]);
    expect(gemini.configured).toBe("configured");
    delete process.env.TIKTOK_CLIENT_KEY;
    const tiktok = (await listServices()).find((v) => v.id === "tiktok")!;
    expect(tiktok.configured).toBe("missing");
    expect(tiktok.env.find((e) => e.name === "TIKTOK_CLIENT_KEY")?.set).toBe(false);
    const dump = JSON.stringify(await listServices());
    for (const secret of Object.values(SECRETS)) expect(dump).not.toContain(secret);
    expect(dump).not.toContain("SuperSecretPw0008");
    expect(dump).not.toContain("abcdefghijkl123456");
    const paddle = views.find((v) => v.id === "paddle")!;
    expect(paddle.lastError?.message).toContain("[redacted]");
    expect(views.find((v) => v.id === "resend")!.health).toBe("down");
    expect(views.find((v) => v.id === "claude")!.configured).toBe("not_in_use");
  });

  it("scrubSecrets removes env secrets, bearer tokens, key shapes and secrets in URLs", () => {
    const dirty = `fail ${SECRETS.GEMINI_API_KEY} Authorization: Bearer abc.def-ghi_jkl123 url=https://x.test/a?key=AIzaSyABCDEFGHIJKLMNOPQRSTUV&access_token=zzzz1234 ${SECRETS.DATABASE_URL}`;
    const clean = scrubSecrets(dirty);
    for (const bad of [SECRETS.GEMINI_API_KEY, "abc.def-ghi_jkl123", "AIzaSyABCDEFGHIJKLMNOPQRSTUV", "zzzz1234", "SuperSecretPw0008"]) expect(clean).not.toContain(bad);
    expect(scrubSecrets("x".repeat(500), 50).length).toBeLessThanOrEqual(51);
  });
});

describe("Test now", () => {
  it("stores a result for a working service, with latency, and audits it", async () => {
    h.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const out = await testService(CONSOLE, "gemini");
    expect(out).toMatchObject({ service: "gemini", ok: true });
    expect(h.fetch.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
    expect((h.fetch.mock.calls[0][1] as { headers: Record<string, string> }).headers["x-goog-api-key"]).toBe(SECRETS.GEMINI_API_KEY);
    expect(h.db.serviceCheck.rows[0]).toMatchObject({ service: "gemini", ok: true });
    expect(lastAudit()).toMatchObject({ action: "test_service", target: "service:gemini" });
  });

  it("a failure message that contains a secret is scrubbed everywhere it is stored", async () => {
    h.fetch.mockRejectedValue(new Error(`request to https://api.resend.com/domains?key=${SECRETS.RESEND_API_KEY} failed, Bearer ${SECRETS.RESEND_API_KEY}`));
    const out = await testService(CONSOLE, "resend");
    expect(out.ok).toBe(false);
    const stored = JSON.stringify([h.db.serviceCheck.rows, audit(), out]);
    expect(stored).not.toContain(SECRETS.RESEND_API_KEY);
    expect(out.message).toContain("[redacted]");
  });

  it("reports missing keys without calling the provider", async () => {
    delete process.env.LINKEDIN_CLIENT_ID;
    const out = await testService(CONSOLE, "linkedin");
    expect(out).toMatchObject({ ok: false });
    expect(out.message).toMatch(/LINKEDIN_CLIENT_ID/);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("OAuth-only services check configuration only, and unknown ids are not_found", async () => {
    process.env.LINKEDIN_CLIENT_ID = "id";
    process.env.LINKEDIN_CLIENT_SECRET = "linkedinsecretvalue";
    expect((await testService(CONSOLE, "linkedin")).ok).toBe(true);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(await code(testService(CONSOLE, "nope"))).toBe("not_found");
  });
});

describe("kill switch", () => {
  it("setServiceEnabled audits before/after, needs confirm and a reason from the API, and refuses core services", async () => {
    expect(await code(setServiceEnabled(API, { service: "gemini", enabled: false, reason: "cost spike" }))).toBe("confirm_required");
    expect(await code(setServiceEnabled(API, { service: "gemini", enabled: false, confirm: true }))).toBe("invalid");
    expect(h.db.serviceSwitch.rows).toHaveLength(0);
    const out = await setServiceEnabled(API, { service: "gemini", enabled: false, reason: "cost spike", confirm: true });
    expect(out).toMatchObject({ service: "gemini", enabled: false, changed: true });
    expect(lastAudit()).toMatchObject({ actor: "jarvis:key1", action: "set_service_enabled", target: "service:gemini", before: { enabled: true, reason: null }, after: { enabled: false, reason: "cost spike" } });
    expect(await isServiceEnabled("gemini")).toBe(false);
    // on needs no confirm
    await setServiceEnabled(API, { service: "gemini", enabled: true });
    expect(lastAudit()).toMatchObject({ before: { enabled: false, reason: "cost spike" }, after: { enabled: true, reason: null } });
    expect(await isServiceEnabled("gemini")).toBe(true);
    expect(await code(setServiceEnabled(CONSOLE, { service: "supabase", enabled: false, reason: "no" }))).toBe("forbidden");
    expect(await code(setServiceEnabled(CONSOLE, { service: "turnstile", enabled: false, reason: "no" }))).toBe("forbidden");
    expect(await code(setServiceEnabled(CONSOLE, { service: "bogus", enabled: false, reason: "no" }))).toBe("not_found");
  });

  it("WhatsApp is off until switched on: no row means off, the admin turns it on, and it is not an 'off' reminder until then", async () => {
    expect(await isServiceEnabled("whatsapp")).toBe(false);
    expect(await isServiceEnabled("resend")).toBe(true);
    const view = (await listServices()).find((v) => v.id === "whatsapp")!;
    expect(view).toMatchObject({ enabled: false, health: "off", configured: "missing", killable: true });
    expect(view.env.map((e) => e.name)).toEqual(["WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]);
    expect((await getServicesAttention()).off.map((o) => o.key)).not.toContain("whatsapp");

    const on = await setServiceEnabled(CONSOLE, { service: "whatsapp", enabled: true });
    expect(on).toMatchObject({ enabled: true, changed: true });
    expect(lastAudit()).toMatchObject({ before: { enabled: false }, after: { enabled: true } });
    expect(await isServiceEnabled("whatsapp")).toBe(true);
    expect((await listServices()).find((v) => v.id === "whatsapp")!.enabled).toBe(true);

    await setServiceEnabled(CONSOLE, { service: "whatsapp", enabled: false, reason: "pause the cost" });
    expect(await isServiceEnabled("whatsapp")).toBe(false);
  });

  it("a read failure keeps features on when nothing was ever read, keeps the last good answer otherwise, and does not hammer the database", async () => {
    // never read successfully in this isolate: fail open, and do not ask again until the interval has passed
    h.db.serviceSwitch.findMany.mockRejectedValue(new Error("db down"));
    expect(await isServiceEnabled("resend")).toBe(true);
    expect(await isServiceEnabled("resend")).toBe(true);
    expect(h.db.serviceSwitch.findMany).toHaveBeenCalledTimes(1);
    // a good read, then an outage after the cache goes stale: the last good answer stays
    h.db.serviceSwitch.findMany.mockReset();
    await setServiceEnabled(CONSOLE, { service: "resend", enabled: false, reason: "test" });
    expect(await isServiceEnabled("resend")).toBe(false);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 30_000);
    h.db.serviceSwitch.findMany.mockRejectedValue(new Error("db down"));
    expect(await isServiceEnabled("resend")).toBe(false);
    vi.useRealTimers();
  });

  it("maps switched-off services to networks", async () => {
    await setServiceEnabled(CONSOLE, { service: "meta", enabled: false, reason: "app review" });
    await setServiceEnabled(CONSOLE, { service: "tiktok", enabled: false, reason: "outage" });
    expect((await disabledNetworks()).sort()).toEqual(["facebook", "instagram", "tiktok"]);
  });

  it("AI calls are refused before the provider is called and are not recorded as calls", async () => {
    await setServiceEnabled(CONSOLE, { service: "gemini", enabled: false, reason: "test" });
    const call = vi.fn();
    const err = (await withLedger({ feature: "content" }, { provider: "gemini", model: "m" }, call as never, (() => ({})) as never).catch((e) => e)) as ServiceDisabledError;
    expect(err).toBeInstanceOf(ServiceDisabledError);
    expect(err.message).toMatch(/temporarily unavailable/i);
    expect(call).not.toHaveBeenCalled();
    expect(h.db.aiCall.rows).toHaveLength(0);
    // another provider is unaffected
    await expect(withLedger({ feature: "content" }, { provider: "claude", model: "m" }, async () => "ok", () => ({ provider: "claude", model: "m", usage: { inputTokens: 1, outputTokens: 1 } }))).resolves.toBe("ok");
  });

  it("emails are skipped (false, no request) while Resend is off and sent when it is on", async () => {
    process.env.RESEND_API_KEY = "re_FAKEresendSecretValue0002";
    h.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const mail = { to: "a@b.test", subject: "s", html: "<p>x</p>", text: "x" };
    await setServiceEnabled(CONSOLE, { service: "resend", enabled: false, reason: "quota" });
    expect(await sendEmail(mail)).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
    await setServiceEnabled(CONSOLE, { service: "resend", enabled: true });
    expect(await sendEmail(mail)).toBe(true);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("AI budget", () => {
  it("projects the month end and handles month bounds (Kigali months)", () => {
    const b = monthBounds("2026-10", new Date("2026-10-10T22:00:00Z"));
    expect(b).toMatchObject({ month: "2026-10", days: 31, current: true });
    expect(projectMonthEnd(10, b, new Date("2026-10-10T22:00:00Z"))).toBeCloseTo(31, 5); // $10 in 10 days
    expect(projectMonthEnd(0, b, new Date("2026-10-10T22:00:00Z"))).toBe(0);
    const past = monthBounds("2026-09", new Date("2026-10-10T22:00:00Z"));
    expect(past.current).toBe(false);
    expect(projectMonthEnd(12.5, past, new Date("2026-10-10T22:00:00Z"))).toBe(12.5);
    expect(monthBounds("garbage", new Date("2026-10-10T22:00:00Z")).month).toBe("2026-10");
  });

  it("setAiBudget validates, needs confirm from the API, audits before/after and takes effect", async () => {
    expect(await effectiveBudgetUsd()).toBe(20);
    expect(await code(setAiBudget(API, { monthlyUsd: 40 }))).toBe("confirm_required");
    for (const bad of [0, 0.5, 5000, Number.NaN]) expect(await code(setAiBudget(CONSOLE, { monthlyUsd: bad }))).toBe("invalid");
    const out = await setAiBudget(API, { monthlyUsd: 35, confirm: true });
    expect(out).toEqual({ monthlyUsd: 35, source: "admin" });
    expect(lastAudit()).toMatchObject({ actor: "jarvis:key1", action: "set_ai_budget", target: "setting:ai.monthlyBudgetUsd", before: { monthlyUsd: 20, source: "default" }, after: { monthlyUsd: 35, source: "admin" } });
    expect(await effectiveBudgetUsd()).toBe(35);
    const back = await setAiBudget(CONSOLE, { monthlyUsd: null });
    expect(back.source).toBe("default");
    expect(await effectiveBudgetUsd()).toBe(20);
  });

  it("assertWithinBudget follows the admin cap: lowered pauses AI, raised resumes it", async () => {
    h.db.aiCall.rows.push({ id: "c1", createdAt: new Date(), costUsd: 15 });
    await expect(assertWithinBudget("gemini")).resolves.toBeUndefined(); // $15 of $20
    await setAiBudget(CONSOLE, { monthlyUsd: 10 });
    await expect(assertWithinBudget("gemini")).rejects.toBeInstanceOf(AIBudgetExceededError);
    await setAiBudget(CONSOLE, { monthlyUsd: 30 });
    await expect(assertWithinBudget("gemini")).resolves.toBeUndefined();
  });

  it("keeps the last good cap through a database error", async () => {
    await setAiBudget(CONSOLE, { monthlyUsd: 50 });
    clearBudgetCache();
    expect(await effectiveBudgetUsd()).toBe(50);
    h.db.adminSetting.findUnique.mockRejectedValueOnce(new Error("db down"));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    expect(await effectiveBudgetUsd()).toBe(50);
    vi.useRealTimers();
  });
});

describe("overview hooks", () => {
  it("getServicesAttention lists enabled services that are missing keys or failed their last test, and what is off", async () => {
    delete process.env.LINKEDIN_CLIENT_ID;
    process.env.TIKTOK_CLIENT_KEY = "tk";
    h.db.serviceCheck.rows.push({ service: "resend", ok: false, latencyMs: 9, message: "Resend returned 401.", checkedAt: new Date() }, { service: "gemini", ok: true, latencyMs: 9, message: "ok", checkedAt: new Date() });
    await setServiceEnabled(CONSOLE, { service: "canva", enabled: false, reason: "app review" });
    const out = await getServicesAttention();
    // An optional integration without keys is "not set up", not failing: it stays off the Overview.
    expect(out.failing.map((f) => f.key)).not.toContain("linkedin");
    expect(out.failing.find((f) => f.key === "resend")!.reason).toMatch(/Last test failed: Resend returned 401/);
    expect(out.failing.map((f) => f.key)).not.toContain("gemini");
    expect(out.failing.map((f) => f.key)).not.toContain("claude"); // not in use
    expect(out.off).toEqual([{ key: "canva", label: "Canva", reason: "Switched off: app review" }]);
    expect(JSON.stringify(out)).not.toContain(SECRETS.GEMINI_API_KEY);
  });

  it("lists a core service without its keys as failing, and Turnstile only in production", async () => {
    const saved = { resend: process.env.RESEND_API_KEY, t1: process.env.TURNSTILE_SITE_KEY, env: process.env.NODE_ENV };
    delete process.env.RESEND_API_KEY;
    delete process.env.TURNSTILE_SITE_KEY;
    try {
      let out = await getServicesAttention();
      expect(out.failing.find((f) => f.key === "resend")?.reason).toMatch(/Missing keys: RESEND_API_KEY/);
      expect(out.failing.map((f) => f.key)).not.toContain("turnstile");
      (process.env as Record<string, string>).NODE_ENV = "production";
      out = await getServicesAttention();
      expect(out.failing.find((f) => f.key === "turnstile")?.reason).toMatch(/TURNSTILE_SITE_KEY/);
      const views = await listServices();
      expect(views.find((v) => v.id === "turnstile")!.health).toBe("missing");
      (process.env as Record<string, string>).NODE_ENV = "test";
      const linkedin = (await listServices()).find((v) => v.id === "linkedin")!;
      if (linkedin.configured === "missing") expect(linkedin.health).toBe("not_connected");
    } finally {
      if (saved.resend) process.env.RESEND_API_KEY = saved.resend;
      if (saved.t1) process.env.TURNSTILE_SITE_KEY = saved.t1;
      (process.env as Record<string, string | undefined>).NODE_ENV = saved.env;
    }
  });

  it("getAiBudgetStatus reports month-to-date and the cap in cents", async () => {
    h.db.aiCall.rows.push({ id: "c1", createdAt: new Date(), costUsd: 5 });
    expect(await getAiBudgetStatus()).toEqual({ spentCents: 500, capCents: 2000, pct: 25, paused: false });
    await setAiBudget(CONSOLE, { monthlyUsd: 5 });
    expect(await getAiBudgetStatus()).toMatchObject({ pct: 100, paused: true });
  });
});
