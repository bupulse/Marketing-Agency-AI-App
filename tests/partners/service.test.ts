import { beforeEach, describe, expect, it, vi } from "vitest";

// The partner programme's service: the public application, the referral at sign-up (beside staff links), approval and
// payouts (audited, console only). No database: prisma is a fake.

const db = vi.hoisted(() => ({
  partner: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  partnerReferral: { create: vi.fn(), findMany: vi.fn() },
  partnerPayout: { create: vi.fn(), groupBy: vi.fn() },
  billingEvent: { findMany: vi.fn() },
  business: { findMany: vi.fn() },
  adminSetting: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
const limits = vi.hoisted(() => ({ publicLimited: vi.fn() }));
vi.mock("@/lib/request-limits", () => limits);

import { consoleContext, apiContext } from "@/lib/admin/types";
import { PARTNER_CODE_LENGTH, isPartnerCodeShape, partnerApplicationSchema } from "@/lib/partners/shared";
import { approvePartner, assignPartnerReferral, partnerByToken, recordPartnerPayout, rejectPartner, setPartnerPaused, submitPartnerApplication } from "@/lib/partners/service";
import { REF_CODE } from "@/lib/staff/permissions";

const ctx = consoleContext("1.2.3.4");
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const good = { kind: "coworking", name: "Aline", organisation: "Hub Kigali", email: "Aline@Hub.rw", phone: "0788 123 456", city: "Kigali", message: "Our members", agree: "yes" };

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  limits.publicLimited.mockResolvedValue(null);
  db.partner.findFirst.mockResolvedValue(null);
  db.partner.create.mockResolvedValue({ id: "p1" });
  db.partner.updateMany.mockResolvedValue({ count: 1 });
  db.partnerReferral.create.mockResolvedValue({});
  db.partnerReferral.findMany.mockResolvedValue([]);
  db.partnerPayout.groupBy.mockResolvedValue([]);
  db.billingEvent.findMany.mockResolvedValue([]);
  db.business.findMany.mockResolvedValue([]);
  db.adminSetting.findUnique.mockResolvedValue(null);
  db.auditLog.create.mockResolvedValue({});
});

describe("the application", () => {
  it("stores a valid application with a lower-case email and an E.164 phone, and emails nobody", async () => {
    expect(await submitPartnerApplication(form(good))).toEqual({ status: "success" });
    expect(db.partner.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "coworking", email: "aline@hub.rw", phone: "+250788123456", organisation: "Hub Kigali" }) });
    expect(limits.publicLimited).toHaveBeenCalledWith("partnerApply", "Aline@Hub.rw");
  });

  it("refuses missing terms, a bad kind and a bad phone, keeping what was typed", async () => {
    const r = await submitPartnerApplication(form({ ...good, agree: "", kind: "spy", phone: "call me" }));
    expect(r.status).toBe("error");
    expect(Object.keys(r.errors ?? {})).toEqual(expect.arrayContaining(["agree", "kind", "phone"]));
    expect(r.values?.name).toBe("Aline");
    expect(db.partner.create).not.toHaveBeenCalled();
  });

  it("pretends success for the honeypot and stores nothing", async () => {
    expect(await submitPartnerApplication(form({ ...good, website: "spam.example" }))).toEqual({ status: "success" });
    expect(db.partner.create).not.toHaveBeenCalled();
    expect(limits.publicLimited).not.toHaveBeenCalled();
  });

  it("answers the limit's message when an address sends too many", async () => {
    limits.publicLimited.mockResolvedValue("Too many tries. Please wait.");
    const r = await submitPartnerApplication(form(good));
    expect(r.errors?.form).toBe("Too many tries. Please wait.");
    expect(db.partner.create).not.toHaveBeenCalled();
  });

  it("accepts a second application from an open address silently, without a second row", async () => {
    db.partner.findFirst.mockResolvedValue({ id: "p0" });
    expect(await submitPartnerApplication(form(good))).toEqual({ status: "success" });
    expect(db.partner.create).not.toHaveBeenCalled();
  });

  it("the schema keeps optional fields optional", () => {
    expect(partnerApplicationSchema.safeParse({ kind: "client", name: "Jo", email: "jo@x.rw", phone: "+250788123456", agree: "yes" }).success).toBe(true);
  });
});

