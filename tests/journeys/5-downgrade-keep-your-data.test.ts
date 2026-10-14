import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";
import { authUser, companyOf, DAY, installSignUp, seedCatalog } from "./world";

// Journey 5: a Business client on Mobile Money moves down to Starter. The features Starter lacks stop working
// (entitlements are the real lookup against the in-memory database); the "keep your data" actions stay open: switch a
// webhook off and delete it, revoke an API key, export leads. Nothing is deleted by the downgrade itself.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: { id: "", actorId: "", businessId: "", role: "OWNER", email: "owner1@example.com" },
  sendEmail: vi.fn(async () => true),
  hooks: { createEndpoint: vi.fn(async () => ({ endpoint: { id: "e2" }, secret: "whsec_x" })), updateEndpoint: vi.fn(async () => {}), setEndpointEnabled: vi.fn(async () => {}), deleteEndpoint: vi.fn(async () => {}) },
  keys: { createApiKey: vi.fn(async () => ({ key: "bp_live_x" })), revokeApiKey: vi.fn(async () => {}) },
  leads: { setLeadStatus: vi.fn(async () => 1), deleteLeads: vi.fn(async () => 1), getLeadDetail: vi.fn(async () => ({ id: "l1", session: null })) },
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: {}, trackEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: vi.fn(async () => h.user), checkActiveUser: vi.fn(async () => ({ status: "ok", user: h.user })) }));
vi.mock("@/lib/webhooks/endpoints", async (orig) => ({ ...(await orig<typeof import("@/lib/webhooks/endpoints")>()), ...h.hooks }));
vi.mock("@/lib/api/keys", async (orig) => ({ ...(await orig<typeof import("@/lib/api/keys")>()), ...h.keys }));
vi.mock("@/lib/api/auth", () => ({ businessHasApiAccess: vi.fn(async () => true) }));
vi.mock("@/lib/leads/service", async (orig) => ({ ...(await orig<typeof import("@/lib/leads/service")>()), ...h.leads }));
vi.mock("@/lib/leads/settings", () => ({ saveEmailToggles: vi.fn() }));

import { ensureAccount } from "@/lib/account";
import { assertFeature, companyEntitlements, featureBlocked, hasFeature, notInPlanMessage } from "@/lib/entitlements";
import { consumeUsage } from "@/lib/usage";
import { GET as leadsExport } from "@/app/api/leads/export/route";
import { createKey, revokeKey } from "@/app/dashboard/connectors/api/actions";
import { createWebhook, deleteWebhook, toggleWebhook, updateWebhook } from "@/app/dashboard/connectors/webhooks/actions";
import { changeStatus, loadLead, removeLeads } from "@/app/dashboard/leads/actions";
import { confirmManualPayment, startManualPayment, submitManualProof } from "@/lib/billing/momo";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const AT = new Date("2026-10-20T10:00:00Z");

