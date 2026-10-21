/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The creator marketplace in the admin console (lib/admin/creators-marketplace.ts) against a mocked database: hiding
// and unhiding campaigns, blocking (open offers withdrawn) and unblocking creators, resolving reports (also straight
// from a hide or block), each one transaction with its audit row; and the console actions re-checking the admin.

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: Record<string, any> = {
    creatorCampaign: { findUnique: fn(), findMany: fn(), updateMany: fn() },
    creatorProfile: { findUnique: fn(), findMany: fn(), updateMany: fn() },
    creatorReport: { findUnique: fn(), findMany: fn(), updateMany: fn(), count: fn() },
    campaignCreator: { updateMany: fn(), groupBy: fn(), findMany: fn() },
    user: { findMany: fn() },
    business: { findMany: fn() },
    auditLog: { create: fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(db));
  return { db, adminAction: vi.fn(), finished: [] as unknown[] };
});

vi.mock("@/lib/db", () => ({ prisma: h.db }));
vi.mock("@/lib/admin/console", async () => ({
  adminAction: h.adminAction,
  finish: async (_back: string, _ok: unknown, fn: () => Promise<unknown>) => {
    h.finished.push(await fn());
  },
}));

import * as service from "@/lib/admin/creators-marketplace";
import * as consoleActions from "@/app/admin/(console)/(clients)/creators/actions";
import { consoleContext } from "@/lib/admin/types";

const ctx = consoleContext("203.0.113.5");
const audits = () => h.db.auditLog.create.mock.calls.map((c: any[]) => c[0].data);
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message: string }) => `${e.code}: ${e.message}`);
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.finished.length = 0;
  h.db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(h.db));
  h.adminAction.mockResolvedValue(ctx);
  h.db.creatorCampaign.updateMany.mockResolvedValue({ count: 1 });
  h.db.creatorProfile.updateMany.mockResolvedValue({ count: 1 });
  h.db.creatorReport.updateMany.mockResolvedValue({ count: 1 });
  h.db.campaignCreator.updateMany.mockResolvedValue({ count: 0 });
});

const campaign = { id: "c1", name: "Summer", status: "LIVE", listed: true, hiddenAt: null, hiddenReason: null, businessId: "b1" };
const profile = { id: "p1", name: "Aline", discoverable: true, blockedAt: null, blockedReason: null, userId: "u-creator" };

describe("hiding campaigns", () => {
  it("hides with a required reason, audited with before and after", async () => {
    h.db.creatorCampaign.findUnique.mockResolvedValue(campaign);
    expect(await code(service.hideCampaign(ctx, { campaignId: "c1", reason: " " }))).toMatch(/^invalid: Give a reason/);
    await service.hideCampaign(ctx, { campaignId: "c1", reason: "Asks creators to pay a fee" });
    const data = h.db.creatorCampaign.updateMany.mock.calls[0][0];
    expect(data.where).toEqual({ id: "c1", hiddenAt: null });
    expect(data.data).toMatchObject({ hiddenReason: "Asks creators to pay a fee" });
    expect(data.data.hiddenAt).toBeInstanceOf(Date);
    const [a] = audits();
    expect(a).toMatchObject({ actor: "admin", action: "creators_hide_campaign", target: "creator_campaign:c1", ip: "203.0.113.5" });
    expect(a.before).toMatchObject({ hiddenAt: null, listed: true, businessId: "b1" });
    expect(a.after).toMatchObject({ reason: "Asks creators to pay a fee" });
  });

  it("refuses a hidden one, and unhides it with an audit row", async () => {
    h.db.creatorCampaign.findUnique.mockResolvedValue({ ...campaign, hiddenAt: new Date(), hiddenReason: "x" });
    expect(await code(service.hideCampaign(ctx, { campaignId: "c1", reason: "again" }))).toBe("conflict: That campaign is already hidden.");
    await service.unhideCampaign(ctx, { campaignId: "c1" });
    expect(h.db.creatorCampaign.updateMany).toHaveBeenCalledWith({ where: { id: "c1", hiddenAt: { not: null } }, data: { hiddenAt: null, hiddenReason: null } });
    expect(audits()[0]).toMatchObject({ action: "creators_unhide_campaign", target: "creator_campaign:c1" });
    h.db.creatorCampaign.findUnique.mockResolvedValue(campaign);
    expect(await code(service.unhideCampaign(ctx, { campaignId: "c1" }))).toBe("conflict: That campaign is not hidden.");
  });

  it("from a report resolves that report in the same transaction", async () => {
    h.db.creatorCampaign.findUnique.mockResolvedValue(campaign);
    h.db.creatorReport.findUnique.mockResolvedValue({ id: "r1", campaignId: "c1", profileId: null });
    await service.hideCampaign(ctx, { campaignId: "c1", reason: "Not paying creators", reportId: "r1" });
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
    expect(h.db.creatorReport.updateMany).toHaveBeenCalledWith({ where: { id: "r1", status: "OPEN" }, data: expect.objectContaining({ status: "RESOLVED", resolvedBy: "admin", resolution: "Campaign hidden: Not paying creators" }) });
    expect(audits().map((a: any) => a.action)).toEqual(["creators_hide_campaign", "creators_resolve_report"]);
    // A report about something else is refused, and nothing is saved.
    h.db.creatorReport.findUnique.mockResolvedValue({ id: "r2", campaignId: "other", profileId: null });
    expect(await code(service.hideCampaign(ctx, { campaignId: "c1", reason: "Not paying", reportId: "r2" }))).toMatch(/^not_found:/);
  });
});

