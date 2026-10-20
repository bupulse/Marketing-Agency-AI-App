/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real testimonials on the marketing site: the form's rules, the photo check, audited admin writes, the cached public
// read (published and consented only, [] on a database error) and the home section that hides itself when empty.
// No database: a small in-memory SiteTestimonial table.

vi.setConfig({ testTimeout: 30_000 });

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state = { rows: [] as Row[], audit: [] as Row[], seq: 0, fail: false };
  const find = (where: Row = {}) => (r: Row) => Object.entries(where).every(([k, v]) => r[k] === v);
  const sort = (rows: Row[], orderBy: Row | Row[] | undefined) => {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map((o) => Object.entries(o)[0] as [string, "asc" | "desc"]);
    return [...rows].sort((a, b) => {
      for (const [k, dir] of keys) if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (dir === "desc" ? -1 : 1);
      return 0;
    });
  };
  const pick = (r: Row, select?: Row) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r });
  const guard = () => {
    if (state.fail) throw new Error("connection refused");
  };
  const siteTestimonial = {
    findMany: vi.fn(async (a: Row = {}) => (guard(), sort(state.rows.filter(find(a.where)), a.orderBy).map((r) => pick(r, a.select)))),
    findFirst: vi.fn(async (a: Row = {}) => {
      const r = sort(state.rows.filter(find(a.where)), a.orderBy)[0];
      return r ? pick(r, a.select) : null;
    }),
    findUnique: vi.fn(async (a: Row) => {
      const r = state.rows.find(find(a.where));
      return r ? { ...r } : null;
    }),
    create: vi.fn(async ({ data }: Row) => {
      // The database's CHECK: never published without consent.
      if (data.published && !data.consent) throw new Error("violates check constraint SiteTestimonial_consent_check");
      const row = { id: `t${++state.seq}`, sector: null, result: null, photo: null, consent: false, published: false, position: 0, createdAt: new Date(2026, 9, state.seq), updatedAt: new Date(), ...data };
      state.rows.push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const row = state.rows.find(find(where));
      if (!row) throw new Error("Record not found");
      Object.assign(row, data);
      if (row.published && !row.consent) throw new Error("violates check constraint SiteTestimonial_consent_check");
      return { ...row };
    }),
    delete: vi.fn(async ({ where }: Row) => {
      const i = state.rows.findIndex(find(where));
      return state.rows.splice(i, 1)[0];
    }),
  };
  const db = {
    siteTestimonial,
    auditLog: { create: vi.fn(async ({ data }: Row) => state.audit.push(data)) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { state, db, logError: vi.fn(async () => {}) };
});

vi.mock("@/lib/db", () => ({ prisma: h.db }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: h.logError }));

import { consoleContext } from "@/lib/admin/types";
import { LIMITS, NO_CONSENT, PHOTO_MAX_BYTES, testimonialState, validateTestimonial } from "@/lib/testimonials/shared";
import * as svc from "@/lib/testimonials/service";
import { Testimonials } from "@/components/marketing/home/testimonials";

const CTX = consoleContext("198.51.100.7");
const good = { clientName: "Aline M.", business: "Sunrise Bakery", sector: "Bakery, Kigali", quote: "We posted every day for a month and the phone kept ringing.", result: "12 orders on WhatsApp in a week", consent: true, published: false };
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};
const rejects = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

/** A header-only JPEG (SOI, APP0, SOF0) of the given size, padded with an APP1 segment to reach `bytes`. */
function jpeg(width: number, height: number, bytes = 0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const head = [0xff, 0xd8, ...app0, ...sof];
  const pad = Math.max(0, bytes - head.length - 2 - 4);
  const app1 = pad > 0 ? [0xff, 0xe1, (pad + 2) >> 8, (pad + 2) & 0xff, ...new Array(pad).fill(0)] : [];
  return Uint8Array.from([...head, ...app1, 0xff, 0xd9]);
}
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

beforeEach(() => {
  Object.assign(h.state, { rows: [], audit: [], seq: 0, fail: false });
  vi.clearAllMocks();
  svc.clearTestimonialCache();
});