/** An active Business client on Mobile Money, 12 days into a 30-day period, with a lead and 100 texts used. */
async function businessClient() {
  await ensureAccount(authUser(1, "Rwanda") as never);
  const c = companyOf(h.db, 1);
  Object.assign(c.subscription, { status: "ACTIVE", plan: "BUSINESS", chosenPlan: "BUSINESS", provider: "MANUAL_MOMO", interval: "MONTH", trialEndsAt: null, currentPeriodStart: new Date(AT.getTime() - 12 * DAY), currentPeriodEnd: new Date(AT.getTime() + 18 * DAY) });
  Object.assign(h.user, { id: c.userId, actorId: c.userId, businessId: c.businessId });
  h.db.lead.rows.push({ id: "l1", businessId: c.businessId, name: "Jean", email: "jean@example.com", status: "NEW", createdAt: AT });
  h.db.usageRecord.rows.push({ userId: c.userId, periodStart: c.subscription.currentPeriodStart, textGenerations: 100, imageGenerations: 0, videos: 0, voiceCharacters: 0, chatMessages: 0 });
  return c;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AT);
  h.db = createFakeDb();
  installSignUp(h.db);
  vi.clearAllMocks();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
  seedCatalog(h.db);
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse" } });
  clearMomoSettingsCache();
  vi.stubEnv("ADMIN_EMAILS", "owner@bupulse.com");
  vi.stubEnv("RESEND_API_KEY", "re_test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("journey: Business -> Starter, keep your data", () => {
  it("gated features stop, the clean-up and export actions stay open, and nothing is deleted", async () => {
    const c = await businessClient();
    const { businessId, userId, subscription } = c;
    const NO_HOOKS = notInPlanMessage("webhooks");
    const NO_API = notInPlanMessage("apiAccess");
    const NO_CHAT = notInPlanMessage("websiteChat");

    // On Business everything works.
    for (const feature of ["websiteChat", "webhooks", "apiAccess", "analytics"] as const) expect(await hasFeature(businessId, feature)).toBe(true);
    expect(await createWebhook({ url: "https://hooks.example.com/bp", events: ["lead.created"] })).toMatchObject({ ok: true });
    expect(await createKey({ name: "Zapier", scopes: ["leads:read"] })).toMatchObject({ ok: true });
    expect(await changeStatus(["l1"], "WON")).toEqual({ ok: true, changed: 1 });
    for (const fn of Object.values(h.hooks).concat(Object.values(h.keys) as never, Object.values(h.leads) as never)) (fn as ReturnType<typeof vi.fn>).mockClear();

    // The downgrade: the client pays for Starter by Mobile Money and the owner confirms it. A different plan replaces the
    // running one from today.
    const payment = await startManualPayment({ userId, plan: "STARTER", interval: "MONTH", now: AT });
    expect(payment).toMatchObject({ planKey: "STARTER", amountMinor: 15000, currency: "RWF" });
    expect(payment.periodNote).toMatchObject({ mode: "replace", daysLeft: 18 });
    await submitManualProof(userId, { paymentId: payment.id, transactionId: "MP3300110022", payerPhone: "0781234567", network: "MTN" }, AT);
    expect(await confirmManualPayment(CONSOLE, payment.id, AT)).toMatchObject({ periodMode: "replace" });
    expect(subscription).toMatchObject({ status: "ACTIVE", plan: "STARTER", provider: "MANUAL_MOMO" });
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "confirm_momo_payment", before: { subscription: expect.objectContaining({ plan: "BUSINESS" }) }, after: expect.objectContaining({ period: "replace", subscription: expect.objectContaining({ plan: "STARTER" }) }) });

    // The account itself is not blocked: it is just a smaller plan.
    const e = await companyEntitlements(businessId);
    expect(e.block).toBeNull();
    expect([...e.usable].sort()).toEqual(["calendar", "content", "designs", "gallery"]);
    for (const feature of ["websiteChat", "webhooks", "apiAccess", "analytics"] as const) {
      expect(await hasFeature(businessId, feature)).toBe(false);
      expect(await assertFeature(businessId, feature).catch((x) => x.message)).toBe(notInPlanMessage(feature));
    }
    expect(await featureBlocked(businessId, "content")).toBeNull();

    // A replaced plan starts a fresh period, so the usage count starts again; Starter's allowance (60 texts, not
    // Business's 200) is what applies to new work. The old period's record is kept.
    expect(subscription.currentPeriodStart).toEqual(AT);
    await consumeUsage(userId, "text");
    h.db.usageRecord.rows[1].textGenerations = 60;
    await expect(consumeUsage(userId, "text")).rejects.toMatchObject({ reason: "limit_reached" });
    expect(h.db.usageRecord.rows[0].textGenerations).toBe(100);

    // Gated: creating, editing and switching ON are refused in words, and nothing is written.
    expect(await createWebhook({ url: "https://hooks.example.com/bp2", events: ["lead.created"] })).toEqual({ ok: false, error: NO_HOOKS });
    expect(await updateWebhook("e1", { url: "https://hooks.example.com/new", events: ["lead.created"] })).toEqual({ ok: false, error: NO_HOOKS });
    expect(await toggleWebhook("e1", true)).toEqual({ ok: false, error: NO_HOOKS });
    expect(await createKey({ name: "Another", scopes: ["leads:read"] })).toEqual({ ok: false, error: NO_API });
    expect(await changeStatus(["l1"], "LOST")).toEqual({ ok: false, error: NO_CHAT });
    expect(h.hooks.createEndpoint).not.toHaveBeenCalled();
    expect(h.hooks.updateEndpoint).not.toHaveBeenCalled();
    expect(h.hooks.setEndpointEnabled).not.toHaveBeenCalled();
    expect(h.keys.createApiKey).not.toHaveBeenCalled();
    expect(h.leads.setLeadStatus).not.toHaveBeenCalled();

    // Keep your data: switch off and delete a webhook, revoke an API key, look at and delete leads, export them.
    expect(await toggleWebhook("e1", false)).toEqual({ ok: true });
    expect(h.hooks.setEndpointEnabled).toHaveBeenCalledWith(businessId, "e1", false);
    expect(await deleteWebhook("e1")).toEqual({ ok: true });
    expect(h.hooks.deleteEndpoint).toHaveBeenCalledWith(businessId, "e1");
    expect(await revokeKey("k1")).toEqual({ ok: true });
    expect(h.keys.revokeApiKey).toHaveBeenCalledWith(businessId, "k1");
    expect(await loadLead("l1")).toMatchObject({ ok: true, lead: { id: "l1" } });
    expect(await removeLeads(["l1"])).toEqual({ ok: true, deleted: 1 });
    const csv = await leadsExport(new NextRequest("https://bupulse.test/api/leads/export"));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("jean@example.com");

    // Nothing was deleted by the downgrade: the company, its lead and its usage record are all still there.
    expect(h.db.business.rows).toHaveLength(1);
    expect(h.db.lead.rows).toHaveLength(1);
    expect(h.db.usageRecord.rows).toHaveLength(2);
  });

  it("moving back up gives the features back at once", async () => {
    const c = await businessClient();
    Object.assign(c.subscription, { plan: "STARTER" });
    expect(await hasFeature(c.businessId, "webhooks")).toBe(false);
    const payment = await startManualPayment({ userId: c.userId, plan: "BUSINESS", interval: "MONTH", now: AT });
    await submitManualProof(c.userId, { paymentId: payment.id, transactionId: "MP3300110033", payerPhone: "0781234567", network: "MTN" }, AT);
    await confirmManualPayment(CONSOLE, payment.id, AT);
    expect(await hasFeature(c.businessId, "webhooks")).toBe(true);
    expect(await toggleWebhook("e1", true)).toEqual({ ok: true });
  });
});
