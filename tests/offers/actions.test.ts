import { beforeEach, describe, expect, it, vi } from "vitest";

// The offer actions: every admin action re-checks the admin (adminAction: allow-listed email, AAL2) before its
// service runs; the client's accept is Owner only and rate-limited; the request form needs the billing permission.

const h = vi.hoisted(() => ({
  order: [] as string[],
  adminAction: vi.fn(),
  finish: vi.fn(async (_back: string, _ok: unknown, fn: () => Promise<unknown>) => fn()),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  offers: { saveOfferDraft: vi.fn(), sendOffer: vi.fn(), withdrawOffer: vi.fn(), acceptOffer: vi.fn() },
  setAddonPrice: vi.fn(),
  setPlanRequestStatus: vi.fn(),
  createPlanRequest: vi.fn(),
  requireActiveUser: vi.fn(),
  rateLimit: vi.fn(async () => {}),
  owned: ["content", "designs"] as string[],
}));

vi.mock("next/navigation", () => ({ redirect: h.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/console", async () => {
  const { AdminError } = await import("@/lib/admin/types");
  return { adminAction: h.adminAction, finish: h.finish, actionMessage: (e: unknown) => (e instanceof AdminError ? e.message : "oops"), safeAdminUrl: (back: string) => new URL(back, "http://x") };
});
vi.mock("@/lib/offers/service", async () => {
  class OfferError extends Error {}
  return { ...h.offers, OfferError };
});
vi.mock("@/lib/offers/addon-prices", () => ({ setAddonPrice: h.setAddonPrice }));
vi.mock("@/lib/offers/requests", async () => {
  class PlanRequestError extends Error {}
  return { setPlanRequestStatus: h.setPlanRequestStatus, createPlanRequest: h.createPlanRequest, PlanRequestError };
});
vi.mock("@/lib/region", () => ({ getRegion: async (key: string) => (key === "RW" ? { key: "RW", currency: "RWF" } : null) }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: h.requireActiveUser }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: h.rateLimit }));
// The Billing page actions file pulls in the billing stack; only the offer entry point matters here.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => true, UNAVAILABLE_MESSAGE: "off" }));
vi.mock("@/lib/billing", () => ({ activeProvider: () => "PADDLE", billingAdapter: () => ({}), isInterval: (v: unknown) => v === "MONTH" || v === "YEAR" }));
vi.mock("@/lib/billing/paddle", () => ({ invoiceUrl: vi.fn() }));
vi.mock("@/lib/billing/apply", () => ({ applyProviderSubscription: vi.fn() }));
vi.mock("@/lib/billing/methods", () => ({ paymentMethod: () => ({}) }));
vi.mock("@/lib/billing/momo", () => ({ ManualPaymentError: class extends Error {}, startInvoicePayment: vi.fn(), cancelManualPayment: vi.fn(), currentManualPayment: vi.fn() }));
vi.mock("@/lib/region-prices", () => ({ companyPlans: vi.fn(), regionPriceIdFor: vi.fn() }));
vi.mock("@/lib/region-check", () => ({ noteRegionMismatch: vi.fn(async () => null) }));
vi.mock("@/lib/plan-catalog", () => ({ getPlan: vi.fn(), priceIdFor: vi.fn() }));
vi.mock("@/lib/entitlements", () => ({ companyEntitlements: async () => ({ inPlan: new Set(h.owned) }) }));

import { saveOfferAction, withdrawOfferAction } from "@/app/admin/(console)/(money)/offers/actions";
import { saveAddonPricesAction } from "@/app/admin/(console)/(money)/addon-prices/actions";
import { setRequestStatusAction } from "@/app/admin/(console)/(clients)/requests/actions";
import { acceptOfferAction } from "@/app/dashboard/billing/actions";
import { requestCustomPlanAction } from "@/app/custom-plan/actions";
import { AdminError } from "@/lib/admin/types";
import { RateLimitError } from "@/lib/rate-limit";

const CTX = { actor: "admin", ip: null, viaApi: false };
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) f.append(k, one);
  return f;
};
const OWNER = { id: "owner", actorId: "owner", role: "OWNER", businessId: "biz1", email: "o@x.rw", email_confirmed_at: "2026-10-01" };
const redirectUrl = async (p: Promise<unknown>) => p.then(() => null, (e: { url?: string }) => e.url ?? null);

beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  h.adminAction.mockImplementation(async () => {
    h.order.push("adminAction");
    return CTX;
  });
  for (const fn of [h.offers.saveOfferDraft, h.offers.sendOffer, h.offers.withdrawOffer, h.setAddonPrice, h.setPlanRequestStatus]) {
    fn.mockImplementation(async () => {
      h.order.push("service");
      return { id: "offer1", emailed: true, to: "o@x.rw", validUntil: new Date("2026-10-20T00:00:00Z") };
    });
  }
});

