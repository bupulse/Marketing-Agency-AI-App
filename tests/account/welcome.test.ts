import { beforeEach, describe, expect, it, vi } from "vitest";

// /welcome (Google sign-ups): the country, the pricing region and the time zone are set once, on the first save. A
// server action is a public POST, so a second call may change the business details but never the region.

const h = vi.hoisted(() => ({ requireActiveUser: vi.fn(), updateMany: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: h.requireActiveUser }));
vi.mock("@/lib/db", () => ({ prisma: { business: { updateMany: h.updateMany, update: h.update } } }));
vi.mock("@/lib/region", () => ({ regionFromCountryName: async (name: string) => (name === "Rwanda" ? "RW" : "GLOBAL") }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));

const form = (country: string) => {
  const f = new FormData();
  f.set("organisationName", "Inzu Fashion");
  f.set("ceoName", "Aline Uwase");
  f.set("industry", "Shops & retail");
  f.set("country", country);
  f.set("phone", "");
  f.set("website", "");
  f.set("terms", "true");
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireActiveUser.mockResolvedValue({ id: "u1", businessId: "b1", role: "OWNER" });
});

describe("saveOrganisation", () => {
  it("sets the country, region and zone on the first save only; a later call changes the details but not the region", async () => {
    const { saveOrganisation } = await import("@/app/welcome/actions");
    h.updateMany.mockResolvedValue({ count: 1 });
    await expect(saveOrganisation({}, form("Rwanda"))).rejects.toThrow("NEXT_REDIRECT /onboarding");
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", detailsCompletedAt: null },
      data: expect.objectContaining({ name: "Inzu Fashion", country: "Rwanda", pricingRegion: "RW", timezone: "Africa/Kigali", detailsCompletedAt: expect.any(Date) }),
    });
    expect(h.update).not.toHaveBeenCalled();
    // Details already saved: the same action (replayed) touches neither country nor region.
    h.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveOrganisation({}, form("Rwanda"))).rejects.toThrow("NEXT_REDIRECT /onboarding");
    expect(h.update).toHaveBeenCalledWith({ where: { userId: "u1" }, data: { name: "Inzu Fashion", ceoName: "Aline Uwase", industry: "Shops & retail", phone: null, website: null } });
    expect(JSON.stringify(h.update.mock.calls[0][0])).not.toMatch(/pricingRegion|country|timezone/);
  });

  it("leaves the zone alone for a country without one of its own", async () => {
    const { saveOrganisation } = await import("@/app/welcome/actions");
    h.updateMany.mockResolvedValue({ count: 1 });
    await expect(saveOrganisation({}, form("France"))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.updateMany.mock.calls[0][0].data).toMatchObject({ pricingRegion: "GLOBAL" });
    expect(h.updateMany.mock.calls[0][0].data).not.toHaveProperty("timezone");
  });
});
