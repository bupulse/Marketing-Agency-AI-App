import { beforeEach, describe, expect, it, vi } from "vitest";

// The Regions page actions and the plan form's regions: each re-checks the admin with plans.manage (the same
// permission as Plans) before any service runs, and a refused admin changes nothing.

const h = vi.hoisted(() => ({
  adminAction: vi.fn(),
  finish: vi.fn(async (back: string, ok: unknown, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      return { back, notice: typeof ok === "function" ? (ok as (x: unknown) => string)(r) : ok };
    } catch (e) {
      return { back, error: (e as Error).message };
    }
  }),
  svc: { saveRegion: vi.fn(), deleteRegion: vi.fn(), moveRegion: vi.fn(), setRegionPrice: vi.fn(), removeRegionPrice: vi.fn(), regionKeyFromName: (n: string) => n.toUpperCase().replace(/\W+/g, "_") },
}));

vi.mock("@/lib/admin/console", () => ({ adminAction: h.adminAction, finish: h.finish, actionMessage: (e: unknown) => (e as Error).message }));
vi.mock("@/lib/admin/regions-service", () => h.svc);

import { deleteRegionAction, moveRegionAction, saveRegionAction } from "@/app/admin/(console)/(system)/settings/regions/actions";

const CTX = { actor: "admin", ip: null, viaApi: false };
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.adminAction.mockResolvedValue(CTX);
});

describe("region actions", () => {
  it("check plans.manage first; a refused admin never reaches the service", async () => {
    h.adminAction.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(saveRegionAction(form({ name: "West Africa", currency: "USD", countries: ["NG"] }))).rejects.toThrow("Forbidden");
    h.adminAction.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(deleteRegionAction(form({ key: "EAC" }))).rejects.toThrow("Forbidden");
    h.adminAction.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(moveRegionAction(form({ key: "EAC", direction: "up" }))).rejects.toThrow("Forbidden");
    expect(h.svc.saveRegion).not.toHaveBeenCalled();
    expect(h.svc.deleteRegion).not.toHaveBeenCalled();
    expect(h.svc.moveRegion).not.toHaveBeenCalled();
    expect(h.adminAction.mock.calls.every(([perm]) => perm === "plans.manage")).toBe(true);
  });

  it("save passes the status, countries, VAT (percent to basis points) and the move choice, as the admin's context", async () => {
    h.svc.saveRegion.mockResolvedValue({ key: "WEST_AFRICA", name: "West Africa" });
    await saveRegionAction(form({ isNew: "1", name: "West Africa", currency: "usd", countries: ["NG", "GH"], paymentMethods: ["card"], status: "LIVE", vatPercent: "7.5", vatLabel: "VAT", move: "1" }));
    expect(h.adminAction).toHaveBeenCalledWith("plans.manage");
    expect(h.svc.saveRegion).toHaveBeenCalledWith(CTX, expect.objectContaining({ key: "WEST_AFRICA", countries: ["NG", "GH"], active: true, vatRateBps: 750, move: true, isNew: true }));
    expect(h.finish).toHaveBeenLastCalledWith("/admin/settings/regions/WEST_AFRICA", "West Africa created.", expect.any(Function));
  });

  it("a bad VAT rate is refused before the service; a failed new region goes back to the new-region page", async () => {
    await saveRegionAction(form({ isNew: "1", name: "X", currency: "USD", countries: ["NG"], vatPercent: "120" }));
    expect(h.svc.saveRegion).not.toHaveBeenCalled();
    expect(await h.finish.mock.results.at(-1)?.value).toMatchObject({ back: "/admin/settings/regions/new", error: expect.stringMatching(/VAT is a percentage/) });
  });

  it("delete goes back to the list when it worked and to the region when it was refused", async () => {
    h.svc.deleteRegion.mockResolvedValueOnce({ key: "EAC", name: "East Africa" });
    await deleteRegionAction(form({ key: "EAC" }));
    expect(h.finish.mock.calls.at(-1)?.[0]).toBe("/admin/settings/regions");
    h.svc.deleteRegion.mockRejectedValueOnce(new Error("Starter is offered only in Rwanda."));
    await deleteRegionAction(form({ key: "RW" }));
    expect(await h.finish.mock.results.at(-1)?.value).toMatchObject({ back: "/admin/settings/regions/RW", error: "Starter is offered only in Rwanda." });
  });
});