describe("admin actions re-check the admin first", () => {
  it("save and send: adminAction, then the services; lands on the offer with a notice", async () => {
    const url = await redirectUrl(saveOfferAction(form({ businessId: "biz1", data: JSON.stringify({ interval: "MONTH" }), intent: "send" })));
    expect(h.order).toEqual(["adminAction", "service", "service"]);
    expect(h.offers.saveOfferDraft).toHaveBeenCalledWith(CTX, { businessId: "biz1", offerId: null, draft: { interval: "MONTH" } });
    expect(url).toMatch(/^\/admin\/offers\/offer1\?notice=Sent/);
  });

  it("a refused admin never reaches a service", async () => {
    h.adminAction.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(saveOfferAction(form({ businessId: "biz1", data: "{}" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(withdrawOfferAction(form({ id: "offer1", reason: "No" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(saveAddonPricesAction(form({ regionKey: "RW", price_seat: "3000", before_seat: "" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(setRequestStatusAction(form({ id: "r1", status: "closed" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.order).toEqual([]);
  });

  it("a service refusal comes back as ?error= on the editor", async () => {
    h.offers.saveOfferDraft.mockRejectedValueOnce(new AdminError("invalid", "Say why the price differs."));
    const url = await redirectUrl(saveOfferAction(form({ businessId: "biz1", data: "{}" })));
    expect(url).toBe("/admin/offers/new?businessId=biz1&error=Say+why+the+price+differs.");
  });

  it("add-on prices: only changed fields are written, in the region's currency", async () => {
    await saveAddonPricesAction(form({ regionKey: "RW", price_seat: "3,500", before_seat: "3000", price_webhooks: "", before_webhooks: "5000", "price_block:text": "3000", "before_block:text": "3000" }));
    expect(h.setAddonPrice.mock.calls.map((c) => c[1])).toEqual([
      { addonKey: "webhooks", regionKey: "RW", monthlyMinor: null },
      { addonKey: "seat", regionKey: "RW", monthlyMinor: 3500 },
    ]);
  });
});

describe("client actions", () => {
  it("accepting an offer is Owner only and rate-limited per company", async () => {
    h.requireActiveUser.mockResolvedValue({ ...OWNER, role: "MEMBER" });
    expect(await acceptOfferAction({ offerId: "offer1", method: "momo" })).toMatchObject({ ok: false });
    expect(h.offers.acceptOffer).not.toHaveBeenCalled();
    h.requireActiveUser.mockResolvedValue(OWNER);
    h.offers.acceptOffer.mockResolvedValue({});
    expect(await acceptOfferAction({ offerId: "offer1", method: "invoice" })).toEqual({ ok: true, method: "invoice" });
    expect(h.rateLimit).toHaveBeenCalledWith("offer:biz1", expect.anything());
    expect(h.offers.acceptOffer).toHaveBeenCalledWith({ userId: "owner", actorId: "owner", businessId: "biz1", offerId: "offer1", method: "invoice" });
    expect(await acceptOfferAction({ offerId: "offer1", method: "card" })).toMatchObject({ ok: false });
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(120));
    expect(await acceptOfferAction({ offerId: "offer1", method: "momo" })).toMatchObject({ ok: false, error: expect.stringMatching(/try again in 2 minutes/) });
  });

  it("the request form needs the billing permission and a confirmed email; it passes the ticked features (no goals) and what the plan has", async () => {
    h.requireActiveUser.mockResolvedValue(OWNER);
    h.createPlanRequest.mockResolvedValue({ id: "r1" });
    const state = await requestCustomPlanAction({}, form({ description: "We sell shoes", features: ["websiteChat", "autopilot"], source: "pricing" }));
    expect(state).toEqual({ done: true, requestId: "r1" }); // the call step links to it
    expect(h.requireActiveUser).toHaveBeenCalledWith("billing");
    expect(h.createPlanRequest.mock.calls[0][0]).toMatchObject({ businessId: "biz1", raw: { features: ["websiteChat", "autopilot"], source: "pricing" }, owned: ["content", "designs"] });
    expect(h.createPlanRequest.mock.calls[0][0].raw).not.toHaveProperty("goals");
    h.requireActiveUser.mockResolvedValue({ ...OWNER, email_confirmed_at: null });
    expect(await requestCustomPlanAction({}, form({}))).toMatchObject({ error: expect.stringMatching(/Confirm your email/) });
    h.requireActiveUser.mockResolvedValue(OWNER);
    h.createPlanRequest.mockRejectedValueOnce(new RateLimitError(3600));
    expect(await requestCustomPlanAction({}, form({}))).toMatchObject({ error: expect.stringMatching(/a few requests today/) });
  });
});
