import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  chatWidget: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  lead: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  business: { groupBy: vi.fn() },
  serviceSwitch: { findMany: vi.fn() },
  webhookDelivery: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
}));
vi.mock("@/lib/db", () => ({ prisma }));
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail }));

import { isDigestDue, runLeadsDigest } from "@/lib/leads/digest";
import { clearSwitchCache } from "@/lib/admin/switch";
import { POST } from "@/app/api/cron/leads-digest/route";

describe("isDigestDue", () => {
  const utc8 = new Date("2026-10-08T08:10:00Z");
  it("is due only when the local hour is 8", () => {
    expect(isDigestDue("UTC", null, utc8)).toBe(true);
    expect(isDigestDue("Africa/Kigali", null, utc8)).toBe(false); // 10:10 there
    expect(isDigestDue("Africa/Kigali", null, new Date("2026-10-08T06:10:00Z"))).toBe(true);
    expect(isDigestDue("America/New_York", null, new Date("2026-10-08T12:10:00Z"))).toBe(true); // EDT
    expect(isDigestDue("America/New_York", null, new Date("2026-12-08T13:10:00Z"))).toBe(true); // EST
    expect(isDigestDue("America/New_York", null, new Date("2026-12-08T12:10:00Z"))).toBe(false);
    expect(isDigestDue("Asia/Kolkata", null, new Date("2026-10-08T02:40:00Z"))).toBe(true); // +5:30
  });
  it("is not due twice on the same local day", () => {
    expect(isDigestDue("UTC", new Date("2026-10-08T08:01:00Z"), utc8)).toBe(false);
    expect(isDigestDue("UTC", new Date("2026-10-07T08:01:00Z"), utc8)).toBe(true);
    // Local day boundary: 23:30 UTC on the 7th is already the 8th in Kigali (+2).
    expect(isDigestDue("Africa/Kigali", new Date("2026-10-07T23:30:00Z"), new Date("2026-10-08T06:10:00Z"))).toBe(false);
  });
  it("falls back to UTC for a bad zone", () => {
    expect(isDigestDue("Not/AZone", null, utc8)).toBe(true);
  });
});

const row = (id: string, timezone: string, lastDigestAt: Date | null = null) => ({
  businessId: id,
  lastDigestAt,
  business: { id, name: `Biz ${id}`, timezone, user: { email: `${id}@x.com` } },
});

