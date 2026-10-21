import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
// The confirm buttons show their outcome as a toast; rendered here without the app's ToastProvider.
vi.mock("@/components/ui/toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/toast")>()), useToast: () => ({ toast: () => {} }) }));

import { PendingPaymentList } from "@/components/admin/payments/pending-payments";
import { TodayPayments, TodayTimeline } from "@/components/admin/overview-today";
import { countsSignature, inboxFor, inboxTotalFor, INBOX_PERMISSION, LIVE_COUNT_PERMISSIONS } from "@/lib/admin/inbox";
import { assertCanGrant } from "@/lib/staff/service";
import { ALL_PERMISSIONS, permissionsOf } from "@/lib/staff/permissions";
import type { ManualPaymentAdminView } from "@/lib/billing/momo";

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

describe("who may give which role", () => {
  const it_ = { isOwner: false, permissions: permissionsOf("it") };
  it("the owner may give anything, Owner included", () => {
    expect(() => assertCanGrant({ isOwner: true, permissions: ALL_PERMISSIONS }, "owner", ALL_PERMISSIONS)).not.toThrow();
  });
  it("IT may give roles within its own permissions only (no self-escalation through roles)", () => {
    expect(() => assertCanGrant(it_, "custom_ops", ["system", "overview"])).not.toThrow();
    expect(() => assertCanGrant(it_, "finance", permissionsOf("finance"))).toThrow(/permissions you do not have/);
    expect(() => assertCanGrant(it_, "custom_all", ["system", "payments.approve"])).toThrow(/payments.approve/);
    expect(() => assertCanGrant(it_, "owner", [])).toThrow(/Only the owner/);
  });
  it("only the owner gives the Jarvis permission (a key runs admin tools)", () => {
    expect(() => assertCanGrant(it_, "it", permissionsOf("it"))).toThrow(/Jarvis/);
    expect(() => assertCanGrant({ isOwner: true, permissions: ALL_PERMISSIONS }, "it", permissionsOf("it"))).not.toThrow();
  });
});

const payment = (over: Partial<ManualPaymentAdminView> = {}) =>
  ({ id: "p1", reference: "BP-7K3Q", amountMinor: 29000, currency: "RWF", planName: "Standard", interval: "MONTH", transactionId: "MP1234", payerPhone: "0788123456", network: "MTN", proofPath: "u/p1/proof.png", submitted: true, submittedAt: "2026-10-18T08:00:00Z", createdAt: "2026-10-18T07:55:00Z", periodNote: null, seenBefore: null, userId: "u1", company: "Kigali Salon", email: "owner@example.com", status: "pending", ...over }) as unknown as ManualPaymentAdminView;

describe("overview approval card", () => {
  const actions = { confirmAction: vi.fn(), rejectAction: vi.fn() };
  it("lets Finance or the owner approve and reject in place (the dialog answers in words and the page refreshes), with the screenshot", () => {
    const out = html(createElement(PendingPaymentList, { items: [payment()], canApprove: true, ...actions }));
    expect(out).toContain("Kigali Salon");
    expect(out).toContain("BP-7K3Q");
    expect(out).toContain("/admin/payments/proof?id=p1");
    expect(out).toContain("Confirm");
    expect(out).toContain("Reject");
  });
  it("is read-only without the approve permission", () => {
    const out = html(createElement(PendingPaymentList, { items: [payment()], canApprove: false, ...actions }));
    expect(out).not.toContain(">Confirm<");
    expect(out).toContain("Finance or the owner approves");
  });
});

describe("live to-do counts", () => {
  it("are one comparable string: a payment reported while the Overview is open changes it, so the console refreshes", () => {
    const counts = { payments: 0, approvals: 0, demos: 1, requests: 0, invoices: 0, offers: 0, contests: 0, regions: 0, reports: 0, errors: 3 };
    expect(countsSignature(counts)).toBe(countsSignature({ ...counts }));
    expect(countsSignature({ ...counts, payments: 2 })).not.toBe(countsSignature(counts));
    expect(countsSignature(counts)).toContain("payments:0");
  });
  it("are kept live for everyone who sees one of the counted lists", () => {
    for (const perms of Object.values(INBOX_PERMISSION)) expect(perms.some((p) => LIVE_COUNT_PERMISSIONS.includes(p))).toBe(true);
  });
});

describe("today", () => {
  it("highlights today's payments with method, time and agent (or team)", () => {
    const out = html(createElement(TodayPayments, { payments: [
      { id: "a", at: "2026-10-18T08:00:00Z", company: "Kigali Salon", person: "Aline", usdCents: 2000, localMinor: 29000, currency: "RWF", amount: "$20.00 (RWF 29,000)", method: "Mobile Money", agent: "Eric", href: "/admin/companies/b1" },
      { id: "b", at: "2026-10-18T09:00:00Z", company: "Nyamirambo Shop", person: null, usdCents: 1500, localMinor: 1500, currency: "USD", amount: "$15.00", method: "Card", agent: null, href: null },
    ] }));
    expect(out).toContain("$35.00");
    expect(out).toContain("by Eric");
    expect(out).toContain("team");
    expect(out).toContain("10:00"); // Kigali time
    expect(html(createElement(TodayPayments, { payments: [] }))).toContain("No payments yet today");
  });
  it("tells the day in plain sentences, linking to each", () => {
    const out = html(createElement(TodayTimeline, { items: [{ id: "s", at: "2026-10-18T07:00:00Z", kind: "signup", text: "Kigali Salon signed up and chose the standard plan.", href: "/admin/companies/b1" }] }));
    expect(out).toContain("Kigali Salon signed up");
    expect(out).toContain('href="/admin/companies/b1"');
    expect(html(createElement(TodayTimeline, { items: [] }))).toContain("Nothing yet today");
  });
});

describe("inbox by permission", () => {
  const counts = { payments: 2, approvals: 1, demos: 3, requests: 4, invoices: 5, offers: 6, contests: 7, regions: 8, reports: 10, errors: 9 };
  it("counts only what each person can act on, never errors", () => {
    expect(inboxTotalFor(counts, ALL_PERMISSIONS)).toBe(46);
    expect(inboxTotalFor(counts, permissionsOf("finance"))).toBe(2 + 1 + 4 + 5 + 6);
    expect(inboxTotalFor(counts, permissionsOf("sales_agent"))).toBe(0);
    // Creator marketplace reports go to whoever can hide and block (support: "Change clients").
    expect(inboxTotalFor(counts, permissionsOf("support"))).toBe(3 + 4 + 6 + 7 + 8 + 10);
  });
  it("shows a person only their sections", () => {
    const sections = (["payments", "demos", "errors"] as const).map((key) => ({ key, title: key, why: "", href: "/admin", count: 1, tone: "neutral" as const, items: [] }));
    expect(inboxFor(sections, permissionsOf("support")).map((s) => s.key)).toEqual(["demos"]);
    expect(inboxFor(sections, permissionsOf("it")).map((s) => s.key)).toEqual(["errors"]);
  });
});
