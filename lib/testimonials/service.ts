import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { logError } from "@/lib/errors";
import { imageSize, sniffImage } from "@/lib/publishing/jpeg";
import { NO_CONSENT, PHOTO_MAX_BYTES, PHOTO_MAX_PIXELS, validateTestimonial, type TestimonialInput } from "./shared";

// Real testimonials on the marketing site (Admin -> Content -> Testimonials, docs/guide/features/34-testimonials.md).
// Every change writes an audit row in the same transaction. The public read is cached for a minute; admin writes clear
// it so the admin's own server sees the change at once.

/** What the admin form sends. `photo` is a new photo as base64 JPEG; `removePhoto` drops the stored one. */
export type TestimonialSave = TestimonialInput & { photo?: string | null; removePhoto?: boolean };

/** One testimonial as the home and pricing pages show it. */
export type PublicTestimonial = { id: string; clientName: string; business: string; sector: string | null; quote: string; result: string | null; photoUrl: string | null };

type Row = { id: string; clientName: string; business: string; sector: string | null; quote: string; result: string | null; photo: Uint8Array | null; consent: boolean; published: boolean; position: number };

const ORDER = [{ position: "asc" as const }, { createdAt: "asc" as const }];

/** The audit snapshot: everything but the photo bytes (only whether there is one). */
const snapshot = (r: Row) => ({ clientName: r.clientName, business: r.business, sector: r.sector, quote: r.quote, result: r.result, consent: r.consent, published: r.published, position: r.position, hasPhoto: Boolean(r.photo?.length) });

export const photoUrl = (photo: Uint8Array | null | undefined) => (photo?.length ? `data:image/jpeg;base64,${Buffer.from(photo).toString("base64")}` : null);

/** The photo from the form, checked: a real JPEG, at most 60 KB and 400 pixels a side. Null when none was sent. */
export function checkPhoto(base64: string | null | undefined): Uint8Array<ArrayBuffer> | null {
  const text = (base64 ?? "").trim().replace(/^data:image\/jpeg;base64,/, "");
  if (!text) return null;
  // Base64 is a third bigger than the bytes: refuse a huge string before decoding it.
  if (text.length > Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+=*$/.test(text)) throw new AdminError("invalid", "The photo is too large or not a picture. Choose it again.");
  const bytes = Uint8Array.from(Buffer.from(text, "base64"));
  if (sniffImage(bytes) !== "jpeg") throw new AdminError("invalid", "The photo must be a JPEG picture. Choose it again.");
  if (bytes.length > PHOTO_MAX_BYTES) throw new AdminError("invalid", "The photo is too large (over 60 KB). Choose it again.");
  const size = imageSize(bytes);
  if (!size || size.width < 1 || size.height < 1) throw new AdminError("invalid", "The photo could not be read. Choose another one.");
  if (size.width > PHOTO_MAX_PIXELS || size.height > PHOTO_MAX_PIXELS) throw new AdminError("invalid", `The photo is too large (over ${PHOTO_MAX_PIXELS} pixels on a side). Choose it again.`);
  return bytes;
}

export async function listTestimonialsAdmin() {
  const rows = await prisma.siteTestimonial.findMany({ orderBy: ORDER });
  return rows.map((r) => ({ ...r, photoUrl: photoUrl(r.photo) }));
}

export async function getTestimonialAdmin(id: string) {
  const row = await prisma.siteTestimonial.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "That testimonial does not exist any more.");
  return { ...row, photoUrl: photoUrl(row.photo) };
}

async function existing(id: string): Promise<Row> {
  const row = await prisma.siteTestimonial.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "That testimonial does not exist any more.");
  return row;
}

/** Adds one at the end of the list. */
export async function createTestimonial(ctx: AdminContext, input: TestimonialSave) {
  const fields = validateTestimonial(input);
  const photo = checkPhoto(input.photo);
  const row = await prisma.$transaction(async (tx) => {
    const last = await tx.siteTestimonial.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const created = await tx.siteTestimonial.create({ data: { ...fields, photo, position: (last?.position ?? -1) + 1, createdBy: ctx.actor } });
    await writeAudit(tx, ctx, "create_testimonial", `testimonial:${created.id}`, null, snapshot(created));
    return created;
  });
  clearTestimonialCache();
  return row;
}