describe("validateTestimonial", () => {
  it("needs the name, the business and a quote of 20 to 400 characters", () => {
    expect(err(() => validateTestimonial({ ...good, clientName: " " }))).toBe("The client's name is required.");
    expect(err(() => validateTestimonial({ ...good, business: "" }))).toBe("The business name is required.");
    expect(err(() => validateTestimonial({ ...good, quote: "" }))).toBe("The quote is required.");
    expect(err(() => validateTestimonial({ ...good, quote: "Too short." }))).toBe("The quote needs at least 20 characters.");
    expect(err(() => validateTestimonial({ ...good, quote: "x".repeat(LIMITS.quote + 1) }))).toBe("The quote must be 400 characters or fewer.");
  });

  it("keeps names, sector and result short", () => {
    expect(err(() => validateTestimonial({ ...good, clientName: "x".repeat(81) }))).toBe("The client's name must be 80 characters or fewer.");
    expect(err(() => validateTestimonial({ ...good, sector: "x".repeat(61) }))).toBe("The sector must be 60 characters or fewer.");
    expect(err(() => validateTestimonial({ ...good, result: "x".repeat(121) }))).toBe("The result must be 120 characters or fewer.");
  });

  it("refuses to publish without consent, and turns empty optional fields into null", () => {
    expect(err(() => validateTestimonial({ ...good, consent: false, published: true }))).toBe(NO_CONSENT);
    expect(validateTestimonial({ ...good, sector: " ", result: "" })).toMatchObject({ sector: null, result: null, clientName: "Aline M." });
  });

  it("names the state the admin list shows", () => {
    expect(testimonialState({ consent: false, published: false })).toBe("no_consent");
    expect(testimonialState({ consent: true, published: false })).toBe("hidden");
    expect(testimonialState({ consent: true, published: true })).toBe("published");
  });
});

describe("checkPhoto", () => {
  it("accepts a small JPEG and returns its bytes", () => {
    const photo = jpeg(160, 160, 4000);
    expect(svc.checkPhoto(b64(photo))).toEqual(photo);
    expect(svc.checkPhoto(`data:image/jpeg;base64,${b64(photo)}`)).toEqual(photo);
    expect(svc.checkPhoto("")).toBeNull();
    expect(svc.checkPhoto(null)).toBeNull();
  });

  it("refuses anything that is not a JPEG", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    expect(err(() => svc.checkPhoto(b64(png)))).toBe("The photo must be a JPEG picture. Choose it again.");
    expect(err(() => svc.checkPhoto("not base64 at all!"))).toMatch(/too large or not a picture/);
  });

  it("refuses a photo over 60 KB or over 400 pixels a side", () => {
    expect(err(() => svc.checkPhoto(b64(jpeg(160, 160, PHOTO_MAX_BYTES + 10))))).toMatch(/too large/);
    expect(err(() => svc.checkPhoto(b64(jpeg(160, 160, 200 * 1024))))).toMatch(/too large/);
    expect(err(() => svc.checkPhoto(b64(jpeg(500, 160, 2000))))).toBe("The photo is too large (over 400 pixels on a side). Choose it again.");
  });
});

describe("admin writes", () => {
  it("adds testimonials at the end, with an audit row that says whether there is a photo (never its bytes)", async () => {
    const a = await svc.createTestimonial(CTX, { ...good, photo: b64(jpeg(160, 160, 3000)) });
    const b = await svc.createTestimonial(CTX, { ...good, clientName: "Eric N." });
    expect([a.position, b.position]).toEqual([0, 1]);
    expect(a.createdBy).toBe("admin");
    expect(h.state.audit).toHaveLength(2);
    expect(h.state.audit[0]).toMatchObject({ actor: "admin", action: "create_testimonial", target: `testimonial:${a.id}`, ip: "198.51.100.7", before: undefined });
    expect(h.state.audit[0].after).toMatchObject({ clientName: "Aline M.", hasPhoto: true, consent: true, published: false });
    expect(JSON.stringify(h.state.audit[0])).not.toContain("photo\":");
    expect(h.db.$transaction).toHaveBeenCalledTimes(2);
  });

  it("refuses to save a published testimonial without consent, and writes nothing", async () => {
    expect(await rejects(svc.createTestimonial(CTX, { ...good, consent: false, published: true }))).toBe(NO_CONSENT);
    expect(h.state.rows).toEqual([]);
    expect(h.state.audit).toEqual([]);
  });

  it("edits and audits before and after; keeps the photo unless removed", async () => {
    const t = await svc.createTestimonial(CTX, { ...good, photo: b64(jpeg(160, 160, 3000)) });
    await svc.updateTestimonial(CTX, t.id, { ...good, quote: "BuPulse writes our posts and customers now find us on Instagram." });
    expect(h.state.rows[0].photo).not.toBeNull();
    expect(h.state.audit[1]).toMatchObject({ action: "update_testimonial", target: `testimonial:${t.id}` });
    expect(h.state.audit[1].before.quote).toBe(good.quote);
    expect(h.state.audit[1].after.quote).toMatch(/Instagram/);
    await svc.updateTestimonial(CTX, t.id, { ...good, removePhoto: true });
    expect(h.state.rows[0].photo).toBeNull();
    expect(h.state.audit[2].after.hasPhoto).toBe(false);
    expect(await rejects(svc.updateTestimonial(CTX, "nope", good))).toBe("That testimonial does not exist any more.");
  });

  it("publishes only with consent; publish and unpublish are audited", async () => {
    const yes = await svc.createTestimonial(CTX, good);
    const no = await svc.createTestimonial(CTX, { ...good, consent: false });
    expect(await rejects(svc.setTestimonialPublished(CTX, no.id, true))).toBe(NO_CONSENT);
    await svc.setTestimonialPublished(CTX, yes.id, true);
    await svc.setTestimonialPublished(CTX, yes.id, false);
    expect(h.state.audit.slice(2).map((a) => [a.action, a.before, a.after])).toEqual([
      ["publish_testimonial", { published: false }, { published: true }],
      ["unpublish_testimonial", { published: true }, { published: false }],
    ]);
  });

  it("moves one place up or down (audited), and does nothing past the ends", async () => {
    const a = await svc.createTestimonial(CTX, { ...good, clientName: "A" });
    await svc.createTestimonial(CTX, { ...good, clientName: "B" });
    const c = await svc.createTestimonial(CTX, { ...good, clientName: "C" });
    await svc.moveTestimonial(CTX, c.id, "up");
    const order = () => [...h.state.rows].sort((x, y) => x.position - y.position).map((r) => r.clientName);
    expect(order()).toEqual(["A", "C", "B"]);
    expect(h.state.audit.at(-1)).toMatchObject({ action: "move_testimonial", target: `testimonial:${c.id}`, before: { position: 2 }, after: { position: 1, direction: "up" } });
    await svc.moveTestimonial(CTX, a.id, "up");
    expect(order()).toEqual(["A", "C", "B"]);
    await svc.moveTestimonial(CTX, a.id, "down");
    expect(order()).toEqual(["C", "A", "B"]);
  });

  it("deletes with an audit row holding what was removed", async () => {
    const t = await svc.createTestimonial(CTX, good);
    await svc.deleteTestimonial(CTX, t.id);
    expect(h.state.rows).toEqual([]);
    expect(h.state.audit[1]).toMatchObject({ action: "delete_testimonial", target: `testimonial:${t.id}`, after: undefined });
    expect(h.state.audit[1].before).toMatchObject({ clientName: "Aline M.", hasPhoto: false });
  });
});

