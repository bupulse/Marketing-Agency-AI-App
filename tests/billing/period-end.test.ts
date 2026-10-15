import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// A plan stops when its paid time is over, whatever its status still says (docs/BILLING.md, "When a plan ends"): a
// Mobile Money or custom plan 3 days after its period (when the renewals job pauses it), a card plan that renews by
// itself 1 day after (time for Paddle's renewal webhook), a card plan cancelled at its end at once, the trial at
// trialEndsAt. A renewal that reached us moves the end, so the plan stays active.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));

import { CARD_RENEWAL_GRACE_DAYS, MANUAL_GRACE_DAYS, MAX_GRACE_MS, manualGrace, periodGraceMs, periodState, type PeriodSubscription } from "@/lib/billing/period";
import { GRACE_DAYS, graceEnd } from "@/lib/billing/momo-shared";
import { consumeUsage, UsageLimitError } from "@/lib/usage";
import { accountBlock, companyEntitlements, featureStatus } from "@/lib/entitlements";
import { resetPlanCache } from "@/lib/plan-catalog";
import { bannerState, TrialBanner, type TrialBannerProps } from "@/components/app/trial-banner";
import { endingNotice, formatDate } from "@/components/billing/helpers";

const DAY = 24 * 60 * 60 * 1000;
const END = new Date("2026-10-12T08:00:00Z");
const at = (days: number) => new Date(END.getTime() + days * DAY);

const momo: PeriodSubscription = { plan: "STARTER", provider: "MANUAL_MOMO", cancelAtPeriodEnd: false, currentPeriodEnd: END };
const custom: PeriodSubscription = { plan: "CUSTOM-TEST1", provider: "MANUAL_MOMO", cancelAtPeriodEnd: false, currentPeriodEnd: END };
const card: PeriodSubscription = { plan: "STARTER", provider: "PADDLE", cancelAtPeriodEnd: false, currentPeriodEnd: END };
const cardCancelled: PeriodSubscription = { ...card, cancelAtPeriodEnd: true };
const trial: PeriodSubscription = { plan: "TRIAL", provider: null, trialEndsAt: END, currentPeriodEnd: at(-5) };

describe("the rule (pure)", () => {
  it("grace: 3 days for plans renewed by hand, the same constant the renewals job pauses on; 1 day for card; none once cancelled", () => {
    expect([MANUAL_GRACE_DAYS, CARD_RENEWAL_GRACE_DAYS, GRACE_DAYS]).toEqual([3, 1, 3]);
    expect(periodGraceMs(momo)).toBe(3 * DAY);
    expect(periodGraceMs(custom)).toBe(3 * DAY);
    expect(periodGraceMs({ plan: "STARTER", provider: null, currentPeriodEnd: END })).toBe(3 * DAY);
    expect(periodGraceMs(card)).toBe(1 * DAY);
    expect(periodGraceMs(cardCancelled)).toBe(0);
    expect(MAX_GRACE_MS).toBe(3 * DAY);
    // The renewals job's timing is unchanged: PAST_DUE at end + 3 days, the moment the rule says ended.
    expect(graceEnd(END)).toEqual(at(3));
    expect(periodState(momo, graceEnd(END))).toBe("ended");
    expect(periodState(momo, new Date(graceEnd(END).getTime() - 1))).toBe("grace");
  });

  it("Mobile Money and custom plans: active to the end, in grace for 3 days, then ended", () => {
    for (const sub of [momo, custom]) {
      expect(periodState(sub, at(-1))).toBe("active");
      expect(periodState(sub, END)).toBe("active");
      expect(periodState(sub, at(0.5))).toBe("grace");
      expect(periodState(sub, at(2.9))).toBe("grace");
      expect(periodState(sub, at(3))).toBe("ended");
      expect(periodState(sub, at(30))).toBe("ended");
    }
  });

  it("card that renews by itself: 1 day of grace for the renewal webhook; cancelled at its end: ended at the end", () => {
    expect(periodState(card, at(-1))).toBe("active");
    expect(periodState(card, at(0.5))).toBe("grace");
    expect(periodState(card, at(1))).toBe("ended");
    expect(periodState(cardCancelled, END)).toBe("active");
    expect(periodState(cardCancelled, new Date(END.getTime() + 1))).toBe("ended");
  });

  it("the trial ends at trialEndsAt with no grace, never by its (not extended) currentPeriodEnd", () => {
    expect(periodState(trial, at(-1))).toBe("active");
    expect(periodState(trial, at(0.01))).toBe("ended");
    expect(periodState({ ...trial, trialEndsAt: at(10) }, at(5))).toBe("active");
    expect(periodState({ ...trial, trialEndsAt: null }, at(100))).toBe("active");
  });

  it("a renewed period (the webhook or the confirmation arrived) moves the end: active again", () => {
    const renewed = (sub: PeriodSubscription) => ({ ...sub, currentPeriodEnd: at(30) });
    for (const sub of [momo, custom, card]) expect(periodState(renewed(sub), at(10))).toBe("active");
  });

  it("no known end is never ended", () => {
    expect(periodState({ plan: "STARTER", provider: "PADDLE", currentPeriodEnd: null }, at(400))).toBe("active");
  });

  it("the grace notice is for plans renewed by hand only (a card plan's grace just waits for the renewal)", () => {
    expect(manualGrace(momo, at(1))).toEqual({ ended: END, until: at(3) });
    expect(manualGrace(custom, at(1))).toEqual({ ended: END, until: at(3) });
    expect(manualGrace(momo, at(-1))).toBeNull();
    expect(manualGrace(momo, at(3))).toBeNull();
    expect(manualGrace(card, at(0.5))).toBeNull();
    expect(manualGrace(trial, at(1))).toBeNull();
  });
});

