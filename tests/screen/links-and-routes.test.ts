import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    screenLink: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  screenData: vi.fn(),
  limited: vi.fn(async () => null as string | null),
}));
vi.mock("@/lib/request-limits", () => ({ publicLimited: h.limited, clientIpFrom: () => "198.51.100.7" }));
vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/screen/data", () => ({ screenData: h.screenData }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/components/screen/sales-screen", () => ({ SalesScreen: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { createScreenLink, hashScreenToken, screenByToken, touchScreen } from "@/lib/screen/links";
import ScreenPage from "@/app/screen/[token]/page";
import { GET } from "@/app/screen/[token]/data/route";
import { NextRequest } from "next/server";

const TOKEN = "A".repeat(43);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ctx = { actor: "staff:s1", viaApi: false };

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.prisma));
  h.prisma.screenLink.updateMany.mockResolvedValue({ count: 1 });
});

describe("screen links", () => {
  it("looks a token up by its SHA-256 hash only", async () => {
    h.prisma.screenLink.findUnique.mockResolvedValue({ id: "l1", name: "TV", lastSeenAt: null, revokedAt: null });
    expect(await screenByToken(TOKEN)).toEqual({ id: "l1", name: "TV", lastSeenAt: null });
    expect(h.prisma.screenLink.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: sha(TOKEN) });
    expect(hashScreenToken(TOKEN)).toBe(sha(TOKEN));
  });

  it("refuses a malformed token without asking the database, and a revoked or unknown one", async () => {
    expect(await screenByToken("short")).toBeNull();
    expect(await screenByToken(`${TOKEN}/../x`)).toBeNull();
    expect(h.prisma.screenLink.findUnique).not.toHaveBeenCalled();
    h.prisma.screenLink.findUnique.mockResolvedValueOnce({ id: "l1", name: "TV", lastSeenAt: null, revokedAt: new Date() });
    expect(await screenByToken(TOKEN)).toBeNull();
    h.prisma.screenLink.findUnique.mockResolvedValueOnce(null);
    expect(await screenByToken(TOKEN)).toBeNull();
  });

  it("stores only the hash of a new link and returns the full URL once", async () => {
    h.prisma.screenLink.create.mockResolvedValue({ id: "l9" });
    const { url } = await createScreenLink(ctx, "  Sales room TV ");
    const token = url.split("/screen/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const data = h.prisma.screenLink.create.mock.calls[0][0].data;
    expect(data).toEqual({ name: "Sales room TV", tokenHash: sha(token), createdBy: "staff:s1" });
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(token);
    await expect(createScreenLink(ctx, "   ")).rejects.toThrow(/name/);
  });

  it("notes the screen as seen at most once a minute", async () => {
    const now = new Date("2026-10-13T10:00:00Z");
    await touchScreen({ id: "l1", name: "TV", lastSeenAt: new Date(now.getTime() - 30_000) }, now);
    expect(h.prisma.screenLink.updateMany).not.toHaveBeenCalled();
    await touchScreen({ id: "l1", name: "TV", lastSeenAt: new Date(now.getTime() - 61_000) }, now);
    await touchScreen({ id: "l1", name: "TV", lastSeenAt: null }, now);
    expect(h.prisma.screenLink.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe("the screen page and its data route", () => {
  const request = () => new NextRequest(`http://localhost/screen/${TOKEN}/data`);
  const routeCtx = { params: Promise.resolve({ token: TOKEN }) };

  it("a revoked link is a 404 on the page and on the data route", async () => {
    h.prisma.screenLink.findUnique.mockResolvedValue({ id: "l1", name: "TV", lastSeenAt: null, revokedAt: new Date() });
    await expect(ScreenPage({ params: Promise.resolve({ token: TOKEN }) })).rejects.toThrow("NEXT_NOT_FOUND");
    const res = await GET(request(), routeCtx);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(h.screenData).not.toHaveBeenCalled();
  });

  it("an unknown link is a 404 too", async () => {
    h.prisma.screenLink.findUnique.mockResolvedValue(null);
    await expect(ScreenPage({ params: Promise.resolve({ token: TOKEN }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await GET(request(), routeCtx)).status).toBe(404);
  });

  it("a live link gets the data, never cached, with the cursor passed on", async () => {
    h.prisma.screenLink.findUnique.mockResolvedValue({ id: "l1", name: "TV", lastSeenAt: null, revokedAt: null });
    h.screenData.mockResolvedValue({ activeNow: 3 });
    const res = await GET(new NextRequest(`http://localhost/screen/${TOKEN}/data?after=1760000000000_abc`), routeCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ activeNow: 3 });
    expect(h.screenData).toHaveBeenCalledWith("1760000000000_abc");
    expect(h.prisma.screenLink.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe("screen rate limit", () => {
  it("rejects a malformed token without touching the database or the limiter", async () => {
    const res = await GET(new NextRequest("http://x/screen/bad/data"), { params: Promise.resolve({ token: "short" }) } as never);
    expect(res.status).toBe(404);
    expect(h.limited).not.toHaveBeenCalled();
    expect(h.prisma.screenLink.findUnique).not.toHaveBeenCalled();
  });
  it("answers 429 past 30 requests a minute from one address, before looking the token up", async () => {
    h.limited.mockResolvedValueOnce("Too many requests");
    const res = await GET(new NextRequest(`http://x/screen/${TOKEN}/data`), { params: Promise.resolve({ token: TOKEN }) } as never);
    expect(res.status).toBe(429);
    expect(h.limited).toHaveBeenCalledWith("screen", null, "198.51.100.7");
    expect(h.prisma.screenLink.findUnique).not.toHaveBeenCalled();
  });
});
