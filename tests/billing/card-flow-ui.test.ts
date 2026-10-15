import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// What a card client sees around the end of their plan (found in the real card test on E2E Card Test): a notice on
// every page once the plan ended or while it is set to end, "Renew Starter" instead of "Upgrade to Starter", no
// "Mobile Money coming soon" on a method that works, and dialogs that screen readers and tests can find by role.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/dashboard/billing" }));
vi.mock("@/app/dashboard/billing/actions", () => ({ addFeaturesAction: vi.fn(), changePlan: vi.fn(), startCheckout: vi.fn(), startMomoPayment: vi.fn() }));
vi.mock("@/components/theme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/components/ui/toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/toast")>()), useToast: () => ({ toast: () => {} }) }));

import { bannerState, TrialBanner, type TrialBannerProps } from "@/components/app/trial-banner";
import { AddFeatures } from "@/components/billing/add-features";
import { PlanPicker } from "@/components/billing/plan-picker";
import { cardChangeNote, endingNotice, unpaidPlanLabel } from "@/components/billing/helpers";
import { Dialog } from "@/components/ui/dialog";
import { accountBlock } from "@/lib/entitlements";

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const paid: TrialBannerProps = { isTrial: false, trialDaysLeft: null, subscriptionActive: false, text: { used: 0, max: 60 }, image: { used: 0, max: 30 } };

describe("Home notice when a paid plan ended", () => {
  it("a cancelled or expired plan is read-only, the same rule that refuses generation (lib/usage.ts: inactive)", () => {
    const end = new Date("2026-10-14T00:00:00Z");
    expect(accountBlock({ plan: "STARTER", status: "CANCELED", trialEndsAt: null, currentPeriodEnd: end } as never)).toBe("inactive");
    expect(accountBlock({ plan: "STARTER", status: "EXPIRED", trialEndsAt: null, currentPeriodEnd: end } as never)).toBe("inactive");
    expect(accountBlock({ plan: "STARTER", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: end } as never)).toBeNull();
  });

  it("says so with Choose a plan to the owner, and who can to everyone else; no meters of the old limits", () => {
    expect(bannerState({ ...paid, planEnded: true })).toBe("planEnded");
    const owner = html(createElement(TrialBanner, { ...paid, planEnded: true }));
    expect(owner).toContain("Your plan has ended. Choose a plan to keep creating");
    expect(owner).toContain('href="/dashboard/billing"');
    expect(owner).toContain("Choose a plan");
    expect(owner).not.toContain("0 of 60");
    const member = html(createElement(TrialBanner, { ...paid, planEnded: true, canPay: false }));
    expect(member).toContain("Your plan has ended. Ask your company owner to choose a plan");
    expect(member).not.toContain('href="/dashboard/billing"');
  });

  it("a failed payment still wins, and an active plan shows nothing", () => {
    expect(bannerState({ ...paid, planEnded: true, pastDue: true })).toBe("pastDue");
    expect(bannerState({ ...paid, subscriptionActive: true })).toBe("hidden");
  });

  it("a plan cancelled at its period end gets a quiet notice: when it ends and from when it can be renewed", () => {
    const ending = { ...paid, subscriptionActive: true, endsOn: { end: "November 14, 2026", renewFrom: "November 7, 2026" } };
    expect(bannerState(ending)).toBe("ending");
    const out = html(createElement(TrialBanner, ending));
    expect(out).toContain("Your plan ends on November 14, 2026. You can renew from November 7, 2026");
    expect(out).toContain("Dismiss plan notice");
    expect(out).not.toContain("border-danger");
    expect(html(createElement(TrialBanner, { ...ending, endsOn: { end: "November 14, 2026", renewFrom: "now" } }))).toContain("You can renew it now");
    expect(html(createElement(TrialBanner, { ...ending, canPay: false }))).toContain("Your plan ends on November 14, 2026. Ask your company owner to renew it");
  });

  it("endingNotice: only a running paid plan set to cancel at its end; renewing opens 7 days before", () => {
    const end = new Date("2026-11-14T10:00:00Z");
    const sub = { plan: "STARTER", status: "ACTIVE", cancelAtPeriodEnd: true, currentPeriodEnd: end };
    expect(endingNotice(sub, new Date("2026-10-15T12:00:00Z"))).toEqual({ end: "November 14, 2026", renewFrom: "November 7, 2026" });
    expect(endingNotice(sub, new Date("2026-11-08T12:00:00Z"))).toEqual({ end: "November 14, 2026", renewFrom: "now" });
    expect(endingNotice(sub, new Date("2026-11-15T12:00:00Z"))).toBeNull();
    expect(endingNotice({ ...sub, cancelAtPeriodEnd: false }, new Date("2026-10-15T12:00:00Z"))).toBeNull();
    expect(endingNotice({ ...sub, status: "CANCELED" }, new Date("2026-10-15T12:00:00Z"))).toBeNull();
    expect(endingNotice({ ...sub, plan: "TRIAL" }, new Date("2026-10-15T12:00:00Z"))).toBeNull();
  });
});

describe("plan buttons after a plan ended", () => {
  const starter = { key: "STARTER", name: "Starter", monthlyPriceCents: 15000, currency: "RWF" };
  const business = { key: "BUSINESS", name: "Business", monthlyPriceCents: 50000, currency: "RWF" };
  it("the same plan is renewed, a dearer one is an upgrade, a cheaper one a switch", () => {
    expect(unpaidPlanLabel("STARTER", starter, starter)).toBe("Renew Starter");
    expect(unpaidPlanLabel("STARTER", business, starter)).toBe("Upgrade to Business");
    expect(unpaidPlanLabel("BUSINESS", starter, business)).toBe("Switch to Starter");
  });
  it("prices that cannot be compared (another currency, or the old plan not listed) just choose", () => {
    expect(unpaidPlanLabel("PRO", business, { monthlyPriceCents: 4900, currency: "USD" })).toBe("Choose Business");
    expect(unpaidPlanLabel("GONE", business, null)).toBe("Choose Business");
    expect(unpaidPlanLabel("STARTER", starter, null)).toBe("Renew Starter");
  });
  it("a trial still upgrades", () => {
    expect(unpaidPlanLabel("TRIAL", starter, null)).toBe("Upgrade to Starter");
  });
});

