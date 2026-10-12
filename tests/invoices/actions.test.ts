import { beforeEach, describe, expect, it, vi } from "vitest";

// The invoice actions and routes: every admin action re-checks the admin (adminAction: allow-listed email, AAL2)
// before the service runs; Activate account starts a trial for the days typed or opens a draft invoice; the client's
// PDF route serves only the Owner's own company's invoices; the admin PDF route answers 404 to anyone else.

const h = vi.hoisted(() => ({
  adminAction: vi.fn(),
  finish: vi.fn(async (_back: string, _ok: unknown, fn: () => Promise<unknown>) => fn()),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  startTrial: vi.fn(),
  svc: {
    createActivationInvoice: vi.fn(),
    updateInvoiceDraft: vi.fn(),
    sendInvoice: vi.fn(),
    resendInvoice: vi.fn(),
    markInvoicePaid: vi.fn(),
    voidInvoice: vi.fn(),
    clientInvoiceRow: vi.fn(),
    invoicePdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70, 45])),
    getInvoiceRow: vi.fn(),
  },
  settings: { saveInvoiceSettings: vi.fn(), uploadInvoiceLogo: vi.fn(), removeInvoiceLogo: vi.fn() },
  checkActiveUser: vi.fn(),
  requireActiveUser: vi.fn(),
  isAdminSession: vi.fn(async () => false),
  startInvoicePayment: vi.fn(),
  rateLimit: vi.fn(async () => {}),
}));

vi.mock("next/navigation", () => ({ redirect: h.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/console", async () => {
  const { AdminError } = await import("@/lib/admin/types");
  return {
    adminAction: h.adminAction,
    finish: h.finish,
    actionMessage: (e: unknown) => (e instanceof AdminError ? e.message : "oops"),
    safeAdminUrl: (back: string) => new URL(back, "http://x"),
  };
});
vi.mock("@/lib/admin/demos", () => ({ startTrial: h.startTrial }));
vi.mock("@/lib/invoices/service", () => h.svc);
vi.mock("@/lib/invoices/settings", () => ({ ...h.settings, LOGO_MAX_BYTES: 512 * 1024 }));
vi.mock("@/lib/auth/require-user", () => ({ checkActiveUser: h.checkActiveUser, requireActiveUser: h.requireActiveUser }));
vi.mock("@/lib/admin/auth", () => ({ isAdminSession: h.isAdminSession }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: h.rateLimit }));
// The Billing page actions file pulls in the billing stack; only the Mobile Money entry points matter here.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: async () => true, UNAVAILABLE_MESSAGE: "off" }));
vi.mock("@/lib/billing", () => ({ activeProvider: () => "PADDLE", billingAdapter: () => ({}), isInterval: (v: unknown) => v === "MONTH" || v === "YEAR" }));
vi.mock("@/lib/plan-catalog", () => ({ getPlan: vi.fn(), priceIdFor: vi.fn() }));
vi.mock("@/lib/billing/paddle", () => ({ invoiceUrl: vi.fn() }));
vi.mock("@/lib/billing/apply", () => ({ applyProviderSubscription: vi.fn() }));
vi.mock("@/lib/billing/methods", () => ({ paymentMethod: () => ({}) }));
vi.mock("@/lib/billing/momo", async (orig) => {
  const { ManualPaymentError } = await orig<typeof import("@/lib/billing/momo")>();
  return { ManualPaymentError, startInvoicePayment: h.startInvoicePayment, cancelManualPayment: vi.fn(), currentManualPayment: vi.fn() };
});

const CTX = { actor: "admin", ip: null, viaApi: false };
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const OWNER = { id: "owner", actorId: "owner", role: "OWNER", businessId: "biz1", email: "o@x.rw" };

beforeEach(() => {
  vi.clearAllMocks();
  h.adminAction.mockResolvedValue(CTX);
  h.requireActiveUser.mockResolvedValue(OWNER);
  h.checkActiveUser.mockResolvedValue({ status: "ok", user: OWNER });
});

