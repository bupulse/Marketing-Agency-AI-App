import { beforeEach, describe, expect, it, vi } from "vitest";

// One-click sign-in to the Video Studio (lib/video-studio/ticket.ts, docs/VIDEO_STUDIO_SPLIT.md): who may open it, the
// ticket's address, and that a ticket signs in once, only while fresh, and only someone still in that company.

const h = vi.hoisted(() => ({
  tickets: [] as { tokenHash: string; userId: string; businessId: string; expiresAt: Date; usedAt: Date | null }[],
  company: null as null | { actorId: string; role: "OWNER" | "ADMIN" | "MEMBER"; businessId: string; ownerId: string; ownerDeleting: boolean; ownerSuspended: boolean },
  enabled: true,
  credits: 100,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    studioTicket: {
      create: vi.fn(async ({ data }) => {
        h.tickets.push({ ...data, usedAt: null });
        return data;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async ({ where, data }) => {
        const t = h.tickets.find((x) => x.tokenHash === where.tokenHash && x.usedAt === null && x.expiresAt > where.expiresAt.gt);
        if (!t) return { count: 0 };
        t.usedAt = data.usedAt;
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }) => h.tickets.find((x) => x.tokenHash === where.tokenHash) ?? null),
    },
  },
}));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: vi.fn(async () => h.enabled) }));
vi.mock("@/lib/team/company", () => ({ resolveCompany: vi.fn(async () => h.company) }));
vi.mock("@/lib/usage", () => ({ getUsageSummary: vi.fn(async () => ({ limits: { videoCredits: h.credits } })) }));

import { issueStudioTicket, openStudioHref, redeemStudioTicket, studioBlock, studioPath, studioUrl, TICKET_TTL_MS } from "@/lib/video-studio/ticket";

const NOW = new Date("2026-10-19T10:00:00Z");
const tokenOf = (url: string) => new URL(url).searchParams.get("ticket")!;

beforeEach(() => {
  h.tickets = [];
  h.enabled = true;
  h.credits = 100;
  h.company = { actorId: "u-ana", role: "MEMBER", businessId: "biz1", ownerId: "u-owner", ownerDeleting: false, ownerSuspended: false };
  delete process.env.STUDIO_URL;
});

describe("the studio's address", () => {
  it("is studio.bupulse.com unless STUDIO_URL says otherwise", () => {
    expect(studioUrl({})).toBe("https://studio.bupulse.com");
    expect(studioUrl({ STUDIO_URL: "http://localhost:3100/" })).toBe("http://localhost:3100");
    expect(studioUrl({ STUDIO_URL: "not a url" })).toBe("https://studio.bupulse.com");
  });

  it("only lands on plain studio paths", () => {
    expect(studioPath("/create?product=p1")).toBe("/create?product=p1");
    expect(studioPath("//evil.example")).toBe("/");
    expect(studioPath("https://evil.example")).toBe("/");
    expect(studioPath("/\\evil.example")).toBe("/");
    expect(studioPath(null)).toBe("/");
    expect(openStudioHref("/create")).toBe("/dashboard/video/open?next=%2Fcreate");
    expect(openStudioHref()).toBe("/dashboard/video/open");
  });
});

describe("who may open the studio", () => {
  it("needs the studio switched on, the content permission and video credits in the plan", async () => {
    expect(await studioBlock({ role: "MEMBER", companyUserId: "u-owner" })).toBeNull();
    h.credits = 0;
    expect(await studioBlock({ role: "MEMBER", companyUserId: "u-owner" })).toBe("plan");
    h.enabled = false;
    expect(await studioBlock({ role: "MEMBER", companyUserId: "u-owner" })).toBe("off");
  });
});

describe("tickets", () => {
  it("sends the client to the studio with a token, storing only its hash", async () => {
    const url = await issueStudioTicket({ userId: "u-ana", businessId: "biz1", next: "/create" }, NOW);
    expect(url.startsWith("https://studio.bupulse.com/auth/bupulse?ticket=")).toBe(true);
    expect(new URL(url).searchParams.get("next")).toBe("/create");
    expect(h.tickets).toHaveLength(1);
    expect(h.tickets[0].tokenHash).not.toBe(tokenOf(url));
    expect(h.tickets[0].expiresAt.getTime() - NOW.getTime()).toBe(TICKET_TTL_MS);
  });

  it("signs in once, as the person, their company and the account usage is charged to", async () => {
    const token = tokenOf(await issueStudioTicket({ userId: "u-ana", businessId: "biz1" }, NOW));
    expect(await redeemStudioTicket(token, NOW)).toEqual({ userId: "u-ana", businessId: "biz1", companyUserId: "u-owner", role: "MEMBER" });
    expect(await redeemStudioTicket(token, NOW)).toBeNull();
  });

  it("refuses an expired ticket, a made-up one and one for a company the person left", async () => {
    const late = tokenOf(await issueStudioTicket({ userId: "u-ana", businessId: "biz1" }, NOW));
    expect(await redeemStudioTicket(late, new Date(NOW.getTime() + TICKET_TTL_MS + 1))).toBeNull();
    expect(await redeemStudioTicket("f".repeat(64), NOW)).toBeNull();
    expect(await redeemStudioTicket("not-a-token", NOW)).toBeNull();
    const moved = tokenOf(await issueStudioTicket({ userId: "u-ana", businessId: "biz1" }, NOW));
    h.company = { ...h.company!, businessId: "biz2" };
    expect(await redeemStudioTicket(moved, NOW)).toBeNull();
  });

  it("refuses a company that is suspended or being deleted", async () => {
    const token = tokenOf(await issueStudioTicket({ userId: "u-ana", businessId: "biz1" }, NOW));
    h.company = { ...h.company!, ownerSuspended: true };
    expect(await redeemStudioTicket(token, NOW)).toBeNull();
  });
});
