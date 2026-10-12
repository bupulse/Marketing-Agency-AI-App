import { beforeEach, describe, expect, it, vi } from "vitest";

// The Billing page's Mobile Money actions: only the Owner may pay, the form is checked, and the admin actions re-check
// the admin (AAL2) before confirming or rejecting.

const h = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  adapter: { startPayment: vi.fn(), submitProof: vi.fn() },
  cancel: vi.fn(),
  current: vi.fn(),
  adminAction: vi.fn(),
  finish: vi.fn(async (_back: string, _ok: unknown, fn: () => Promise<unknown>) => fn()),
  confirm: vi.fn(),
  reject: vi.fn(),
  save: vi.fn(),
  rateLimit: vi.fn<(key: string, rule: unknown) => Promise<void>>(async () => {}),
}));

vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: h.requireActiveUser }));
vi.mock("@/lib/db", () => ({ prisma: { subscription: { findUnique: vi.fn() } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => true, UNAVAILABLE_MESSAGE: "off" }));
vi.mock("@/lib/billing", () => ({ activeProvider: () => "PADDLE", billingAdapter: () => ({}), isInterval: (v: unknown) => v === "MONTH" || v === "YEAR" }));
vi.mock("@/lib/plan-catalog", () => ({ getPlan: vi.fn(), priceIdFor: vi.fn(), getSellablePlans: async () => [{ key: "STANDARD", name: "Standard" }] }));
vi.mock("@/lib/billing/paddle", () => ({ invoiceUrl: vi.fn() }));
vi.mock("@/lib/billing/apply", () => ({ applyProviderSubscription: vi.fn() }));
vi.mock("@/lib/billing/methods", () => ({ paymentMethod: () => h.adapter }));
vi.mock("@/lib/billing/momo", async (orig) => {
  const { ManualPaymentError } = await orig<typeof import("@/lib/billing/momo")>();
  return { ManualPaymentError, cancelManualPayment: h.cancel, currentManualPayment: h.current, confirmManualPayment: h.confirm, rejectManualPayment: h.reject };
});
vi.mock("@/lib/billing/momo-settings", () => ({ saveMomoSettings: h.save }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: h.rateLimit }));
vi.mock("@/lib/admin/console", async () => {
  const { AdminError } = await import("@/lib/admin/types");
  return { adminAction: h.adminAction, finish: h.finish, actionMessage: (e: unknown) => (e instanceof AdminError ? e.message : "oops") };
});

import { ManualPaymentError } from "@/lib/billing/momo";

const OWNER = { id: "owner", actorId: "owner", role: "OWNER", businessId: "b1", email: "o@x.rw" };
const MEMBER = { ...OWNER, actorId: "m1", role: "MEMBER" };
const DENIED = { ok: false, error: "Ask your company owner to do this." };

beforeEach(() => {
  vi.clearAllMocks();
  h.requireActiveUser.mockResolvedValue(OWNER);
  h.adminAction.mockResolvedValue({ actor: "admin", ip: null, viaApi: false });
});

