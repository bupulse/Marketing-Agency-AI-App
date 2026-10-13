import { beforeEach, describe, expect, it, vi } from "vitest";

// Renewing a paid plan (docs/BILLING.md, "Renewing"): only in the last 7 days of the period, by Mobile Money or card,
// the new period starting when the current one ends; a card plan that renews by itself is never renewed by hand. The
// server refuses an early renewal (Mobile Money: tests/billing/momo-service.test.ts and tests/offers/addition.test.ts;
// card checkout here), and a card renewal of a Mobile Money plan keeps the days already paid (carry-over).

const h = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  checkoutConfig: vi.fn(async () => ({ provider: "PADDLE", priceId: "pri_rw" })),
  deferNextBilling: vi.fn(),
}));

vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: h.requireActiveUser }));
vi.mock("@/lib/db", async () => {
  const { seedPlanRows } = await import("../admin/fake-db");
  return { prisma: { subscription: { findUnique: h.findUnique, findFirst: h.findFirst, updateMany: h.updateMany }, planDefinition: { findMany: vi.fn(async () => seedPlanRows()) }, planRegionPrice: { findMany: vi.fn(async () => []) }, errorLog: { create: vi.fn() } } };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => true, UNAVAILABLE_MESSAGE: "off" }));
vi.mock("@/lib/billing", () => ({
  activeProvider: () => "PADDLE",
  billingAdapter: () => ({ provider: "PADDLE", isConfigured: async () => true, checkoutConfig: h.checkoutConfig, deferNextBilling: h.deferNextBilling }),
  isInterval: (v: unknown) => v === "MONTH" || v === "YEAR",
}));
vi.mock("@/lib/region-prices", async (orig) => ({
  ...(await orig<typeof import("@/lib/region-prices")>()),
  companyPlans: async () => ({ region: { key: "RW", paymentMethods: ["momo", "card"] }, plans: [{ key: "STANDARD" }] }),
  regionPriceIdFor: async () => "pri_rw",
}));
vi.mock("@/lib/region-check", () => ({ noteRegionMismatch: vi.fn(async () => null) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));

import { startCheckout } from "@/app/dashboard/billing/actions";
import { applyProviderSubscription } from "@/lib/billing/apply";
import { signCheckoutUser } from "@/lib/billing/signing";
import { daysLeftUntil, renewalState, tooEarlyToRenew, RENEWAL_WINDOW_DAYS } from "@/lib/billing/renewal";

const USER = "11111111-1111-4111-8111-111111111111";
const END = new Date("2026-11-01T00:00:00Z");
const DAY = 86_400_000;
const momoSub = (over: Record<string, unknown> = {}) => ({ userId: USER, plan: "STANDARD", interval: "MONTH", status: "ACTIVE", provider: "MANUAL_MOMO", providerSubscriptionId: null, providerCustomerId: null, cancelAtPeriodEnd: false, currentPeriodEnd: END, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENCRYPTION_KEY = "test-key";
  h.requireActiveUser.mockResolvedValue({ id: USER, actorId: USER, businessId: "biz1", role: "OWNER", email: "a@example.rw" });
  h.updateMany.mockResolvedValue({ count: 1 });
  h.findFirst.mockResolvedValue(null);
});

describe("the renewal window (pure)", () => {
  it("is 7 days", () => expect(RENEWAL_WINDOW_DAYS).toBe(7));

  it("Mobile Money: paid until the date (renewal hidden) before the last 7 days; open in them and after the end", () => {
    expect(renewalState(momoSub(), new Date(END.getTime() - 8 * DAY))).toEqual({ kind: "paid", until: END, opensAt: new Date(END.getTime() - 7 * DAY) });
    expect(renewalState(momoSub(), new Date(END.getTime() - 7 * DAY))).toEqual({ kind: "open", until: END, daysLeft: 7 });
    expect(renewalState(momoSub(), new Date(END.getTime() - 0.5 * DAY))).toEqual({ kind: "open", until: END, daysLeft: 1 });
    expect(renewalState(momoSub({ status: "PAST_DUE" }), new Date(END.getTime() + 4 * DAY))).toEqual({ kind: "open", until: END, daysLeft: 0 });
  });

  it("card: auto-renewing is never renewed by hand; a card plan cancelled at its end follows the window", () => {
    const card = { provider: "PADDLE", providerSubscriptionId: "sub_1", status: "ACTIVE", currentPeriodEnd: END };
    expect(renewalState({ ...card, cancelAtPeriodEnd: false }, new Date(END.getTime() - DAY))).toEqual({ kind: "auto", renewsAt: END });
    expect(renewalState({ ...card, cancelAtPeriodEnd: true }, new Date(END.getTime() - 10 * DAY))).toMatchObject({ kind: "paid" });
    expect(renewalState({ ...card, cancelAtPeriodEnd: true }, new Date(END.getTime() - 3 * DAY))).toMatchObject({ kind: "open", daysLeft: 3 });
  });

  it("tooEarlyToRenew: the period end while more than 7 days are left, else null", () => {
    expect(tooEarlyToRenew(momoSub(), new Date(END.getTime() - 8 * DAY))).toEqual(END);
    expect(tooEarlyToRenew(momoSub(), new Date(END.getTime() - 6 * DAY))).toBeNull();
    expect(tooEarlyToRenew(momoSub({ provider: "PADDLE", providerSubscriptionId: "sub_1" }), new Date(END.getTime() - 20 * DAY))).toBeNull();
    expect(tooEarlyToRenew(null)).toBeNull();
    expect(daysLeftUntil(END, new Date(END.getTime() - 1.2 * DAY))).toBe(2);
  });
});

describe("Renew with card (server)", () => {
  it("refuses an early card renewal of a paid-up Mobile Money plan with a clear message", async () => {
    h.findUnique.mockResolvedValue(momoSub({ currentPeriodEnd: new Date(Date.now() + 20 * DAY) }));
    const result = await startCheckout({ plan: "STANDARD", interval: "MONTH" });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Your plan is paid until .* You can renew from .*7 days before it ends/) });
    expect(h.checkoutConfig).not.toHaveBeenCalled();
  });

  it("opens the checkout in the last 7 days", async () => {
    h.findUnique.mockResolvedValue(momoSub({ currentPeriodEnd: new Date(Date.now() + 5 * DAY) }));
    expect(await startCheckout({ plan: "STANDARD", interval: "MONTH" })).toMatchObject({ ok: true });
    expect(h.checkoutConfig).toHaveBeenCalledTimes(1);
  });
});

