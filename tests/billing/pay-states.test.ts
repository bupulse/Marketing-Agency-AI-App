import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfferBanner } from "@/components/app/offer-banner";
import { OfferCard } from "@/components/billing/offer-card";
import { CARD_PAID_EVENTS, CHECKOUT_PENDING_MS, checkoutPendingSince, sinceOfSuccessUrl } from "@/lib/billing/checkout-pending";
import { checkingText, isBeingChecked, offerCheckingReference, TO_CHECK_WHERE } from "@/lib/billing/momo-shared";
import type { ClientOfferView } from "@/lib/offers/shared";

// What the client sees between paying and the plan switching on: a card payment waiting for its webhook, and a Mobile
// Money payment reported ("I have paid") and being checked. In both, no second way to pay is offered.

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const NOW = new Date("2026-10-14T12:00:00Z").getTime();

describe("a card checkout waiting for its webhook", () => {
  it("takes the checkout's start time from the success URL", () => {
    expect(sinceOfSuccessUrl(`https://bupulse.com/dashboard/billing?checkout=success&since=${NOW}`)).toBe(NOW);
    expect(sinceOfSuccessUrl("https://bupulse.com/dashboard/billing?checkout=success")).toBeNull();
    expect(sinceOfSuccessUrl("not a url ::")).toBeNull();
  });

  it("counts as pending for 30 minutes, then the pay buttons come back (a forged or old value is ignored)", () => {
    expect(checkoutPendingSince(String(NOW - 60_000), NOW)).toBe(NOW - 60_000);
    expect(checkoutPendingSince(String(NOW - CHECKOUT_PENDING_MS - 1), NOW)).toBeNull();
    expect(checkoutPendingSince(String(NOW + 60 * 60_000), NOW)).toBeNull();
    expect(checkoutPendingSince("abc", NOW)).toBeNull();
    expect(checkoutPendingSince(undefined, NOW)).toBeNull();
  });

  it("a recent Paddle payment or new subscription event means switching on, not pay again", () => {
    expect(CARD_PAID_EVENTS).toEqual(expect.arrayContaining(["transaction.completed", "subscription.created"]));
  });
});

describe("a Mobile Money payment being checked", () => {
  const payment = { status: "pending" as const, submitted: true, reference: "BP-7K3Q", offerId: "offer1", invoiceId: null };

  it("says what happens, with the reference", () => {
    expect(checkingText("BP-7K3Q")).toBe("We're checking your payment (reference BP-7K3Q), usually within a few minutes.");
    expect(isBeingChecked(payment)).toBe(true);
    expect(isBeingChecked({ ...payment, submitted: false })).toBe(false);
    expect(isBeingChecked({ ...payment, status: "rejected" })).toBe(false);
  });

  it("belongs to the offer it pays, directly or through the offer's invoice", () => {
    expect(offerCheckingReference(payment, { id: "offer1", invoiceId: null })).toBe("BP-7K3Q");
    expect(offerCheckingReference({ ...payment, offerId: null, invoiceId: "inv1", reference: "BP-INV-0001" }, { id: "offer1", invoiceId: "inv1" })).toBe("BP-INV-0001");
    expect(offerCheckingReference({ ...payment, offerId: "other" }, { id: "offer1", invoiceId: null })).toBeNull();
    expect(offerCheckingReference({ ...payment, submitted: false }, { id: "offer1", invoiceId: null })).toBeNull();
    expect(offerCheckingReference(null, { id: "offer1", invoiceId: null })).toBeNull();
  });

  it("the admin's queue is reported and undecided payments, one filter for every count", () => {
    expect(TO_CHECK_WHERE).toEqual({ status: "pending", submittedAt: { not: null } });
  });
});

const offer = (over: Partial<ClientOfferView> = {}): ClientOfferView => ({
  id: "offer1",
  status: "accepted",
  interval: "MONTH",
  currency: "RWF",
  totalMinor: 73000,
  computedMinor: 73000,
  adjustment: null,
  basePlanName: "Business",
  features: [{ key: "websiteChat", label: "Website chat and leads", description: "", added: true }],
  limits: { text: 200, image: 100, chat: 500, seats: 3, postsPerAppPerDay: 1 },
  managedTier: null,
  lines: [],
  note: null,
  validUntil: null,
  payMethod: "momo",
  invoiceId: null,
  addition: null,
  ...over,
});
const addition = { addonMinor: 10000, nextRenewalMinor: 45000, renewsOn: "2026-11-01T00:00:00.000Z", daysLeft: 14, periodDays: 31, currentPlanName: "Business", selfServe: true };

describe("the dashboard banner", () => {
  it("a custom plan: its price per month and Pay now", () => {
    const out = html(createElement(OfferBanner, { offer: offer() }));
    expect(out).toContain("Your custom plan is waiting for payment.");
    expect(out).toContain("73,000 RWF / month");
    expect(out).toContain("Pay now");
  });

  it("added features: one prorated payment now, not a custom plan per month", () => {
    const out = html(createElement(OfferBanner, { offer: offer({ totalMinor: 4677, addition }) }));
    expect(out).toContain("Your added features are waiting for payment.");
    expect(out).toContain("4,677 RWF paid once, for the 14 days left of your month");
    expect(out).toContain("45,000 RWF / month from your next renewal");
    expect(out).not.toContain("custom plan");
    expect(out).not.toContain("4,677 RWF / month");
  });

  it("once a payment of it is reported: we're checking it, and no Pay now", () => {
    const out = html(createElement(OfferBanner, { offer: offer(), checkingReference: "BP-7K3Q" }));
    expect(out).toContain("We&#x27;re checking your payment (reference BP-7K3Q), usually within a few minutes.");
    expect(out).not.toContain("Pay now");
    expect(out).not.toContain("waiting for payment");
  });
});

describe("the offer card on Billing and the demo lock", () => {
  it("while a payment of it is checked: the reference and no pay-by-Mobile-Money-below line", () => {
    const out = html(createElement(OfferCard, { offer: offer(), checkingReference: "BP-7K3Q" }));
    expect(out).toContain("Checking your payment");
    expect(out).toContain("reference BP-7K3Q");
    expect(out).not.toContain("Pay by Mobile Money below");
    expect(out).not.toContain("Accepted, waiting for payment");
  });

  it("otherwise as before", () => {
    const out = html(createElement(OfferCard, { offer: offer() }));
    expect(out).toContain("Pay by Mobile Money below");
    expect(out).toContain("Accepted, waiting for payment");
  });
});