describe("read-only accounts (lib/entitlements.ts accountBlock)", () => {
  const sub = (s: PeriodSubscription, status = "ACTIVE") => ({ ...s, status, chosenPlan: null });

  it("ACTIVE past the period and grace is ended (inactive); inside the grace it may still act", () => {
    for (const s of [momo, custom]) {
      expect(accountBlock(sub(s), at(2))).toBeNull();
      expect(accountBlock(sub(s), at(3.5))).toBe("inactive");
    }
    expect(accountBlock(sub(card), at(0.5))).toBeNull();
    expect(accountBlock(sub(card), at(1.5))).toBe("inactive");
    expect(accountBlock(sub(cardCancelled), at(0.1))).toBe("inactive");
    expect(accountBlock(sub({ ...card, currentPeriodEnd: at(30) }), at(1.5))).toBeNull();
  });

  it("keeps the other reasons first: past due stays past due, an ended trial is trial_expired", () => {
    expect(accountBlock(sub(momo, "PAST_DUE"), at(10))).toBe("past_due");
    expect(accountBlock(sub(trial, "TRIALING"), at(1))).toBe("trial_expired");
    expect(accountBlock(sub(card, "CANCELED"), at(-1))).toBe("inactive");
  });
});

const USER = "11111111-1111-4111-8111-111111111111";

function seed(s: PeriodSubscription, status = "ACTIVE") {
  h.db.user.rows.push({ id: USER, email: "a@b.rw", suspendedAt: null });
  const subscription = { id: "s1", userId: USER, status, chosenPlan: null, trialEndsAt: null, currentPeriodStart: new Date("2026-09-12T08:00:00Z"), ...s, user: { suspendedAt: null } };
  h.db.subscription.rows.push(subscription);
  h.db.business.rows.push({ id: "biz", userId: USER, user: { suspendedAt: null, subscription } });
}

