import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";
import { authUser, code, companyOf, installSignUp, NOW, seedCatalog } from "./world";

// Journey 6: a business's billing region is fixed at sign-up (from its country). What a visitor's location says (the
// signed "Use my location" cookie, the IP country, a ?region= query) changes what the public pages show, never what a
// company is charged, which payment methods it gets, or which plans it can buy. Only an admin moves it (audited).

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: { id: "", actorId: "", businessId: "", role: "OWNER", email: "" },
  cookies: {} as Record<string, string>,
  reqHeaders: {} as Record<string, string>,
  sendEmail: vi.fn(async () => true),
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup" }, trackEvent: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.reqHeaders),
  cookies: async () => ({ get: (name: string) => (h.cookies[name] === undefined ? undefined : { name, value: h.cookies[name] }) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: vi.fn(async () => h.user), requirePersonalUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/industries/server", () => ({
  resolveIndustryChoice: async (v: { industry: string; industryDescription: string }) => (v.industry === "retail" ? { industryId: null, industryOther: "Shops", industry: "Shops & retail", industryDescription: v.industryDescription } : null),
}));

import { ensureAccount } from "@/lib/account";
import { saveOrganisation } from "@/app/welcome/actions";
import { saveBusiness } from "@/app/dashboard/settings/actions";
import { startCheckout } from "@/app/dashboard/billing/actions";
import { signGeoCookie, GEO_COOKIE } from "@/lib/geo-cookie";
import { companyRegion, displayRegion, displayRegionWithOverride, REGION_COOKIE } from "@/lib/region";
import { companyPlans, regionPriceIdFor } from "@/lib/region-prices";
import { getMomoPrice } from "@/lib/billing/momo-settings";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import { startManualPayment } from "@/lib/billing/momo";
import { createActivationInvoice } from "@/lib/invoices/service";
import { setCompanyRegion } from "@/lib/admin/regions-service";
import { choosePlan } from "@/lib/demo/bookings";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const KEY = Buffer.alloc(32, 7).toString("base64");