describe("client actions", () => {
  it("a Member (or Admin) cannot start, submit, cancel or poll a payment", async () => {
    h.requireActiveUser.mockResolvedValue(MEMBER);
    const a = await import("@/app/dashboard/billing/actions");
    expect(await a.startMomoPayment({ plan: "STANDARD", interval: "MONTH" })).toEqual(DENIED);
    expect(await a.submitMomoProof({ paymentId: "p", transactionId: "T1234", payerPhone: "078 123 4567", network: "MTN" })).toEqual(DENIED);
    expect(await a.cancelMomoPayment("p")).toEqual(DENIED);
    expect(await a.momoPaymentStatus()).toBeNull();
    expect(h.adapter.startPayment).not.toHaveBeenCalled();
    expect(h.adapter.submitProof).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("the Owner starts a payment for a plan and period, and bad input is refused before the service runs", async () => {
    const a = await import("@/app/dashboard/billing/actions");
    expect(await a.startMomoPayment({ plan: "", interval: "MONTH" })).toMatchObject({ ok: false });
    expect(await a.startMomoPayment({ plan: "STANDARD", interval: "WEEK" })).toEqual({ ok: false, error: "Choose monthly or yearly." });
    expect(h.adapter.startPayment).not.toHaveBeenCalled();
    h.adapter.startPayment.mockResolvedValue({ id: "p1", reference: "BP-7K3Q" });
    expect(await a.startMomoPayment({ plan: "STANDARD", interval: "YEAR" })).toEqual({ ok: true, payment: { id: "p1", reference: "BP-7K3Q" } });
    expect(h.adapter.startPayment).toHaveBeenCalledWith({ userId: "owner", plan: "STANDARD", interval: "YEAR" });
  });

  it("start, I've paid and cancel share one limit per company (momo:<company>), answered in words", async () => {
    const a = await import("@/app/dashboard/billing/actions");
    const { RATE_LIMITS, RateLimitError } = await import("@/lib/rate-limit");
    h.adapter.startPayment.mockResolvedValue({ id: "p1", reference: "BP-7K3Q" });
    h.cancel.mockResolvedValue(true);
    await a.startMomoPayment({ plan: "STANDARD", interval: "MONTH" });
    await a.cancelMomoPayment("p1");
    expect(h.rateLimit.mock.calls).toEqual([["momo:owner", RATE_LIMITS.momo], ["momo:owner", RATE_LIMITS.momo]]);
    expect(RATE_LIMITS.momo).toEqual({ limit: 10, windowSeconds: 3600 });
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(1200)).mockRejectedValueOnce(new RateLimitError(1200)).mockRejectedValueOnce(new RateLimitError(1200));
    expect(await a.startMomoPayment({ plan: "STANDARD", interval: "MONTH" })).toEqual({ ok: false, error: expect.stringMatching(/doing that a lot/) });
    expect(await a.submitMomoProof({ paymentId: "p1", transactionId: "T1234", payerPhone: "078 123 4567", network: "MTN" })).toMatchObject({ ok: false });
    expect(await a.cancelMomoPayment("p1")).toMatchObject({ ok: false, error: expect.stringMatching(/doing that a lot/) });
    expect(h.adapter.startPayment).toHaveBeenCalledTimes(1);
    expect(h.adapter.submitProof).not.toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });

  it("service refusals come back in words; anything else is generic", async () => {
    const a = await import("@/app/dashboard/billing/actions");
    h.adapter.startPayment.mockRejectedValueOnce(new ManualPaymentError("You pay by card at the moment."));
    expect(await a.startMomoPayment({ plan: "STANDARD", interval: "MONTH" })).toEqual({ ok: false, error: "You pay by card at the moment." });
    h.adapter.submitProof.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await a.submitMomoProof({ paymentId: "p1", transactionId: "T1234", payerPhone: "078 123 4567", network: "MTN" })).toEqual({ ok: false, error: "Something went wrong. Nothing was changed. Please try again." });
    spy.mockRestore();
  });

  it("the proof goes to the adapter with the company id; cancelling answers in words when too late", async () => {
    const a = await import("@/app/dashboard/billing/actions");
    h.adapter.submitProof.mockResolvedValue({ id: "p1", submitted: true });
    expect(await a.submitMomoProof({ paymentId: "p1", transactionId: "T1234", payerPhone: "078 123 4567", network: "MTN" })).toEqual({ ok: true, payment: { id: "p1", submitted: true } });
    expect(h.adapter.submitProof).toHaveBeenCalledWith({ userId: "owner", paymentId: "p1", transactionId: "T1234", payerPhone: "078 123 4567", network: "MTN" });
    h.cancel.mockResolvedValue(false);
    expect(await a.cancelMomoPayment("p1")).toMatchObject({ ok: false, error: expect.stringMatching(/no longer be cancelled/) });
    h.cancel.mockResolvedValue(true);
    expect(await a.cancelMomoPayment("p1")).toEqual({ ok: true });
  });
});

describe("admin actions", () => {
  it("confirm and reject re-check the admin (adminAction: email, verified, AAL2) and pass the id and reason", async () => {
    const a = await import("@/app/admin/(console)/payments/actions");
    h.confirm.mockResolvedValue({ id: "p1", status: "confirmed", periodEnd: new Date("2026-11-14T00:00:00Z"), emailed: true });
    const f = new FormData();
    f.set("id", "p1");
    await a.confirmPaymentAction(f);
    expect(h.adminAction).toHaveBeenCalledTimes(1);
    expect(h.confirm).toHaveBeenCalledWith({ actor: "admin", ip: null, viaApi: false }, "p1");
    expect(h.finish).toHaveBeenCalledWith("/admin/payments", expect.any(Function), expect.any(Function));
    f.set("reason", "  No payment arrived. ");
    await a.rejectPaymentAction(f);
    expect(h.adminAction).toHaveBeenCalledTimes(2);
    expect(h.reject).toHaveBeenCalledWith(expect.objectContaining({ actor: "admin" }), "p1", "No payment arrived.");
  });

  it("the settings form saves where clients pay, trimmed; prices are not here (they are regional prices)", async () => {
    const a = await import("@/app/admin/(console)/payments/actions");
    const f = new FormData();
    f.set("merchantCode", " 123456 ");
    f.set("accountName", "BuPulse Ltd");
    await a.savePaymentSettingsAction(f);
    expect(h.adminAction).toHaveBeenCalledTimes(1);
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ actor: "admin" }), { merchantCode: "123456", momoNumber: "", accountName: "BuPulse Ltd", airtelNumber: "" });
  });
});