describe("publishedTestimonials", () => {
  it("returns only published and consented ones, in order, with the photo as a data URL", async () => {
    const photo = jpeg(160, 160, 2000);
    h.state.rows.push(
      { id: "x1", clientName: "Second", business: "B", sector: null, quote: "q", result: null, photo: null, consent: true, published: true, position: 2, createdAt: new Date(1) },
      { id: "x2", clientName: "Hidden", business: "B", sector: null, quote: "q", result: null, photo: null, consent: true, published: false, position: 0, createdAt: new Date(1) },
      // Not reachable through the app (the CHECK refuses it), but the read never trusts that alone.
      { id: "x3", clientName: "No consent", business: "B", sector: null, quote: "q", result: null, photo: null, consent: false, published: true, position: 0, createdAt: new Date(1) },
      { id: "x4", clientName: "First", business: "B", sector: "Shop", quote: "q", result: "r", photo, consent: true, published: true, position: 1, createdAt: new Date(1) },
    );
    const list = await svc.publishedTestimonials();
    expect(list.map((t) => t.clientName)).toEqual(["First", "Second"]);
    expect(list[0].photoUrl).toBe(`data:image/jpeg;base64,${b64(photo)}`);
    expect(list[1].photoUrl).toBeNull();
    expect(list[0]).not.toHaveProperty("photo");
  });

  it("is cached for a minute, and an admin write clears the cache", async () => {
    await svc.publishedTestimonials();
    await svc.publishedTestimonials();
    expect(h.db.siteTestimonial.findMany).toHaveBeenCalledTimes(1);
    const t = await svc.createTestimonial(CTX, { ...good, published: true });
    expect((await svc.publishedTestimonials()).map((x) => x.id)).toEqual([t.id]);
    expect(h.db.siteTestimonial.findMany).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list on a database error, after logging it", async () => {
    h.state.fail = true;
    expect(await svc.publishedTestimonials()).toEqual([]);
    expect(h.logError).toHaveBeenCalledWith(expect.any(Error), { source: "testimonials.published" });
  });
});

describe("the home page section", () => {
  it("renders nothing at all without a published testimonial", async () => {
    h.state.rows.push({ id: "x", clientName: "Hidden", business: "B", sector: null, quote: "q", result: null, photo: null, consent: true, published: false, position: 0, createdAt: new Date(1) });
    expect(await Testimonials()).toBeNull();
  });

  it("renders nothing when the database is down", async () => {
    h.state.fail = true;
    expect(await Testimonials()).toBeNull();
  });

  it("shows the quote, the highlighted result, the name, business and sector", async () => {
    await svc.createTestimonial(CTX, { ...good, published: true, photo: b64(jpeg(160, 160, 2000)) });
    const el = await Testimonials();
    const html = renderToStaticMarkup(el!);
    expect(html).toContain("Business owners like you");
    expect(html).toContain(good.quote);
    expect(html).toContain("12 orders on WhatsApp in a week");
    expect(html).toContain("Aline M.");
    expect(html).toContain("Sunrise Bakery · Bakery, Kigali");
    expect(html).toContain('src="data:image/jpeg;base64,');
  });
});
