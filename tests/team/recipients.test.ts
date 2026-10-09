import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { membership: { findMany: h.findMany } } }));

import { alertRecipients } from "@/lib/team/recipients";

const row = (role: string, email: string, extra: object = {}) => ({ role, user: { email, suspendedAt: null, deletionScheduledFor: null, ...extra } });

beforeEach(() => h.findMany.mockReset());

describe("alertRecipients", () => {
  it("asks only for the Owner and Admins who opted in", async () => {
    h.findMany.mockResolvedValue([]);
    await alertRecipients("b1", "account@x.com");
    expect(h.findMany.mock.calls[0][0].where).toEqual({ businessId: "b1", OR: [{ role: "OWNER" }, { role: "ADMIN", notifyEmail: true }] });
  });

  it("puts the current Owner first, not the company account's email, then opted-in Admins", async () => {
    h.findMany.mockResolvedValue([row("ADMIN", "anchor@x.com"), row("OWNER", "newowner@x.com"), row("ADMIN", "admin2@x.com")]);
    expect(await alertRecipients("b1", "anchor@x.com")).toEqual(["newowner@x.com", "anchor@x.com", "admin2@x.com"]);
  });

  it("skips suspended or deleting people and repeats nobody", async () => {
    h.findMany.mockResolvedValue([row("OWNER", "o@x.com"), row("ADMIN", "o@x.com"), row("ADMIN", "gone@x.com", { suspendedAt: new Date() })]);
    expect(await alertRecipients("b1")).toEqual(["o@x.com"]);
  });

  it("falls back to the company account's email when the lookup fails or finds nobody", async () => {
    h.findMany.mockRejectedValueOnce(new Error("db"));
    expect(await alertRecipients("b1", "account@x.com")).toEqual(["account@x.com"]);
    h.findMany.mockResolvedValueOnce([]);
    expect(await alertRecipients("b1", "account@x.com")).toEqual(["account@x.com"]);
    h.findMany.mockResolvedValueOnce([]);
    expect(await alertRecipients("b1", null)).toEqual([]);
  });
});
