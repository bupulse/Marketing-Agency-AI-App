import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, findUnique, updateMany } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { subscription: { findFirst, findUnique, updateMany } } }));

import { applyProviderSubscription } from "@/lib/billing/apply";
import { signCheckoutUser } from "@/lib/billing/signing";
import type { ProviderSubscription } from "@/lib/billing/types";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const sub = (over: Partial<ProviderSubscription> = {}): ProviderSubscription => ({
  providerSubscriptionId: "sub_1",
  providerCustomerId: "ctm_1",
  providerPriceId: "pri_std_m",
  userId: USER,
  userIdSignature: null,
  status: "ACTIVE",
  currentPeriodStart: new Date("2026-10-06T00:00:00Z"),
  currentPeriodEnd: new Date("2026-11-06T00:00:00Z"),
  cancelAtPeriodEnd: false,
  updatedAt: new Date("2026-10-06T10:00:00Z"),
  ...over,
});
const trialRow = { userId: USER, providerSubscriptionId: null, status: "TRIALING" };

describe("applyProviderSubscription", () => {
  beforeEach(async () => {
    for (const m of [findFirst, findUnique, updateMany]) m.mockReset();
    process.env.ENCRYPTION_KEY = "test-key";
    process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
    process.env.PADDLE_PRICE_PRO_YEAR = "pri_pro_y";
    findFirst.mockResolvedValue(null);
    updateMany.mockResolvedValue({ count: 1 });
  });

  it("upgrades a trial when the checkout user id is signed by us", async () => {
    findUnique.mockResolvedValue(trialRow);
    const signed = sub({ userIdSignature: await signCheckoutUser(USER) });
    expect(await applyProviderSubscription("PADDLE", signed)).toBe("applied");
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ userId: USER, providerSubscriptionId: null });
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ plan: "STANDARD", interval: "MONTH", status: "ACTIVE", trialEndsAt: null });
  });

  it("refuses a user id that was changed in the browser", async () => {
    findUnique.mockResolvedValue({ ...trialRow, userId: OTHER });
    const forged = sub({ userId: OTHER, userIdSignature: await signCheckoutUser(USER) });
    expect(await applyProviderSubscription("PADDLE", forged)).toBe("unknown_user");
    expect(await applyProviderSubscription("PADDLE", sub({ userId: OTHER, userIdSignature: null }))).toBe("unknown_user");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("finds the owner by subscription id for later events and maps a yearly Pro price", async () => {
    findFirst.mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_1", status: "ACTIVE" });
    expect(await applyProviderSubscription("PADDLE", sub({ providerPriceId: "pri_pro_y", userId: null }))).toBe("applied");
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ plan: "PRO", interval: "YEAR" });
  });

  it("only writes when the stored state is not newer (atomic check)", async () => {
    findFirst.mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_1", status: "ACTIVE" });
    updateMany.mockResolvedValue({ count: 0 });
    expect(await applyProviderSubscription("PADDLE", sub({ status: "PAST_DUE" }))).toBe("stale");
    expect(updateMany.mock.calls[0][0].where.OR).toEqual([
      { providerUpdatedAt: null },
      { providerUpdatedAt: { lte: new Date("2026-10-06T10:00:00Z") } },
    ]);
  });

  it("flags a second live subscription instead of replacing the current one", async () => {
    findUnique.mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_1", status: "ACTIVE" });
    const second = sub({ providerSubscriptionId: "sub_2", userIdSignature: await signCheckoutUser(USER) });
    expect(await applyProviderSubscription("PADDLE", second)).toBe("duplicate");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("lets a new subscription replace one that has ended, but not the other way round", async () => {
    findUnique.mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_1", status: "CANCELED" });
    const resub = sub({ providerSubscriptionId: "sub_2", userIdSignature: await signCheckoutUser(USER) });
    expect(await applyProviderSubscription("PADDLE", resub)).toBe("applied");
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_2", status: "ACTIVE" });
    const lateOld = sub({ providerSubscriptionId: "sub_1", status: "CANCELED", userIdSignature: await signCheckoutUser(USER) });
    expect(await applyProviderSubscription("PADDLE", lateOld)).toBe("stale");
  });

  it("reports a price that isn't ours", async () => {
    expect(await applyProviderSubscription("PADDLE", sub({ providerPriceId: "pri_other" }))).toBe("unknown_price");
  });
});