describe("a card renewal of a Mobile Money plan (webhook)", () => {
  const card = async (end: Date) => ({ providerSubscriptionId: "sub_new", providerCustomerId: "ctm_1", providerPriceId: "pri_std_m", userId: USER, userIdSignature: await signCheckoutUser(USER), status: "ACTIVE" as const, currentPeriodStart: new Date(), currentPeriodEnd: end, cancelAtPeriodEnd: false, updatedAt: new Date() });

  it("in the window: takes over and moves the first card charge by the days still paid (no days lost)", async () => {
    process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
    const momoEnd = new Date(Date.now() + 4 * DAY);
    h.findUnique.mockResolvedValue({ userId: USER, providerSubscriptionId: null, status: "ACTIVE", provider: "MANUAL_MOMO", currentPeriodEnd: momoEnd });
    const sub = await card(new Date(Date.now() + 30 * DAY));
    h.deferNextBilling.mockImplementation(async (_id: string, at: Date) => ({ ...sub, currentPeriodEnd: at, updatedAt: new Date(Date.now() + 1000) }));
    h.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_new", status: "ACTIVE", provider: "PADDLE", currentPeriodEnd: sub.currentPeriodEnd });
    expect(await applyProviderSubscription("PADDLE", sub)).toBe("applied");
    expect(h.deferNextBilling).toHaveBeenCalledTimes(1);
    const [id, at] = h.deferNextBilling.mock.calls[0] as [string, Date];
    expect(id).toBe("sub_new");
    // One month after the Mobile Money end.
    const expected = new Date(momoEnd);
    expected.setUTCMonth(expected.getUTCMonth() + 1);
    expect(at.getTime()).toBe(expected.getTime());
    expect(h.updateMany).toHaveBeenCalledTimes(2);
  });

  it("before the window: still a duplicate (refunded by hand), nothing moves", async () => {
    process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
    h.findUnique.mockResolvedValue({ userId: USER, providerSubscriptionId: null, status: "ACTIVE", provider: "MANUAL_MOMO", currentPeriodEnd: new Date(Date.now() + 20 * DAY) });
    expect(await applyProviderSubscription("PADDLE", await card(new Date(Date.now() + 30 * DAY)))).toBe("duplicate");
    expect(h.deferNextBilling).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});