describe("plan changes of a card plan", () => {
  const end = new Date("2026-11-14T10:00:00Z");
  const opens = new Date("2026-11-07T10:00:00Z");
  it("say they go by card, and the true way to Mobile Money; never 'coming soon'", () => {
    expect(cardChangeNote({ kind: "paid", until: end, opensAt: opens }, true)).toBe("Card plans change by card. Switch to Mobile Money when you renew, from November 7, 2026.");
    expect(cardChangeNote({ kind: "auto", renewsAt: end }, true)).toBe("Card plans change by card. To pay by Mobile Money instead, cancel the card plan (it stays active until November 14, 2026) and renew by Mobile Money from November 7, 2026.");
    expect(cardChangeNote({ kind: "open", until: end, daysLeft: 3 }, true)).toBe("Card plans change by card. To pay by Mobile Money, renew with Mobile Money above.");
  });
  it("say nothing where Mobile Money cannot be used", () => {
    expect(cardChangeNote({ kind: "paid", until: end, opensAt: opens }, false)).toBeNull();
  });
});

describe("Add features on a card plan", () => {
  it("shows why, and no pay buttons (no 'Mobile Money coming soon' on a method that works)", () => {
    const reason = "This plan renews by card, at the card price. To add features to it, ask us for a card link. Or renew by Mobile Money from November 7, 2026 and add them here yourself.";
    const out = html(createElement(AddFeatures, { data: null, unavailable: reason, momo: "ready", cardRate: null, now: "2026-10-14T12:00:00Z" }));
    expect(out).toContain("Or renew by Mobile Money from November 7, 2026");
    expect(out).not.toContain("coming soon");
    expect(out).not.toContain("Pay with Mobile Money");
    expect(out).not.toContain("Get an invoice");
    expect(out).toContain("Request a custom change");
  });
});

describe("the shared dialog", () => {
  it("is a labelled modal dialog for screen readers and getByRole('dialog'), hidden while closed", () => {
    const closed = html(createElement(Dialog, { open: false, onOpenChange: () => {}, title: "Cancel your plan?", description: "Your plan stays active until November 14, 2026." }));
    expect(closed).toMatch(/<dialog[^>]*role="dialog"/);
    expect(closed).toMatch(/aria-modal="true"/);
    expect(closed).toMatch(/<dialog[^>]*aria-hidden="true"/);
    const id = /aria-labelledby="([^"]+)"/.exec(closed)?.[1];
    expect(id).toBeTruthy();
    expect(closed).toMatch(new RegExp(`<h2 id="${id}"[^>]*>Cancel your plan\\?</h2>`));
    expect(closed).toMatch(/aria-describedby="[^"]+-d"/);
    const open = html(createElement(Dialog, { open: true, onOpenChange: () => {}, title: "Reject BP-1?" }));
    expect(open).not.toMatch(/<dialog[^>]*aria-hidden/);
  });
});

describe("the plan cards on Billing", () => {
  const plan = (key: string, name: string, monthly: number) => ({
    key, name, description: "", isTrial: false, trialDays: null, highlight: false, monthlyPriceCents: monthly, yearlyPriceCents: monthly * 10, currency: "RWF",
    limits: { text: 60, image: 30, chat: 0, videos: 0, voiceCharacters: 0, seats: 1 }, highlights: [], features: [], regionKey: "RW", paymentMethods: ["momo", "card"], card: { monthlyUsdCents: 1200, yearlyUsdCents: 12000 },
  });
  const plans = [plan("STARTER", "Starter", 15000), plan("BUSINESS", "Business", 50000)] as never;
  const pay = { regionMethods: ["momo", "card"] as never, momoConfigured: true, cardConfigured: true, cardPriced: { STARTER: { MONTH: true, YEAR: true }, BUSINESS: { MONTH: true, YEAR: true } } };

  it("a card plan: switches by card, says why and how to move to Mobile Money, never 'coming soon'", () => {
    const note = "Card plans change by card. Switch to Mobile Money when you renew, from November 7, 2026.";
    const out = html(createElement(PlanPicker, { plans, current: { plan: "STARTER", interval: "MONTH", paid: true, pastDue: false, method: "card" }, pay: { ...pay, cardNote: note } }));
    expect(out).toContain("Switch to Business monthly");
    expect(out).toContain(note);
    expect(out).not.toMatch(/coming soon/i);
  });

  it("after a Starter plan ended: Renew Starter and Upgrade to Business, not Upgrade to Starter", () => {
    const out = html(createElement(PlanPicker, { plans, current: { plan: "STARTER", interval: "MONTH", paid: false, pastDue: false, method: null }, pay }));
    expect(out).toContain("Renew Starter");
    expect(out).toContain("Upgrade to Business");
    expect(out).not.toContain("Upgrade to Starter");
  });

  it("a trial still upgrades to every plan", () => {
    const out = html(createElement(PlanPicker, { plans, current: { plan: "TRIAL", interval: "MONTH", paid: false, pastDue: false, method: null }, pay }));
    expect(out).toContain("Upgrade to Starter");
    expect(out).toContain("Upgrade to Business");
  });
});
