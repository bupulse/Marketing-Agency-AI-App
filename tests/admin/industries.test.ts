import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";

// Admin -> Industries: audited writes, validation, "in use" protection and "New from sign-ups" suggestions that move
// companies onto a new sector. The server actions re-check the admin (AAL2) before touching anything.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, adminAction: vi.fn(), redirect: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/console", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/console")>()), adminAction: h.adminAction }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { h.redirect(to); throw new Error(`NEXT_REDIRECT ${to}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import * as svc from "@/lib/admin/industries-service";
import { AdminError, consoleContext } from "@/lib/admin/types";
import { resetIndustryCache } from "@/lib/industries/server";

const CTX = consoleContext("198.51.100.1");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);
const audit = () => h.db.auditLog.rows;

const valid: svc.IndustryInput = {
  name: "Car wash & detailing",
  slug: "",
  shortDescription: "Car washes and detailers serving drivers and fleets in Kigali.",
  customers: "Drivers in Kigali, moto and taxi fleets, company car pools.",
  offerings: "Exterior and interior wash, polishing, engine wash, pick-up and return.",
  postIdeas: "Before and after; rainy-season mud offer (facts only).",
  tone: "Upbeat and practical.",
  hashtags: ["Kigali", "#CarWash", "#kigali"],
  seasons: "Rainy seasons bring mud; month-end is busy.",
  avoid: "No 'scratch-free guaranteed'.",
  active: true,
  sortOrder: 140,
};

function seedBusiness(id: string, over: Record<string, unknown> = {}) {
  const row = { id, userId: `u_${id}`, name: `Biz ${id}`, industry: null, industryId: null, industryOther: null, industryDescription: null, createdAt: new Date(), ...over };
  h.db.business.rows.push(row);
  return row;
}

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  resetIndustryCache();
});

describe("saveIndustry", () => {
  it("creates an industry with a slug from the name, normalised hashtags and an audit row", async () => {
    const row = await svc.saveIndustry(CTX, valid);
    expect(row).toMatchObject({ slug: "car-wash-and-detailing", name: "Car wash & detailing", hashtags: ["#Kigali", "#CarWash", "#kigali"], active: true, sortOrder: 140, businesses: 0 });
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ actor: "admin", action: "create_industry", target: `industry:${row.id}`, ip: "198.51.100.1" });
    expect(audit()[0].after).toMatchObject({ slug: "car-wash-and-detailing" });
  });

  it("validates the required fields and lengths", async () => {
    expect(await code(svc.saveIndustry(CTX, { ...valid, name: "C" }))).toBe("invalid");
    expect(await code(svc.saveIndustry(CTX, { ...valid, shortDescription: "short" }))).toBe("invalid");
    expect(await code(svc.saveIndustry(CTX, { ...valid, customers: "" }))).toBe("invalid");
    expect(await code(svc.saveIndustry(CTX, { ...valid, offerings: "" }))).toBe("invalid");
    expect(await code(svc.saveIndustry(CTX, { ...valid, tone: "ok" }))).toBe("invalid");
    expect(await code(svc.saveIndustry(CTX, { ...valid, hashtags: ["#bad tag!"] }))).toBe("invalid");
    expect(await code(svc.saveIndustry(CTX, { ...valid, hashtags: Array.from({ length: 21 }, (_, i) => `#t${i}`) }))).toBe("invalid");
    expect(await code(svc.saveIndustry(CTX, { ...valid, slug: "Not A Slug" }))).toBe("invalid");
    expect(await code(svc.saveIndustry(CTX, { ...valid, seasons: "x".repeat(1501) }))).toBe("invalid");
    expect(await code(svc.saveIndustry(CTX, { ...valid, sortOrder: 5000 }))).toBe("invalid");
    expect(h.db.industry.rows).toHaveLength(0);
    expect(audit()).toHaveLength(0);
  });

  it("keeps slugs unique and updates in place", async () => {
    const a = await svc.saveIndustry(CTX, valid);
    expect(await code(svc.saveIndustry(CTX, { ...valid, name: "Another", slug: "car-wash-and-detailing" }))).toBe("conflict");
    const b = await svc.saveIndustry(CTX, { ...valid, id: a.id, name: "Car wash", tone: "Calm and practical." });
    expect(b.id).toBe(a.id);
    expect(h.db.industry.rows).toHaveLength(1);
    expect(h.db.industry.rows[0]).toMatchObject({ name: "Car wash", tone: "Calm and practical.", slug: "car-wash-and-detailing" });
    expect(audit().map((r) => r.action)).toEqual(["create_industry", "update_industry"]);
    expect(await code(svc.saveIndustry(CTX, { ...valid, id: "missing" }))).toBe("not_found");
  });
});

