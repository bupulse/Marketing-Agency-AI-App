import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Over the Jarvis API an email change or an ownership hand-over is only a request; the owner approves it in the console.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  changeUserEmail: vi.fn(),
  changeCompanyUserRole: vi.fn(),
  prepareEmailChange: vi.fn(),
  prepareMakeOwner: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: {} } }) }));
vi.mock("@/lib/billing/paddle", () => ({ paddle: {} }));
vi.mock("@/lib/billing/apply", () => ({ applyProviderSubscription: vi.fn() }));
vi.mock("@/lib/billing/paddle-admin", () => ({ createRefund: vi.fn(), describeRefundTarget: vi.fn() }));
vi.mock("@/lib/admin/actions/companies", () => ({
  changeUserEmail: h.changeUserEmail,
  changeCompanyUserRole: h.changeCompanyUserRole,
  prepareEmailChange: h.prepareEmailChange,
  prepareMakeOwner: h.prepareMakeOwner,
}));

import * as svc from "@/lib/admin/service";
import { apiContext, consoleContext } from "@/lib/admin/types";

const API = apiContext("key1", "203.0.113.5");
const CONSOLE = consoleContext("198.51.100.1");
const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  h.prepareEmailChange.mockResolvedValue({ userId: USER, currentEmail: "pat@old.com", newEmail: "pat@new.com", company: "Acme", businessId: "b1" });
  h.prepareMakeOwner.mockResolvedValue({ userId: USER, email: "pat@old.com", company: "Acme", businessId: "b1", currentOwner: "boss@acme.com" });
  h.changeUserEmail.mockResolvedValue({ userId: USER, newEmail: "pat@new.com", noticeSent: true, resetSent: false });
  h.changeCompanyUserRole.mockResolvedValue({ userId: USER, role: "OWNER", previousOwner: "x" });
});

describe("email change and ownership hand-over from the API", () => {
  it("only create a pending approval, with the details locked, and change nothing", async () => {
    const receipt = await svc.requestChangeUserEmail(API, { userId: USER, newEmail: "pat@new.com", idempotencyKey: "email-change-0001" , confirm: true });
    expect(receipt).toMatchObject({ status: "pending", kind: "change_user_email" });
    expect(h.changeUserEmail).not.toHaveBeenCalled();
    const row = h.db.adminApproval.rows[0];
    expect(row).toMatchObject({ kind: "change_user_email", status: "pending", requestedBy: "jarvis:key1" });
    expect(row.params).toMatchObject({ userId: USER, newEmail: "pat@new.com", currentEmail: "pat@old.com", company: "Acme" });
    const owner = await svc.requestMakeCompanyOwner(API, { userId: USER, idempotencyKey: "make-owner-0001" , confirm: true });
    expect(owner).toMatchObject({ status: "pending", kind: "make_company_owner" });
    expect(h.changeCompanyUserRole).not.toHaveBeenCalled();
  });

  it("need an idempotency key from the API, and replays return the same approval", async () => {
    await expect(svc.requestChangeUserEmail(API, { userId: USER, newEmail: "pat@new.com" , confirm: true })).rejects.toMatchObject({ code: "idempotency_required" });
    const a = await svc.requestChangeUserEmail(API, { userId: USER, newEmail: "pat@new.com", idempotencyKey: "email-change-0002" , confirm: true });
    const b = await svc.requestChangeUserEmail(API, { userId: USER, newEmail: "pat@new.com", idempotencyKey: "email-change-0002" , confirm: true });
    expect(b).toMatchObject({ id: a.id, replayed: true });
    expect(h.db.adminApproval.rows).toHaveLength(1);
  });

  it("run only when the owner approves in the console, as the console action, and not twice", async () => {
    const { id } = await svc.requestChangeUserEmail(API, { userId: USER, newEmail: "pat@new.com", sendReset: true, idempotencyKey: "email-change-0003" , confirm: true });
    await expect(svc.approveAction(API, id)).rejects.toMatchObject({ code: "forbidden" });
    expect(h.changeUserEmail).not.toHaveBeenCalled();
    const done = await svc.approveAction(CONSOLE, id);
    expect(done.status).toBe("executed");
    expect(h.changeUserEmail).toHaveBeenCalledTimes(1);
    expect(h.changeUserEmail).toHaveBeenCalledWith(CONSOLE, { userId: USER, newEmail: "pat@new.com", sendReset: true });
    await expect(svc.approveAction(CONSOLE, id)).rejects.toMatchObject({ code: "conflict" });
    expect(h.changeUserEmail).toHaveBeenCalledTimes(1);
  });

  it("make the company owner only on approval", async () => {
    const { id } = await svc.requestMakeCompanyOwner(API, { userId: USER, idempotencyKey: "make-owner-0002" , confirm: true });
    await svc.approveAction(CONSOLE, id);
    expect(h.changeCompanyUserRole).toHaveBeenCalledWith(CONSOLE, { userId: USER, role: "OWNER" });
  });
});
