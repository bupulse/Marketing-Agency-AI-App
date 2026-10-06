import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, update } = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { subscription: { findFirst, update } } }));

import { applyProviderSubscription } from "@/lib/billing/apply";
import type { ProviderSubscription } from "@/lib/billing/types";

const USER = "11111111-1111-4111-8111-111111111111";
const sub = (over: Partial<ProviderSubscription> = {}): ProviderSubscription => ({
  providerSubscriptionId: "sub_1",
  providerCustomerId: "ctm_1",
  providerPriceId: "pri_std_m",
  userId: USER,
  status: "ACTIVE",
  currentPeriodStart: new Date("2026-10-06T00:00:00Z"),
  currentPeriodEnd: new Date("2026-11-06T00:00:00Z"),
  cancelAtPeriodEnd: false,
  updatedAt: new Date("2026-10-06T10:00:00Z"),
  ...over,
});

describe("applyProviderSubscription", () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockReset();
    process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
    process.env.PADDLE_PRICE_PRO_YEAR = "pri_pro_y";
  });

  it("upgrades a trial: paid plan starts now and the trial ends", async () => {
    findFirst.mockResolvedValue({ userId: USER, providerSubscriptionId: null, providerUpdatedAt: null });
    expect(await applyProviderSubscription("PADDLE", sub())).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER },
        data: expect.objectContaining({ plan: "STANDARD", interval: "MONTH", status: "ACTIVE", trialEndsAt: null }),
      }),
    );
  });

  it("maps a yearly Pro price", async () => {
    findFirst.mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_1", providerUpdatedAt: null });
    await applyProviderSubscription("PADDLE", sub({ providerPriceId: "pri_pro_y" }));
    expect(update.mock.calls[0][0].data).toMatchObject({ plan: "PRO", interval: "YEAR" });
  });

  it("ignores an older update that arrives late", async () => {
    findFirst.mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_1", providerUpdatedAt: new Date("2026-10-06T11:00:00Z") });
    expect(await applyProviderSubscription("PADDLE", sub({ status: "PAST_DUE" }))).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores the cancellation of an old subscription after a new one started", async () => {
    findFirst.mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_2", providerUpdatedAt: null });
    await applyProviderSubscription("PADDLE", sub({ status: "CANCELED" }));
    expect(update).not.toHaveBeenCalled();
  });

  it("returns false for a price that isn't ours or an unknown user", async () => {
    expect(await applyProviderSubscription("PADDLE", sub({ providerPriceId: "pri_other" }))).toBe(false);
    findFirst.mockResolvedValue(null);
    expect(await applyProviderSubscription("PADDLE", sub())).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