describe("the referral at sign-up", () => {
  const input = { businessId: "b1", userId: "u1", email: "owner@shop.rw", code: "abcdefg" };

  it("records the company for an approved partner's 7-character code", async () => {
    db.partner.findUnique.mockResolvedValue({ id: "p1", status: "approved", email: "aline@hub.rw" });
    expect(await assignPartnerReferral(input)).toBe("p1");
    expect(db.partnerReferral.create).toHaveBeenCalledWith({ data: { partnerId: "p1", businessId: "b1", userId: "u1", code: "ABCDEFG" } });
  });

  it("never treats a staff code (5 or 6 characters) as a partner's", async () => {
    for (const code of ["ABCDE", "ABCDEF"]) expect(await assignPartnerReferral({ ...input, code })).toBeNull();
    expect(db.partner.findUnique).not.toHaveBeenCalled();
  });

  it("ignores applied, paused and rejected partners, and self-referral", async () => {
    for (const status of ["applied", "paused", "rejected"]) {
      db.partner.findUnique.mockResolvedValueOnce({ id: "p1", status, email: "aline@hub.rw" });
      expect(await assignPartnerReferral(input)).toBeNull();
    }
    db.partner.findUnique.mockResolvedValueOnce({ id: "p1", status: "approved", email: "owner@shop.rw" });
    expect(await assignPartnerReferral({ ...input, email: " Owner@Shop.rw " })).toBeNull();
    expect(db.partnerReferral.create).not.toHaveBeenCalled();
  });

  it("never throws: a company already referred or a database error gives null", async () => {
    db.partner.findUnique.mockResolvedValue({ id: "p1", status: "approved", email: "aline@hub.rw" });
    db.partnerReferral.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(assignPartnerReferral(input)).resolves.toBeNull();
    db.partner.findUnique.mockRejectedValueOnce(new Error("down"));
    await expect(assignPartnerReferral(input)).resolves.toBeNull();
    await expect(assignPartnerReferral({ ...input, code: null })).resolves.toBeNull();
  });
});

describe("approval (console, audited)", () => {
  it("gives a 7-character code that fits the referral cookie, and a private page token", async () => {
    db.partner.findUnique.mockResolvedValue({ id: "p1", status: "applied", refCode: null, viewToken: null });
    const r = await approvePartner(ctx, "p1");
    expect(r.refCode).toHaveLength(PARTNER_CODE_LENGTH);
    expect(isPartnerCodeShape(r.refCode)).toBe(true);
    expect(r.refCode).toMatch(REF_CODE);
    expect(r.viewToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.link).toMatch(new RegExp(`\\?ref=${r.refCode}$`));
    expect(r.page).toContain(`/partners/me/${r.viewToken}`);
    expect(db.partner.updateMany).toHaveBeenCalledWith({ where: { id: "p1", status: "applied" }, data: expect.objectContaining({ status: "approved", refCode: r.refCode, decidedBy: "admin" }) });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "approve_partner", target: "partner:p1", actor: "admin" }) });
  });

  it("tries another code after a collision", async () => {
    db.partner.findUnique.mockResolvedValue({ id: "p1", status: "applied", refCode: null, viewToken: null });
    db.$transaction.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    await approvePartner(ctx, "p1");
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it("refuses the API, an active partner, and a change made meanwhile", async () => {
    await expect(approvePartner(apiContext("k1"), "p1")).rejects.toThrow(/admin console/);
    db.partner.findUnique.mockResolvedValueOnce({ id: "p1", status: "approved" });
    await expect(approvePartner(ctx, "p1")).rejects.toThrow(/already active/);
    db.partner.findUnique.mockResolvedValueOnce({ id: "p1", status: "applied", refCode: null, viewToken: null });
    db.partner.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(approvePartner(ctx, "p1")).rejects.toThrow(/changed meanwhile/);
  });

  it("turns down only a new application, with a reason, audited", async () => {
    db.partner.findUnique.mockResolvedValue({ status: "applied" });
    await expect(rejectPartner(ctx, "p1", "x")).rejects.toThrow(/short reason/);
    await rejectPartner(ctx, "p1", "Not in Rwanda");
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "reject_partner" }) });
    db.partner.findUnique.mockResolvedValue({ status: "approved" });
    await expect(rejectPartner(ctx, "p1", "Changed my mind")).rejects.toThrow(/Pause an active partner/);
  });

  it("pauses an active partner and resumes a paused one", async () => {
    await setPartnerPaused(ctx, "p1", true);
    expect(db.partner.updateMany).toHaveBeenLastCalledWith({ where: { id: "p1", status: "approved" }, data: { status: "paused" } });
    await setPartnerPaused(ctx, "p1", false);
    expect(db.partner.updateMany).toHaveBeenLastCalledWith({ where: { id: "p1", status: "paused" }, data: { status: "approved" } });
    db.partner.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(setPartnerPaused(ctx, "p1", true)).rejects.toThrow(/Only an active partner/);
  });
});

