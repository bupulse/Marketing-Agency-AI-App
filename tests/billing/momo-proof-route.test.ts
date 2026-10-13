import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin console's screenshot route: AAL2 admins only, bytes re-sniffed, served so nothing in them can run.

const h = vi.hoisted(() => ({ admin: vi.fn(async () => true), find: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ isAdminSession: h.admin }));
vi.mock("@/lib/db", () => ({ prisma: { manualPayment: { findUnique: h.find } } }));
vi.mock("@/lib/billing/momo-proofs", () => ({ readProofObject: h.read }));

import { GET } from "@/app/admin/(console)/payments/proof/route";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const get = (id = "pay1") => GET(new Request(`https://bupulse.com/admin/payments/proof?id=${id}`));

beforeEach(() => {
  h.admin.mockReset().mockResolvedValue(true);
  h.find.mockReset().mockResolvedValue({ proofPath: "verified/u/pay1/x.png", proofBytes: PNG.length, reference: "BP-7K3Q" });
  h.read.mockReset().mockResolvedValue({ bytes: PNG, type: "image/png" });
});

describe("GET /admin/payments/proof", () => {
  it("serves the checked copy with its sniffed type, nosniff, inline, sandboxed and never cached", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="BP-7K3Q.png"');
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(h.read).toHaveBeenCalledWith("verified/u/pay1/x.png");
  });

  it("is a 404 for anyone but an admin, an unchecked screenshot, or bytes that no longer sniff as an image", async () => {
    h.admin.mockResolvedValueOnce(false);
    expect((await get()).status).toBe(404);
    expect(h.find).not.toHaveBeenCalled();
    h.find.mockResolvedValueOnce({ proofPath: "u/pay1/x.png", proofBytes: null, reference: "BP-7K3Q" });
    expect((await get()).status).toBe(404);
    h.read.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);
    expect((await get("")).status).toBe(404);
  });
});