describe("admin actions", () => {
  it("each one re-checks the admin first; without AAL2 (adminAction redirects) the service never runs", async () => {
    const a = await import("@/app/admin/(console)/invoices/actions");
    h.adminAction.mockRejectedValue(new Error("NEXT_REDIRECT /admin/verify"));
    const calls: [(f: FormData) => Promise<unknown>, FormData][] = [
      [a.activateAccountAction, form({ businessId: "biz1", mode: "invoice" })],
      [a.saveInvoiceAction, form({ id: "inv1", data: "{}" })],
      [a.sendInvoiceAction, form({ id: "inv1" })],
      [a.resendInvoiceAction, form({ id: "inv1" })],
      [a.markInvoicePaidAction, form({ id: "inv1", method: "CASH", reference: "R-1" })],
      [a.voidInvoiceAction, form({ id: "inv1", reason: "Wrong" })],
      [a.saveInvoiceSettingsAction, form({ businessName: "BuPulse" })],
      [a.uploadInvoiceLogoAction, form({})],
    ];
    for (const [fn, f] of calls) await expect(fn(f)).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(a.removeInvoiceLogoAction()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(h.adminAction).toHaveBeenCalledTimes(calls.length + 1);
    for (const fn of [...Object.values(h.svc), ...Object.values(h.settings), h.startTrial]) expect(fn).not.toHaveBeenCalled();
  });

  it("send / mark paid / void pass the console context and the form", async () => {
    const a = await import("@/app/admin/(console)/invoices/actions");
    await a.sendInvoiceAction(form({ id: "inv1", data: JSON.stringify({ lines: [] }) }));
    expect(h.svc.updateInvoiceDraft).toHaveBeenCalledWith(CTX, "inv1", { lines: [] });
    expect(h.svc.sendInvoice).toHaveBeenCalledWith(CTX, "inv1");
    await a.markInvoicePaidAction(form({ id: "inv1", method: "MTN", reference: " MP123456 " }));
    expect(h.svc.markInvoicePaid).toHaveBeenCalledWith(CTX, "inv1", { method: "MTN", reference: "MP123456" });
    await a.voidInvoiceAction(form({ id: "inv1", reason: "Re-issued" }));
    expect(h.svc.voidInvoice).toHaveBeenCalledWith(CTX, "inv1", "Re-issued", expect.any(Date), { acknowledgePayment: false });
  });

  it("Activate account: a trial for the days typed (1 to 90), or a draft invoice opened in the editor", async () => {
    const a = await import("@/app/admin/(console)/invoices/actions");
    await a.activateAccountAction(form({ businessId: "biz1", mode: "trial", days: "5", back: "/admin/demos" }));
    expect(h.startTrial).toHaveBeenCalledWith(CTX, { businessId: "biz1", days: 5, planKey: undefined });
    await expect(a.activateAccountAction(form({ businessId: "biz1", mode: "trial", days: "120" }))).rejects.toThrow(/1 to 90/);
    await expect(a.activateAccountAction(form({ businessId: "biz1", mode: "trial", days: "2.5" }))).rejects.toThrow(/1 to 90/);
    expect(h.startTrial).toHaveBeenCalledTimes(1);
    await a.activateAccountAction(form({ businessId: "biz1", mode: "trial", days: "" }));
    expect(h.startTrial).toHaveBeenLastCalledWith(CTX, { businessId: "biz1", days: undefined, planKey: undefined });

    h.svc.createActivationInvoice.mockResolvedValue({ id: "inv9", number: "BP-INV-0009", created: true });
    await expect(a.activateAccountAction(form({ businessId: "biz1", mode: "invoice", interval: "YEAR", back: "/admin/demos" }))).rejects.toMatchObject({ url: expect.stringMatching(/^\/admin\/invoices\/inv9\?notice=Draft\+BP-INV-0009/) });
    expect(h.svc.createActivationInvoice).toHaveBeenCalledWith(CTX, { businessId: "biz1", interval: "YEAR", planKey: undefined });
    const { AdminError } = await import("@/lib/admin/types");
    h.svc.createActivationInvoice.mockRejectedValue(new AdminError("conflict", "Already paying"));
    await expect(a.activateAccountAction(form({ businessId: "biz1", mode: "invoice", back: "/admin/demos" }))).rejects.toMatchObject({ url: "/admin/demos?error=Already+paying" });
  });

  it("the logo upload refuses a missing or oversized file before the service", async () => {
    const a = await import("@/app/admin/(console)/invoices/actions");
    await expect(a.uploadInvoiceLogoAction(form({}))).rejects.toThrow(/PNG or JPEG/);
    const big = new FormData();
    big.set("logo", new Blob([new Uint8Array(600 * 1024)], { type: "image/png" }), "logo.png");
    await expect(a.uploadInvoiceLogoAction(big)).rejects.toThrow(/512 KB/);
    expect(h.settings.uploadInvoiceLogo).not.toHaveBeenCalled();
  });
});

describe("client: paying an invoice by Mobile Money", () => {
  it("only the Owner; the invoice id goes to the service with the company account", async () => {
    const a = await import("@/app/dashboard/billing/actions");
    h.requireActiveUser.mockResolvedValue({ ...OWNER, role: "MEMBER" });
    expect(await a.startMomoPayment({ invoiceId: "inv1" })).toEqual({ ok: false, error: "Ask your company owner to do this." });
    expect(h.startInvoicePayment).not.toHaveBeenCalled();
    h.requireActiveUser.mockResolvedValue(OWNER);
    h.startInvoicePayment.mockResolvedValue({ id: "p1", reference: "BP-INV-0001" });
    expect(await a.startMomoPayment({ invoiceId: "inv1" })).toEqual({ ok: true, payment: { id: "p1", reference: "BP-INV-0001" } });
    expect(h.startInvoicePayment).toHaveBeenCalledWith({ userId: "owner", invoiceId: "inv1" });
    const { ManualPaymentError } = await import("@/lib/billing/momo");
    h.startInvoicePayment.mockRejectedValue(new ManualPaymentError("This invoice is already paid."));
    expect(await a.startMomoPayment({ invoiceId: "inv1" })).toEqual({ ok: false, error: "This invoice is already paid." });
  });
});

describe("PDF routes", () => {
  const call = async (id: string) => {
    const { GET } = await import("@/app/api/invoices/[id]/pdf/route");
    return GET(new Request(`https://bupulse.com/api/invoices/${id}/pdf`), { params: Promise.resolve({ id }) } as never);
  };

  it("client: signed out 401, not the Owner 403, another company's invoice 404, own invoice the PDF", async () => {
    h.checkActiveUser.mockResolvedValueOnce({ status: "signed_out" });
    expect((await call("inv1")).status).toBe(401);
    h.checkActiveUser.mockResolvedValueOnce({ status: "ok", user: { ...OWNER, role: "ADMIN" } });
    expect((await call("inv1")).status).toBe(403);
    h.svc.clientInvoiceRow.mockResolvedValueOnce(null);
    expect((await call("inv-of-another-company")).status).toBe(404);
    expect(h.svc.clientInvoiceRow).toHaveBeenLastCalledWith("biz1", "inv-of-another-company");
    // A malformed id is never decoded a second time: just not found.
    h.svc.clientInvoiceRow.mockResolvedValueOnce(null);
    expect((await call("%E0%A4%A")).status).toBe(404);
    expect(h.svc.clientInvoiceRow).toHaveBeenLastCalledWith("biz1", "%E0%A4%A");
    h.svc.clientInvoiceRow.mockResolvedValueOnce({ id: "inv1", number: "BP-INV-0001", status: "sent" });
    const ok = await call("inv1");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("content-disposition")).toBe('attachment; filename="BP-INV-0001.pdf"');
    // Per company (the limit says so): teammates share one bucket.
    expect(h.rateLimit).toHaveBeenCalledWith("invoice-pdf:biz1", expect.anything());
  });

  it("admin: 404 unless an AAL2 admin session", async () => {
    const { GET } = await import("@/app/admin/(console)/invoices/[id]/pdf/route");
    const res = await GET(new Request("https://bupulse.com/admin/invoices/inv1/pdf"), { params: Promise.resolve({ id: "inv1" }) } as never);
    expect(res.status).toBe(404);
    expect(h.svc.getInvoiceRow).not.toHaveBeenCalled();
    h.isAdminSession.mockResolvedValueOnce(true);
    h.svc.getInvoiceRow.mockResolvedValueOnce({ id: "inv1", number: "BP-INV-0001", status: "draft" });
    const ok = await GET(new Request("https://bupulse.com/admin/invoices/inv1/pdf"), { params: Promise.resolve({ id: "inv1" }) } as never);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toBe('inline; filename="BP-INV-0001.pdf"');
  });
});