describe("payouts (Mark as paid)", () => {
  const NOW = new Date("2027-01-31T10:00:00Z");
  beforeEach(() => {
    db.partner.findUnique.mockResolvedValue({ id: "p1", status: "approved" });
    db.partnerReferral.findMany.mockResolvedValue([{ id: "r1", partnerId: "p1", businessId: "b1", userId: "u1", createdAt: new Date("2026-11-01T10:00:00Z") }]);
    // One confirmed Mobile Money payment of 50,000 RWF on 5 Nov: 20% = 10,000 RWF earned, past the hold.
    db.billingEvent.findMany.mockResolvedValue([
      { eventId: "mp1", type: "manual_payment.confirmed", createdAt: new Date("2026-11-05T10:00:00Z"), userId: "u1", payload: { data: { id: "mp1", amount_minor: 50_000, currency: "RWF", usd_cents: 3448, network: "MTN", plan: "BUSINESS" } } },
    ]);
    db.partnerPayout.create.mockImplementation(({ data }: { data: { amountMinor: number } }) => Promise.resolve({ id: "po1", ...data }));
  });

  it("records a payout up to what is owed, with its MoMo reference, audited in the same transaction", async () => {
    const r = await recordPartnerPayout(ctx, { partnerId: "p1", amountRwf: 6_000, reference: " ab12 cd34 ", note: "Sent" }, NOW);
    expect(r).toMatchObject({ amountRwf: 6_000, reference: "AB12CD34", owedAfterRwf: 4_000 });
    expect(db.partnerPayout.create).toHaveBeenCalledWith({ data: expect.objectContaining({ partnerId: "p1", amountMinor: 6_000, currency: "RWF", reference: "AB12CD34", createdBy: "admin" }) });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "partner_payout", target: "partner:p1", before: { owedRwf: 10_000 } }) });
  });

  it("refuses more than is owed, a bad amount or reference, the API, and a reference used before", async () => {
    await expect(recordPartnerPayout(ctx, { partnerId: "p1", amountRwf: 10_001, reference: "AB12CD34" }, NOW)).rejects.toThrow(/more than is owed/);
    await expect(recordPartnerPayout(ctx, { partnerId: "p1", amountRwf: 0, reference: "AB12CD34" }, NOW)).rejects.toThrow(/whole francs/);
    await expect(recordPartnerPayout(ctx, { partnerId: "p1", amountRwf: 1.5, reference: "AB12CD34" }, NOW)).rejects.toThrow(/whole francs/);
    await expect(recordPartnerPayout(ctx, { partnerId: "p1", amountRwf: 100, reference: "x" }, NOW)).rejects.toThrow(/transaction id/);
    await expect(recordPartnerPayout(apiContext("k1"), { partnerId: "p1", amountRwf: 100, reference: "AB12CD34" }, NOW)).rejects.toThrow(/admin console/);
    db.partnerPayout.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(recordPartnerPayout(ctx, { partnerId: "p1", amountRwf: 100, reference: "AB12CD34" }, NOW)).rejects.toThrow(/already recorded/);
  });

  it("counts nothing that is not confirmed money", async () => {
    db.billingEvent.findMany.mockResolvedValue([]);
    await expect(recordPartnerPayout(ctx, { partnerId: "p1", amountRwf: 1, reference: "AB12CD34" }, NOW)).rejects.toThrow(/more than is owed now \(0 RWF/);
  });
});

describe("the partner's own page", () => {
  it("answers null for a malformed or unknown token, and for an application or a rejected partner", async () => {
    expect(await partnerByToken("short")).toBeNull();
    expect(db.partner.findUnique).not.toHaveBeenCalled();
    const token = "a".repeat(43);
    db.partner.findUnique.mockResolvedValueOnce(null);
    expect(await partnerByToken(token)).toBeNull();
    db.partner.findUnique.mockResolvedValueOnce({ id: "p1", status: "rejected", referrals: [], payouts: [] });
    expect(await partnerByToken(token)).toBeNull();
  });

  it("shows a paused partner its numbers but not its link", async () => {
    db.partner.findUnique.mockResolvedValueOnce({ id: "p1", status: "paused", name: "Aline", organisation: "Hub", refCode: "ABCDEFG", referrals: [], payouts: [] });
    const v = await partnerByToken("a".repeat(43));
    expect(v).toMatchObject({ name: "Hub", status: "paused", link: null });
    expect(v?.summary.owedRwf).toBe(0);
  });
});