const settingsForm = (over: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("organisationName", "Inzu Fashion");
  f.set("ceoName", "Aline Uwase");
  f.set("phone", "");
  f.set("website", "");
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
};
const welcomeForm = (country: string) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ organisationName: "Inzu Fashion", ceoName: "Aline Uwase", industry: "retail", industryOther: "", industryDescription: "We sell kitenge dresses and accessories to young women in Kigali.", country, phone: "", website: "", terms: "true" })) f.set(k, v);
  return f;
};
const actAs = (c: { userId: string; businessId: string }, email: string) => Object.assign(h.user, { id: c.userId, actorId: c.userId, businessId: c.businessId, email });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.db = createFakeDb();
  installSignUp(h.db);
  h.cookies = {};
  h.reqHeaders = {};
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
  clearMomoSettingsCache();
  seedCatalog(h.db);
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse" } });
  // As the migration seeds them: GLOBAL rows for the plans that existed, EAC for Standard and Pro.
  h.db.planRegionPrice.rows.push(
    { id: "prp_std_global", planKey: "STANDARD", regionKey: "GLOBAL", currency: "USD", monthlyMinor: 4900, yearlyMinor: 49000, cardMonthlyUsdCents: null, cardYearlyUsdCents: null },
    { id: "prp_pro_global", planKey: "PRO", regionKey: "GLOBAL", currency: "USD", monthlyMinor: 9900, yearlyMinor: 99000, cardMonthlyUsdCents: null, cardYearlyUsdCents: null },
    { id: "prp_std_eac", planKey: "STANDARD", regionKey: "EAC", currency: "USD", monthlyMinor: 2500, yearlyMinor: 25000, cardMonthlyUsdCents: null, cardYearlyUsdCents: null },
  );
  h.db.planRegionPrice.rows.push({ id: "prp_pro_eac", planKey: "PRO", regionKey: "EAC", currency: "USD", monthlyMinor: 4900, yearlyMinor: 49000, cardMonthlyUsdCents: null, cardYearlyUsdCents: null });
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  vi.stubEnv("ADMIN_EMAILS", "owner@bupulse.com");
  vi.stubEnv("RESEND_API_KEY", "re_test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("journey: the billing region is fixed at sign-up", () => {
  it("is set from the sign-up country and not moved by a later sign-in, whatever the metadata says", async () => {
    await ensureAccount(authUser(1, "Rwanda") as never);
    await ensureAccount(authUser(2, "Kenya") as never);
    await ensureAccount(authUser(3, "France") as never);
    expect(h.db.business.rows.map((b) => b.pricingRegion)).toEqual(["RW", "EAC", "GLOBAL"]);
    // The confirmed address changes and the (client-writable) metadata now claims another country: only the email moves.
    await ensureAccount({ ...authUser(1, "France"), email: "new-address@example.com" } as never);
    expect(companyOf(h.db, 1).user.email).toBe("new-address@example.com");
    expect(companyOf(h.db, 1).business).toMatchObject({ pricingRegion: "RW", country: "Rwanda" });
    expect(h.db.business.rows).toHaveLength(3);
  });

  it("a Google sign-up chooses its country once, on the first save; a replayed save cannot move it", async () => {
    await ensureAccount({ id: "00000000-0000-4000-8000-000000000009", email: "g@example.com", email_confirmed_at: NOW.toISOString(), user_metadata: {}, identities: [{ provider: "google" }] } as never);
    const c = h.db.business.rows[0];
    expect(c).toMatchObject({ pricingRegion: "GLOBAL", detailsCompletedAt: null });
    Object.assign(h.user, { id: c.userId, actorId: c.userId, businessId: c.id });
    await expect(saveOrganisation({}, welcomeForm("Rwanda"))).rejects.toThrow("NEXT_REDIRECT /onboarding");
    expect(c).toMatchObject({ country: "Rwanda", pricingRegion: "RW", timezone: "Africa/Kigali" });
    await expect(saveOrganisation({}, welcomeForm("France"))).rejects.toThrow("NEXT_REDIRECT /onboarding");
    expect(c).toMatchObject({ country: "Rwanda", pricingRegion: "RW" });
  });

  it("the settings form ignores a posted country or region", async () => {
    await ensureAccount(authUser(1, "Rwanda") as never);
    const c = companyOf(h.db, 1);
    actAs(c, c.user.email);
    expect(await saveBusiness({}, settingsForm({ organisationName: "Inzu Fashion Ltd", country: "France", pricingRegion: "GLOBAL" }))).toEqual({ saved: true });
    expect(c.business).toMatchObject({ name: "Inzu Fashion Ltd", country: "Rwanda", pricingRegion: "RW" });
  });

  it("a visitor's location changes what the pages show, never what a company pays", async () => {
    await ensureAccount(authUser(1, "Rwanda") as never); // RW, pays in RWF
    await ensureAccount(authUser(2, "France") as never); // GLOBAL, card in USD
    const rw = companyOf(h.db, 1);
    const fr = companyOf(h.db, 2);
    h.db.subscription.rows.forEach((s) => Object.assign(s, { status: "TRIALING", chosenPlan: s.userId === rw.userId ? "BUSINESS" : "PRO" }));

    // The Rwandan owner travels (or uses a VPN): the browser's location says France, the IP says France.
    h.reqHeaders = { "cf-ipcountry": "FR" };
    h.cookies = { [GEO_COOKIE]: (await signGeoCookie("FR"))! };
    expect((await displayRegion()).key).toBe("GLOBAL");
    expect((await companyRegion(rw.businessId)).key).toBe("RW");
    const rwPlans = (await companyPlans(rw.businessId)).plans;
    expect(rwPlans.map((p) => [p.key, p.currency, p.monthlyPriceCents])).toEqual([["STARTER", "RWF", 15000], ["BUSINESS", "RWF", 35000]]);
    expect(await getMomoPrice(rw.businessId, "BUSINESS", "MONTH")).toEqual({ amountMinor: 35000, currency: "RWF" });
    actAs(rw, "owner1@example.com");
    const stillRwf = await startManualPayment({ userId: rw.userId, plan: "BUSINESS", interval: "MONTH", now: NOW });
    expect(stillRwf).toMatchObject({ amountMinor: 35000, currency: "RWF" });

    // The French owner gets a verified "Use my location: Rwanda" cookie and an RW IP, to try for RWF prices and Mobile Money.
    h.reqHeaders = { "cf-ipcountry": "RW" };
    h.cookies = { [GEO_COOKIE]: (await signGeoCookie("RW"))! };
    expect((await displayRegion()).key).toBe("RW"); // the public pricing page may show Rwandan prices...
    expect((await companyRegion(fr.businessId)).key).toBe("GLOBAL"); // ...the account does not.
    expect((await companyPlans(fr.businessId)).plans.map((p) => [p.key, p.currency])).toEqual([["STANDARD", "USD"], ["PRO", "USD"]]);
    expect(await getMomoPrice(fr.businessId, "BUSINESS", "MONTH")).toBeNull();
    expect(await getMomoPrice(fr.businessId, "PRO", "MONTH")).toBeNull();
    actAs(fr, "owner2@example.com");
    await expect(startManualPayment({ userId: fr.userId, plan: "PRO", interval: "MONTH", now: NOW })).rejects.toThrow(/not available for this plan where your business is/);
    expect(await startCheckout({ plan: "BUSINESS", interval: "MONTH" })).toEqual({ ok: false, error: "That plan is not offered where your business is. Choose one of the plans shown." });
    expect(await regionPriceIdFor("PADDLE", "BUSINESS", "GLOBAL", "MONTH")).toBeNull();
    expect(h.db.manualPayment.rows.filter((p) => p.userId === fr.userId)).toHaveLength(0);

    // An invoice is drafted in the company's region too (USD for the French client, RWF for the Rwandan one).
    Object.assign(fr.subscription, { status: "PENDING_DEMO", chosenPlan: null });
    await choosePlan({ businessId: fr.businessId, planKey: "PRO" });
    await createActivationInvoice(CONSOLE, { businessId: fr.businessId }, NOW);
    expect(h.db.invoice.rows[0]).toMatchObject({ businessId: fr.businessId, currency: "USD", planKey: "PRO" });
  });

  it("the ?region= query and bp-region cookie are ignored unless REGION_OVERRIDE=1 (local development)", async () => {
    h.reqHeaders = { "cf-ipcountry": "FR" };
    h.cookies = { [REGION_COOKIE]: "RW" };
    expect((await displayRegionWithOverride("RW")).key).toBe("GLOBAL");
    vi.stubEnv("REGION_OVERRIDE", "1");
    expect((await displayRegionWithOverride("EAC")).key).toBe("EAC");
  });

  it("a tampered or expired location cookie is not believed", async () => {
    h.reqHeaders = { "cf-ipcountry": "FR" };
    const real = (await signGeoCookie("RW"))!;
    h.cookies = { [GEO_COOKIE]: real.replace(/^RW/, "KE") };
    expect((await displayRegion()).key).toBe("GLOBAL");
    h.cookies = { [GEO_COOKIE]: (await signGeoCookie("RW", NOW.getTime() - 25 * 3_600_000))! };
    expect((await displayRegion()).key).toBe("GLOBAL");
  });

  it("only an admin, in the console, moves a company; it is audited and the new region's plans and payment methods apply", async () => {
    await ensureAccount(authUser(1, "Kenya") as never); // EAC: card only, PRO at $49
    const c = companyOf(h.db, 1);
    // (The console action wraps this in adminAction, which needs the admin's authenticator code; nothing else calls it.)
    expect(await setCompanyRegion(CONSOLE, { businessId: c.businessId, regionKey: "RW" })).toMatchObject({ pricingRegion: "RW", changed: true });
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "update_company_region", target: `business:${c.businessId}`, before: { pricingRegion: "EAC" }, after: { pricingRegion: "RW" } });
    expect(c.business.pricingRegion).toBe("RW");
    resetRegionPriceCache();
    expect((await companyPlans(c.businessId)).plans.map((p) => p.key)).toEqual(["STARTER", "BUSINESS"]);
    expect(await getMomoPrice(c.businessId, "STARTER", "MONTH")).toEqual({ amountMinor: 15000, currency: "RWF" });
    expect(await code(setCompanyRegion(CONSOLE, { businessId: c.businessId, regionKey: "NOPE" }))).toMatch(/^not_found/);
  });
});