describe("active, order and delete", () => {
  it("toggles active and sets the order, audited", async () => {
    const a = await svc.saveIndustry(CTX, valid);
    expect((await svc.setIndustryActive(CTX, { id: a.id, active: false })).active).toBe(false);
    expect((await svc.setIndustryOrder(CTX, { id: a.id, sortOrder: 7 })).sortOrder).toBe(7);
    expect(await code(svc.setIndustryOrder(CTX, { id: a.id, sortOrder: 1.5 }))).toBe("invalid");
    expect(audit().slice(1).map((r) => [r.action, r.before, r.after])).toEqual([
      ["update_industry", { active: true }, { active: false }],
      ["update_industry", { sortOrder: 140 }, { sortOrder: 7 }],
    ]);
  });

  it("cannot delete an industry in use; one nobody uses goes with an audit row", async () => {
    const a = await svc.saveIndustry(CTX, valid);
    seedBusiness("b1", { industryId: a.id, industry: a.name });
    await expect(svc.deleteIndustry(CTX, { id: a.id })).rejects.toMatchObject({ code: "conflict", message: expect.stringMatching(/1 company.*Deactivate/) });
    expect(h.db.industry.rows).toHaveLength(1);
    h.db.business.rows.length = 0;
    expect(await svc.deleteIndustry(CTX, { id: a.id })).toEqual({ id: a.id, name: a.name });
    expect(h.db.industry.rows).toHaveLength(0);
    expect(audit()[audit().length - 1]).toMatchObject({ action: "delete_industry", target: `industry:${a.id}`, after: undefined });
  });
});