describe("runLeadsDigest", () => {
  const now = new Date("2026-10-08T06:15:00Z");
  beforeEach(() => {
    for (const g of Object.values(prisma)) for (const f of Object.values(g)) f.mockReset();
    sendEmail.mockReset().mockResolvedValue(true);
    prisma.serviceSwitch.findMany.mockResolvedValue([]);
    clearSwitchCache();
    prisma.business.groupBy.mockResolvedValue([{ timezone: "Africa/Kigali" }, { timezone: "UTC" }, { timezone: "America/New_York" }]);
    prisma.chatWidget.updateMany.mockResolvedValue({ count: 1 });
    prisma.lead.findMany.mockResolvedValue([{ id: "l1", name: "Jane", email: null, phone: null, interest: "cakes", message: null, source: "website_chat", pageUrl: null, createdAt: new Date("2026-10-08T01:00:00Z") }]);
    prisma.lead.count.mockResolvedValue(2);
  });

  it("only sends to businesses where it is 08:00 and not yet sent today", async () => {
    prisma.chatWidget.findMany.mockResolvedValue([row("kigali", "Africa/Kigali"), row("utc", "UTC"), row("done", "Africa/Kigali", new Date("2026-10-08T04:00:00Z"))]);
    const result = await runLeadsDigest(now);
    expect(result).toMatchObject({ checked: 3, due: 1, sent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("kigali@x.com");
    expect(sendEmail.mock.calls[0][0].subject).toContain("1 new lead");
  });
  it("does nothing while Resend is switched off in the admin console: no claims, nothing counted as failed", async () => {
    prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "resend" }]);
    clearSwitchCache();
    prisma.chatWidget.findMany.mockResolvedValue([row("kigali", "Africa/Kigali")]);
    expect(await runLeadsDigest(now)).toEqual({ checked: 0, due: 0, sent: 0, skipped: 0, failed: 0 });
    expect(prisma.chatWidget.updateMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    // and it sends normally once Resend is back on
    prisma.serviceSwitch.findMany.mockResolvedValue([]);
    clearSwitchCache();
    expect(await runLeadsDigest(now)).toMatchObject({ sent: 1, failed: 0 });
  });
  it("reads only zones where it is 08:00, and pages by businessId until a short page", async () => {
    const page = Array.from({ length: 200 }, (_, i) => row(`b${String(i).padStart(3, "0")}`, "Africa/Kigali", new Date("2026-10-08T04:00:00Z")));
    prisma.chatWidget.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([row("b999", "Africa/Kigali")]);
    const result = await runLeadsDigest(now);
    expect(result).toMatchObject({ checked: 201, sent: 1 });
    const [first, second] = prisma.chatWidget.findMany.mock.calls.map((c) => c[0]);
    expect(first.where.business.timezone).toEqual({ in: ["Africa/Kigali"] });
    expect(first.orderBy).toEqual({ businessId: "asc" });
    expect(first.cursor).toBeUndefined();
    expect(second.cursor).toEqual({ businessId: "b199" });
    expect(second.skip).toBe(1);
  });
  it("does nothing when no zone is at 08:00", async () => {
    prisma.business.groupBy.mockResolvedValue([{ timezone: "America/New_York" }]);
    expect(await runLeadsDigest(now)).toMatchObject({ checked: 0, sent: 0 });
    expect(prisma.chatWidget.findMany).not.toHaveBeenCalled();
  });
  it("asks the database to skip users waiting for deletion and widgets with the digest off", async () => {
    prisma.chatWidget.findMany.mockResolvedValue([]);
    await runLeadsDigest(now);
    const where = prisma.chatWidget.findMany.mock.calls[0][0].where;
    expect(where.notifyDaily).toBe(true);
    expect(where.business.user.deletionScheduledFor).toBeNull();
  });
  it("skips when another run already claimed it, and when there is nothing to say", async () => {
    prisma.chatWidget.findMany.mockResolvedValue([row("kigali", "Africa/Kigali")]);
    prisma.chatWidget.updateMany.mockResolvedValue({ count: 0 });
    expect(await runLeadsDigest(now)).toMatchObject({ due: 1, sent: 0, skipped: 1 });
    prisma.chatWidget.updateMany.mockResolvedValue({ count: 1 });
    prisma.lead.findMany.mockResolvedValue([]);
    prisma.lead.count.mockResolvedValue(0);
    expect(await runLeadsDigest(now)).toMatchObject({ sent: 0, skipped: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it("gives the claim back when the email fails", async () => {
    prisma.chatWidget.findMany.mockResolvedValue([row("kigali", "Africa/Kigali")]);
    sendEmail.mockResolvedValue(false);
    expect(await runLeadsDigest(now)).toMatchObject({ failed: 1 });
    expect(prisma.chatWidget.updateMany.mock.calls[1][0]).toMatchObject({ where: { lastDigestAt: now }, data: { lastDigestAt: null } });
  });
});

describe("/api/cron/leads-digest", () => {
  const call = (auth?: string) => POST(new NextRequest("https://bupulse.test/api/cron/leads-digest", { method: "POST", headers: auth ? { authorization: auth } : {} }));
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    prisma.chatWidget.findMany.mockReset().mockResolvedValue([]);
    prisma.lead.findMany.mockReset().mockResolvedValue([]);
    prisma.business.groupBy.mockReset().mockResolvedValue([]);
  });
  it("needs the bearer secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer s3cret")).status).toBe(500);
  });
  it("runs with the right secret", async () => {
    const response = await call("Bearer s3cret");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ checked: 0, sent: 0, webhooks: { checked: 0, deleted: 0, adopted: 0 } });
  });
});