describe("generation and features (database)", () => {
  beforeEach(() => {
    h.db = createFakeDb();
    resetPlanCache();
    const pro = h.db.planDefinition.rows.find((r) => r.key === "PRO");
    h.db.planDefinition.rows.push({ ...pro, key: "STARTER" }, { ...pro, key: "CUSTOM-TEST1", isCustom: true });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  const cases: [string, PeriodSubscription, number, number][] = [
    // provider, subscription, a moment inside the grace, a moment after it (days after the period end)
    ["Mobile Money", momo, 2, 3.5],
    ["custom plan (paid invoice or offer)", custom, 2, 3.5],
    ["card that renews by itself", card, 0.5, 1.5],
  ];

  for (const [label, s, inside, after] of cases) {
    it(`${label}: generates inside the grace, refused as inactive after it`, async () => {
      seed(s);
      vi.setSystemTime(at(inside));
      await expect(consumeUsage(USER, "text")).resolves.toMatchObject({ periodStart: expect.any(Date) });
      expect((await companyEntitlements("biz")).block).toBeNull();
      vi.setSystemTime(at(after));
      const error = await consumeUsage(USER, "text").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UsageLimitError);
      expect((error as UsageLimitError).reason).toBe("inactive");
      // Features (publishing, Autopilot, the widget and the API all ask here) are refused the same way.
      expect((await companyEntitlements("biz")).block).toBe("inactive");
      expect(await featureStatus("biz", "content")).toBe("not_in_plan");
    });
  }

  it("card cancelled at its end: refused as soon as the period is over", async () => {
    seed(cardCancelled);
    vi.setSystemTime(at(-0.5));
    await expect(consumeUsage(USER, "text")).resolves.toBeTruthy();
    vi.setSystemTime(at(0.1));
    await expect(consumeUsage(USER, "text")).rejects.toMatchObject({ reason: "inactive" });
  });

  it("trial: refused as trial_expired once trialEndsAt passed (no grace), even before the job marks it EXPIRED", async () => {
    seed(trial, "TRIALING");
    vi.setSystemTime(at(-0.5));
    await expect(consumeUsage(USER, "text")).resolves.toBeTruthy();
    vi.setSystemTime(at(0.01));
    await expect(consumeUsage(USER, "text")).rejects.toMatchObject({ reason: "trial_expired" });
    expect((await companyEntitlements("biz")).block).toBe("trial_expired");
  });

  it("a renewed period (the card webhook or the Mobile Money confirmation arrived) keeps generating", async () => {
    seed({ ...card, currentPeriodEnd: at(30) });
    vi.setSystemTime(at(5));
    await expect(consumeUsage(USER, "text")).resolves.toBeTruthy();
    expect((await companyEntitlements("biz")).block).toBeNull();
  });

  it("past due stays past due after the grace (the renewals job ran)", async () => {
    seed(momo, "PAST_DUE");
    vi.setSystemTime(at(10));
    await expect(consumeUsage(USER, "text")).rejects.toMatchObject({ reason: "past_due" });
  });
});

describe("dashboard notices", () => {
  const paid: TrialBannerProps = { isTrial: false, trialDaysLeft: null, subscriptionActive: true, text: { used: 0, max: 60 }, image: { used: 0, max: 30 } };
  const html = (p: TrialBannerProps) => renderToStaticMarkup(createElement(TrialBanner, p));

  it("after the grace: Your plan has ended (the layout's planEnded is accountBlock inactive)", () => {
    const planEnded = accountBlock({ ...momo, status: "ACTIVE", chosenPlan: null }, at(4)) === "inactive";
    expect(planEnded).toBe(true);
    expect(bannerState({ ...paid, planEnded })).toBe("planEnded");
    expect(html({ ...paid, planEnded })).toContain("Your plan has ended. Choose a plan to keep creating");
    // A card plan cancelled at its end: the "ends on" notice stops at the end, the ended notice takes over.
    expect(endingNotice({ plan: "STARTER", status: "ACTIVE", cancelAtPeriodEnd: true, currentPeriodEnd: END }, at(-1))).not.toBeNull();
    expect(endingNotice({ plan: "STARTER", status: "ACTIVE", cancelAtPeriodEnd: true, currentPeriodEnd: END }, at(0.1))).toBeNull();
  });

  it("inside the grace of a Mobile Money plan: when it ended and until when it works, not dismissible, no meters", () => {
    const g = manualGrace(momo, at(1))!;
    const grace = { ended: formatDate(g.ended)!, until: formatDate(g.until)! };
    expect(grace).toEqual({ ended: "October 12, 2026", until: "October 15, 2026" });
    expect(bannerState({ ...paid, grace })).toBe("grace");
    // More pressing than a usage warning; an ended plan or a failed payment still win.
    expect(bannerState({ ...paid, grace, text: { used: 59, max: 60 } })).toBe("grace");
    expect(bannerState({ ...paid, grace, planEnded: true })).toBe("planEnded");
    expect(bannerState({ ...paid, grace, pastDue: true })).toBe("pastDue");
    const owner = html({ ...paid, grace, text: { used: 59, max: 60 } });
    expect(owner).toContain("Your plan ended on October 12, 2026. Renew it before October 15, 2026 to keep creating");
    expect(owner).toContain('href="/dashboard/billing"');
    expect(owner).toContain(">Renew<");
    expect(owner).not.toContain("59 of 60");
    expect(owner).not.toContain("Dismiss");
    const member = html({ ...paid, grace, canPay: false });
    expect(member).toContain("Ask your company owner to renew it before October 15, 2026");
    expect(member).toContain("Your company owner manages the plan.");
  });

  it("no grace notice before the end or for a card plan", () => {
    expect(manualGrace(momo, at(-2))).toBeNull();
    expect(manualGrace(card, at(0.5))).toBeNull();
    expect(bannerState({ ...paid, grace: null })).toBe("hidden");
  });
});