describe("blocking creators", () => {
  it("blocks with a reason, withdraws their open offers, and audits how many", async () => {
    h.db.creatorProfile.findUnique.mockResolvedValue(profile);
    h.db.campaignCreator.updateMany.mockResolvedValue({ count: 2 });
    const r = await service.blockCreator(ctx, { profileId: "p1", reason: "Bought views" });
    expect(r.offersWithdrawn).toBe(2);
    expect(h.db.creatorProfile.updateMany).toHaveBeenCalledWith({ where: { id: "p1", blockedAt: null }, data: { blockedAt: expect.any(Date), blockedReason: "Bought views" } });
    expect(h.db.campaignCreator.updateMany).toHaveBeenCalledWith({ where: { profileId: "p1", status: "OFFERED" }, data: { status: "DECLINED" } });
    expect(audits()[0]).toMatchObject({ action: "creators_block_creator", target: "creator_profile:p1", after: expect.objectContaining({ offersWithdrawn: 2, reason: "Bought views" }) });
  });

  it("needs a reason, refuses twice, and unblocks with an audit row", async () => {
    h.db.creatorProfile.findUnique.mockResolvedValue(profile);
    expect(await code(service.blockCreator(ctx, { profileId: "p1", reason: "" }))).toMatch(/^invalid:/);
    h.db.creatorProfile.findUnique.mockResolvedValue({ ...profile, blockedAt: new Date(), blockedReason: "Bought views" });
    expect(await code(service.blockCreator(ctx, { profileId: "p1", reason: "again" }))).toBe("conflict: That creator is already blocked.");
    await service.unblockCreator(ctx, { profileId: "p1", reason: "Appeal accepted" });
    expect(h.db.creatorProfile.updateMany).toHaveBeenCalledWith({ where: { id: "p1", blockedAt: { not: null } }, data: { blockedAt: null, blockedReason: null } });
    expect(audits()[0]).toMatchObject({ action: "creators_unblock_creator", before: expect.objectContaining({ blockedReason: "Bought views" }), after: expect.objectContaining({ reason: "Appeal accepted" }) });
  });
});

describe("reports", () => {
  it("resolve once, with a note, audited", async () => {
    h.db.creatorReport.findUnique.mockResolvedValue({ id: "r1", status: "OPEN", kind: "CREATOR", reason: "SPAM", campaignId: null, profileId: "p1" });
    expect(await code(service.resolveReport(ctx, { reportId: "r1", note: "" }))).toMatch(/^invalid:/);
    await service.resolveReport(ctx, { reportId: "r1", note: "Looked at the posts: fine." });
    expect(h.db.creatorReport.updateMany).toHaveBeenCalledWith({ where: { id: "r1", status: "OPEN" }, data: expect.objectContaining({ status: "RESOLVED", resolution: "Looked at the posts: fine.", resolvedBy: "admin" }) });
    expect(audits()[0]).toMatchObject({ action: "creators_resolve_report", target: "creator_report:r1" });
    h.db.creatorReport.findUnique.mockResolvedValue({ id: "r1", status: "RESOLVED" });
    expect(await code(service.resolveReport(ctx, { reportId: "r1", note: "again" }))).toBe("conflict: That report is already resolved.");
  });

  it("list oldest open first, with who sent them", async () => {
    h.db.creatorReport.findMany.mockResolvedValue([{ id: "r1", kind: "CREATOR", reporterUserId: "u1", businessId: "b1", campaign: null, profile: { id: "p1", name: "Aline", blockedAt: null } }]);
    h.db.user.findMany.mockResolvedValue([{ id: "u1", email: "owner@leaf.example" }]);
    h.db.business.findMany.mockResolvedValue([{ id: "b1", name: "LEAF" }]);
    const { items } = await service.listCreatorReports({});
    expect(h.db.creatorReport.findMany.mock.calls[0][0]).toMatchObject({ where: { status: "OPEN" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(items[0]).toMatchObject({ reporterEmail: "owner@leaf.example", reporterBusiness: "LEAF" });
    expect(await code(service.listCreatorReports({ status: "maybe" }))).toMatch(/^invalid: status must be one of/);
  });
});

describe("console actions", () => {
  it("re-check the admin's Change clients permission and pass the form through", async () => {
    h.db.creatorProfile.findUnique.mockResolvedValue(profile);
    await consoleActions.blockCreatorAction(form({ id: "p1", reason: "Bought views", back: "/admin/creators?tab=creators" }));
    expect(h.adminAction).toHaveBeenCalledWith("clients.manage");
    expect(h.db.creatorProfile.updateMany).toHaveBeenCalled();
    h.adminAction.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    await expect(consoleActions.hideCampaignAction(form({ id: "c1", reason: "x" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.db.creatorCampaign.updateMany).not.toHaveBeenCalled();
  });
});