/** Edits the words, consent and publishing. The photo is kept unless a new one is sent or `removePhoto` is set. */
export async function updateTestimonial(ctx: AdminContext, id: string, input: TestimonialSave) {
  const fields = validateTestimonial(input);
  const photo = checkPhoto(input.photo);
  const before = await existing(id);
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.siteTestimonial.update({ where: { id }, data: { ...fields, ...(photo ? { photo } : input.removePhoto ? { photo: null } : {}) } });
    await writeAudit(tx, ctx, "update_testimonial", `testimonial:${id}`, snapshot(before), snapshot(saved));
    return saved;
  });
  clearTestimonialCache();
  return row;
}

/** Shows it on the site, or hides it. Publishing needs the client's consent. */
export async function setTestimonialPublished(ctx: AdminContext, id: string, published: boolean) {
  const before = await existing(id);
  if (published && !before.consent) throw new AdminError("invalid", NO_CONSENT);
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.siteTestimonial.update({ where: { id }, data: { published } });
    await writeAudit(tx, ctx, published ? "publish_testimonial" : "unpublish_testimonial", `testimonial:${id}`, { published: before.published }, { published });
    return saved;
  });
  clearTestimonialCache();
  return row;
}

/**
 * Moves one place up or down. The whole list is renumbered 0, 1, 2... in the new order, so rows that share a position
 * (all start at 0 if added by hand in the database) still move predictably. Already first (or last): nothing changes.
 */
export async function moveTestimonial(ctx: AdminContext, id: string, direction: "up" | "down") {
  const row = await prisma.$transaction(async (tx) => {
    const rows = await tx.siteTestimonial.findMany({ orderBy: ORDER, select: { id: true, clientName: true, position: true } });
    const from = rows.findIndex((r) => r.id === id);
    if (from < 0) throw new AdminError("not_found", "That testimonial does not exist any more.");
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= rows.length) return rows[from];
    const order = [...rows];
    [order[from], order[to]] = [order[to], order[from]];
    for (const [i, r] of order.entries()) if (r.position !== i) await tx.siteTestimonial.update({ where: { id: r.id }, data: { position: i } });
    await writeAudit(tx, ctx, "move_testimonial", `testimonial:${id}`, { position: rows[from].position }, { position: to, direction });
    return { ...rows[from], position: to };
  });
  clearTestimonialCache();
  return row;
}

export async function deleteTestimonial(ctx: AdminContext, id: string) {
  const before = await existing(id);
  await prisma.$transaction(async (tx) => {
    await tx.siteTestimonial.delete({ where: { id } });
    await writeAudit(tx, ctx, "delete_testimonial", `testimonial:${id}`, snapshot(before), null);
  });
  clearTestimonialCache();
  return before;
}

// ---- The public read (home and pricing pages) ----------------------------------------------------------------

const TTL_MS = 60_000;
let cached: { at: number; rows: PublicTestimonial[] } | null = null;

/** Marks the cache stale. Admin writes call it; other servers catch up within a minute. */
export function clearTestimonialCache() {
  cached = null;
}

/**
 * Published testimonials the client agreed to, in the admin's order, photos as data URLs. On a database error: an
 * empty list (the section then does not show), logged and not cached, so the next visit tries again.
 */
export async function publishedTestimonials(): Promise<PublicTestimonial[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rows;
  try {
    const rows = await prisma.siteTestimonial.findMany({
      where: { published: true, consent: true },
      orderBy: ORDER,
      select: { id: true, clientName: true, business: true, sector: true, quote: true, result: true, photo: true },
    });
    const list = rows.map(({ photo, ...r }) => ({ ...r, photoUrl: photoUrl(photo) }));
    cached = { at: Date.now(), rows: list };
    return list;
  } catch (e) {
    await logError(e, { source: "testimonials.published" });
    return [];
  }
}
