import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ business: { findUnique: vi.fn() }, lead: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma }));
const checkActiveUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require-user", () => ({ checkActiveUser }));

import { GET } from "@/app/api/leads/export/route";

const call = (qs = "") => GET(new NextRequest(`https://bupulse.test/api/leads/export${qs}`));

describe("/api/leads/export", () => {
  beforeEach(() => {
    prisma.business.findUnique.mockReset().mockResolvedValue({ id: "b1" });
    prisma.lead.findMany.mockReset().mockResolvedValue([{ id: "l1", createdAt: new Date("2026-10-08T00:00:00Z"), name: "@x", email: null, phone: null, interest: null, message: null, source: "website_chat", status: "NEW", notes: null, pageUrl: null }]);
    checkActiveUser.mockReset().mockResolvedValue({ status: "ok", user: { id: "u1" } });
  });
  it("rejects signed-out and locked users", async () => {
    checkActiveUser.mockResolvedValue({ status: "signed_out" });
    expect((await call()).status).toBe(401);
    checkActiveUser.mockResolvedValue({ status: "locked" });
    expect((await call()).status).toBe(403);
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
  });
  it("exports only the owner's leads, with the filters", async () => {
    const response = await call("?status=won&q=cake&businessId=evil");
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(await response.text()).toContain("'@x");
    const where = prisma.lead.findMany.mock.calls[0][0].where;
    expect(prisma.business.findUnique.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(where).toMatchObject({ businessId: "b1", status: "WON" });
  });
});