describe("suggestions from sign-ups", () => {
  it("groups Other texts case-insensitively with counts and sample descriptions, most frequent first", async () => {
    seedBusiness("b1", { industryOther: "Car wash", industry: "Car wash", industryDescription: "We wash cars in Remera." });
    seedBusiness("b2", { industryOther: "  car WASH ", industry: "car WASH", industryDescription: "Mobile car washing in Kigali." });
    seedBusiness("b3", { industryOther: "Poultry farm", industry: "Poultry farm", industryDescription: "Eggs and chickens in Musanze." });
    seedBusiness("b4", { industryId: "ind_x", industry: "Shops & retail" });
    const list = await svc.listIndustrySuggestions();
    expect(list.map((s) => [s.key, s.count])).toEqual([["car wash", 2], ["poultry farm", 1]]);
    expect(list[0].samples).toEqual(["We wash cars in Remera.", "Mobile car washing in Kigali."]);
    expect(list[0].businessIds.sort()).toEqual(["b1", "b2"]);
    expect(svc.draftShortDescription(list[0])).toBe("We wash cars in Remera.");
  });

  it("dismisses and restores a suggestion, audited; the companies keep their text", async () => {
    seedBusiness("b1", { industryOther: "Car wash", industryDescription: "We wash cars." });
    await svc.dismissIndustrySuggestion(CTX, { key: "Car Wash" });
    expect(await svc.listIndustrySuggestions()).toEqual([]);
    expect(await svc.listIndustrySuggestions({ includeDismissed: true })).toHaveLength(1);
    expect(h.db.business.rows[0].industryOther).toBe("Car wash");
    expect(audit()[0]).toMatchObject({ action: "dismiss_industry_suggestion", target: "industry_suggestion:car wash", after: { label: "Car wash" } });
    await svc.restoreIndustrySuggestion(CTX, { key: "car wash" });
    expect(await svc.listIndustrySuggestions()).toHaveLength(1);
    expect(await code(svc.dismissIndustrySuggestion(CTX, { key: "nothing" }))).toBe("not_found");
  });

  it("'Add as industry' creates the sector and moves exactly the matching companies to it, each audited", async () => {
    seedBusiness("b1", { industryOther: "Car wash", industry: "Car wash", industryDescription: "We wash cars." });
    seedBusiness("b2", { industryOther: "CAR WASH", industry: "CAR WASH" });
    seedBusiness("b3", { industryOther: "Poultry farm", industry: "Poultry farm" });
    await svc.dismissIndustrySuggestion(CTX, { key: "car wash" });
    const { industry, moved } = await svc.createIndustryFromSuggestion(CTX, { ...valid, suggestionKey: "Car wash" });
    expect(moved).toBe(2);
    expect(industry.businesses).toBe(2);
    const by = (id: string) => h.db.business.rows.find((b) => b.id === id)!;
    expect(by("b1")).toMatchObject({ industryId: industry.id, industryOther: null, industry: "Car wash & detailing" });
    expect(by("b2")).toMatchObject({ industryId: industry.id, industryOther: null, industry: "Car wash & detailing" });
    expect(by("b3")).toMatchObject({ industryId: null, industryOther: "Poultry farm" });
    expect(h.db.dismissedIndustrySuggestion.rows).toHaveLength(0);
    const actions = audit().map((r) => r.action);
    expect(actions.filter((a) => a === "update_company_industry")).toHaveLength(2);
    expect(actions).toContain("create_industry");
    expect(audit().find((r) => r.target === "business:b1")).toMatchObject({ before: { industryId: null, industryOther: "Car wash" }, after: { industryId: industry.id, industryOther: null } });
    expect((await svc.listIndustrySuggestions()).map((s) => s.key)).toEqual(["poultry farm"]);
  });

  it("refuses to create from a suggestion when the slug is taken", async () => {
    await svc.saveIndustry(CTX, valid);
    seedBusiness("b1", { industryOther: "Car wash" });
    expect(await code(svc.createIndustryFromSuggestion(CTX, { ...valid, suggestionKey: "car wash" }))).toBe("conflict");
    expect(h.db.business.rows[0].industryId).toBeNull();
  });
});

describe("server actions", () => {
  it("re-check the admin (AAL2) before anything is written", async () => {
    h.adminAction.mockRejectedValue(new Error("NEXT_REDIRECT /admin/verify"));
    const { saveIndustryAction, deleteIndustryAction } = await import("@/app/admin/(console)/industries/actions");
    const f = new FormData();
    for (const [k, v] of Object.entries({ ...valid, hashtags: valid.hashtags!.join(" "), active: "on", sortOrder: "140" })) f.set(k, String(v));
    await expect(saveIndustryAction({}, f)).rejects.toThrow("NEXT_REDIRECT /admin/verify");
    await expect(deleteIndustryAction(f)).rejects.toThrow("NEXT_REDIRECT /admin/verify");
    expect(h.db.industry.rows).toHaveLength(0);
    expect(audit()).toHaveLength(0);
  });

  it("save returns the validation message instead of throwing, and redirects with a notice on success", async () => {
    h.adminAction.mockResolvedValue(CTX);
    const { saveIndustryAction } = await import("@/app/admin/(console)/industries/actions");
    const f = new FormData();
    for (const [k, v] of Object.entries({ ...valid, hashtags: valid.hashtags!.join(" "), active: "on", sortOrder: "140" })) f.set(k, String(v));
    f.set("tone", "");
    expect(await saveIndustryAction({}, f)).toEqual({ error: expect.stringMatching(/tone of voice/i) });
    f.set("tone", "Upbeat.");
    await expect(saveIndustryAction({}, f)).rejects.toThrow("NEXT_REDIRECT /admin/industries?notice=");
    expect(h.redirect.mock.calls[0][0]).toContain(encodeURIComponent("Car wash & detailing saved."));
    expect(h.db.industry.rows).toHaveLength(1);
  });
});
