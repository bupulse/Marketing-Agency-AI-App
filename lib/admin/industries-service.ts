import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clearIndustryCache, getIndustries, type IndustryRow } from "@/lib/industries/server";
import { industryKey } from "@/lib/industries/shared";
import { writeAudit } from "./audit";
import { AdminError, type AdminContext } from "./types";

// Industries (Admin -> Industries, Jarvis read tools): the sectors offered at sign-up and the guidance the AI writes
// from (docs/INDUSTRIES.md). Every change is audited. An industry in use is deactivated, never deleted: the Business
// rows keep their sector and its guidance.

const trimmed = (min: number, max: number, field: string) =>
  z
    .string()
    .trim()
    .min(min, min > 1 ? `${field} needs at least ${min} characters.` : `${field} is required.`)
    .max(max, `${field} must be ${max} characters or fewer.`);

const optionalText = (max: number, field: string) => z.string().trim().max(max, `${field} must be ${max} characters or fewer.`);

const HASHTAG = /^#?[\p{L}\p{N}_]{2,30}$/u;

/** The admin form, validated. Required: name, short description, customers, offerings, tone. */
export const industryInputSchema = z.object({
  name: trimmed(2, 60, "The name"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(60, "The slug must be 60 characters or fewer.")
    .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/, "The slug uses lower-case letters, digits and hyphens, for example car-wash."),
  shortDescription: trimmed(10, 200, "The short description"),
  customers: trimmed(10, 600, "Typical customers"),
  offerings: trimmed(10, 600, "Products and services"),
  postIdeas: optionalText(1200, "Post ideas"),
  tone: trimmed(5, 300, "The tone of voice"),
  hashtags: z
    .array(z.string().trim())
    .transform((list) => [...new Set(list.map((h) => h.replace(/^#?/, "#")).filter((h) => h !== "#"))])
    .refine((list) => list.length <= 20, "Use 20 hashtags or fewer.")
    .refine((list) => list.every((h) => HASHTAG.test(h)), "Hashtags are letters, digits and _ only, 2 to 30 characters."),
  seasons: optionalText(1500, "Dates and seasons"),
  avoid: optionalText(1200, "Words and claims to avoid"),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
});

export type IndustryInput = z.input<typeof industryInputSchema>;

/** "Car wash & detailing" -> "car-wash-detailing". */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Validated input; an empty slug falls back to `currentSlug` (editing) or to one made from the name (creating). */
function clean(input: IndustryInput, currentSlug?: string | null) {
  const parsed = industryInputSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AdminError("invalid", first?.message ?? "Check the form.");
  }
  const v = parsed.data;
  const slug = v.slug || currentSlug || slugify(v.name);
  if (!slug) throw new AdminError("invalid", "The name needs at least one letter or digit.");
  return { ...v, slug };
}

export type IndustryAdminRow = IndustryRow & { businesses: number; createdAt: Date; updatedAt: Date };

/** Every industry with how many companies use it, in sort order. */
export async function listIndustriesAdmin(): Promise<IndustryAdminRow[]> {
  const rows = await prisma.industry.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { businesses: true } } } });
  return rows.map(({ _count, ...r }) => ({ ...r, hashtags: r.hashtags ?? [], businesses: _count.businesses }));
}

export async function getIndustryAdmin(id: string): Promise<IndustryAdminRow> {
  const row = await prisma.industry.findUnique({ where: { id }, include: { _count: { select: { businesses: true } } } });
  if (!row) throw new AdminError("not_found", "No industry with that id.");
  const { _count, ...r } = row;
  return { ...r, hashtags: r.hashtags ?? [], businesses: _count.businesses };
}

/** Creates (no id) or updates an industry. The slug is unique; a clash is a conflict, not a silent rename. */
export async function saveIndustry(ctx: AdminContext, input: IndustryInput & { id?: string | null }): Promise<IndustryAdminRow> {
  const id = input.id?.trim() || null;
  const before = id ? await prisma.industry.findUnique({ where: { id } }) : null;
  if (id && !before) throw new AdminError("not_found", "No industry with that id.");
  const next = clean(input, before?.slug);
  const clash = await prisma.industry.findUnique({ where: { slug: next.slug } });
  if (clash && clash.id !== id) throw new AdminError("conflict", `"${next.slug}" is already the slug of ${clash.name}. Choose another slug.`);
  const data = { slug: next.slug, name: next.name, shortDescription: next.shortDescription, customers: next.customers, offerings: next.offerings, postIdeas: next.postIdeas, tone: next.tone, hashtags: next.hashtags, seasons: next.seasons, avoid: next.avoid, active: next.active, sortOrder: next.sortOrder };
  const saved = await prisma.$transaction(async (tx) => {
    const row = id ? await tx.industry.update({ where: { id }, data }) : await tx.industry.create({ data });
    await writeAudit(tx, ctx, id ? "update_industry" : "create_industry", `industry:${row.id}`, before, { id: row.id, ...data });
    return row;
  });
  clearIndustryCache();
  return getIndustryAdmin(saved.id);
}

/** Shows or hides an industry at sign-up. Companies already on a hidden sector keep it. */
export async function setIndustryActive(ctx: AdminContext, input: { id: string; active: boolean }) {
  const before = await prisma.industry.findUnique({ where: { id: input.id } });
  if (!before) throw new AdminError("not_found", "No industry with that id.");
  if (before.active === input.active) return getIndustryAdmin(before.id);
  await prisma.$transaction(async (tx) => {
    await tx.industry.update({ where: { id: before.id }, data: { active: input.active } });
    await writeAudit(tx, ctx, "update_industry", `industry:${before.id}`, { active: before.active }, { active: input.active });
  });
  clearIndustryCache();
  return getIndustryAdmin(before.id);
}

/** Moves an industry up or down the sign-up list. */
export async function setIndustryOrder(ctx: AdminContext, input: { id: string; sortOrder: number }) {
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < -1000 || input.sortOrder > 1000) throw new AdminError("invalid", "The order is a whole number from -1000 to 1000.");
  const before = await prisma.industry.findUnique({ where: { id: input.id } });
  if (!before) throw new AdminError("not_found", "No industry with that id.");
  if (before.sortOrder === input.sortOrder) return getIndustryAdmin(before.id);
  await prisma.$transaction(async (tx) => {
    await tx.industry.update({ where: { id: before.id }, data: { sortOrder: input.sortOrder } });
    await writeAudit(tx, ctx, "update_industry", `industry:${before.id}`, { sortOrder: before.sortOrder }, { sortOrder: input.sortOrder });
  });
  clearIndustryCache();
  return getIndustryAdmin(before.id);
}

/** Deletes an industry nobody uses. One in use cannot be deleted: deactivate it instead. */
export async function deleteIndustry(ctx: AdminContext, input: { id: string }) {
  const before = await prisma.industry.findUnique({ where: { id: input.id } });
  if (!before) throw new AdminError("not_found", "No industry with that id.");
  const inUse = await prisma.business.count({ where: { industryId: before.id } });
  if (inUse > 0) throw new AdminError("conflict", `${before.name} is the sector of ${inUse} ${inUse === 1 ? "company" : "companies"}. Deactivate it instead; they keep it.`);
  await prisma.$transaction(async (tx) => {
    await tx.industry.delete({ where: { id: before.id } });
    await writeAudit(tx, ctx, "delete_industry", `industry:${before.id}`, before, null);
  });
  clearIndustryCache();
  return { id: before.id, name: before.name };
}

// ---- Suggestions: "New from sign-ups" --------------------------------------------------------------------------------

export type IndustrySuggestion = {
  /** Normalised text (trimmed, lower-cased): the id of the suggestion. */
  key: string;
  /** The most common spelling clients used. */
  label: string;
  count: number;
  /** Up to five clients' descriptions, most recent first. */
  samples: string[];
  businessIds: string[];
};

/** Companies that chose "Other", grouped by what they typed, minus the dismissed ones. Most frequent first. */
export async function listIndustrySuggestions(opts: { includeDismissed?: boolean } = {}): Promise<IndustrySuggestion[]> {
  const [rows, dismissed] = await Promise.all([
    prisma.business.findMany({ where: { industryId: null, industryOther: { not: null } }, select: { id: true, industryOther: true, industryDescription: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    opts.includeDismissed ? Promise.resolve([]) : prisma.dismissedIndustrySuggestion.findMany({ select: { key: true } }),
  ]);
  const skip = new Set(dismissed.map((d) => d.key));
  type Group = IndustrySuggestion & { labels: Map<string, number> };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const text = (r.industryOther ?? "").trim();
    if (!text) continue;
    const key = industryKey(text);
    if (skip.has(key)) continue;
    const g: Group = groups.get(key) ?? { key, label: text, count: 0, samples: [], businessIds: [], labels: new Map<string, number>() };
    g.count++;
    g.businessIds.push(r.id);
    g.labels.set(text, (g.labels.get(text) ?? 0) + 1);
    const sample = r.industryDescription?.trim();
    if (sample && g.samples.length < 5 && !g.samples.includes(sample)) g.samples.push(sample);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ labels, ...g }) => ({ ...g, label: [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? g.label }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** One suggestion by its key, or null. */
export async function getIndustrySuggestion(key: string): Promise<IndustrySuggestion | null> {
  const k = industryKey(key);
  return (await listIndustrySuggestions({ includeDismissed: true })).find((s) => s.key === k) ?? null;
}

/** A first draft of the short description from what the clients wrote: the first sample, trimmed to one sentence. */
export function draftShortDescription(s: IndustrySuggestion): string {
  const first = s.samples[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (!first) return `${s.label.charAt(0).toUpperCase()}${s.label.slice(1)} businesses.`;
  const sentence = first.split(/(?<=[.!?])\s/)[0] ?? first;
  const text = sentence.length > 180 ? `${sentence.slice(0, 177).replace(/\s+\S*$/, "")}…` : sentence;
  return text.replace(/^we\s+/i, (m) => m.charAt(0).toUpperCase() + m.slice(1));
}

/** Hides a suggestion from "New from sign-ups". The companies keep their "Other" text. */
export async function dismissIndustrySuggestion(ctx: AdminContext, input: { key: string }) {
  const s = await getIndustrySuggestion(input.key);
  if (!s) throw new AdminError("not_found", "No suggestion with that text.");
  await prisma.$transaction(async (tx) => {
    await tx.dismissedIndustrySuggestion.upsert({ where: { key: s.key }, create: { key: s.key, label: s.label }, update: { label: s.label } });
    await writeAudit(tx, ctx, "dismiss_industry_suggestion", `industry_suggestion:${s.key}`, { count: s.count }, { label: s.label });
  });
  return { key: s.key, label: s.label };
}

/** Brings a dismissed suggestion back. */
export async function restoreIndustrySuggestion(ctx: AdminContext, input: { key: string }) {
  const key = industryKey(input.key);
  const before = await prisma.dismissedIndustrySuggestion.findUnique({ where: { key } });
  if (!before) throw new AdminError("not_found", "That suggestion is not dismissed.");
  await prisma.$transaction(async (tx) => {
    await tx.dismissedIndustrySuggestion.delete({ where: { key } });
    await writeAudit(tx, ctx, "restore_industry_suggestion", `industry_suggestion:${key}`, { label: before.label }, null);
  });
  return { key, label: before.label };
}

export async function listDismissedSuggestions() {
  return prisma.dismissedIndustrySuggestion.findMany({ orderBy: { createdAt: "desc" } });
}

/**
 * "Add as industry": creates the industry from the form, then moves every company whose "Other" text normalises to
 * the suggestion's key onto it (industryId set, industryOther cleared, legacy label = the new name). One transaction,
 * one audit row per moved company plus the create. Returns the industry and how many companies moved.
 */
export async function createIndustryFromSuggestion(ctx: AdminContext, input: IndustryInput & { suggestionKey: string }): Promise<{ industry: IndustryAdminRow; moved: number }> {
  const next = clean(input);
  const key = industryKey(input.suggestionKey);
  if (!key) throw new AdminError("invalid", "The suggestion is missing.");
  const clash = await prisma.industry.findUnique({ where: { slug: next.slug } });
  if (clash) throw new AdminError("conflict", `"${next.slug}" is already the slug of ${clash.name}. Choose another slug.`);
  const candidates = await prisma.business.findMany({ where: { industryId: null, industryOther: { not: null } }, select: { id: true, industryOther: true, industry: true } });
  const moving = candidates.filter((b) => industryKey(b.industryOther ?? "") === key);
  const data = { slug: next.slug, name: next.name, shortDescription: next.shortDescription, customers: next.customers, offerings: next.offerings, postIdeas: next.postIdeas, tone: next.tone, hashtags: next.hashtags, seasons: next.seasons, avoid: next.avoid, active: next.active, sortOrder: next.sortOrder };
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.industry.create({ data });
    await writeAudit(tx, ctx, "create_industry", `industry:${row.id}`, null, { id: row.id, ...data, fromSuggestion: key });
    for (const b of moving) {
      await tx.business.update({ where: { id: b.id }, data: { industryId: row.id, industryOther: null, industry: row.name } });
      await writeAudit(tx, ctx, "update_company_industry", `business:${b.id}`, { industryId: null, industryOther: b.industryOther, industry: b.industry }, { industryId: row.id, industryOther: null, industry: row.name });
    }
    // The suggestion is gone from the list because the companies moved; a dismissal of the same key is tidied up.
    await tx.dismissedIndustrySuggestion.deleteMany({ where: { key } });
    return row;
  });
  clearIndustryCache();
  return { industry: await getIndustryAdmin(created.id), moved: moving.length };
}

/** For the Jarvis read tool: the guided fields of every industry, active ones first. */
export async function listIndustriesForTools() {
  const rows = await getIndustries({ force: true });
  const counts = await prisma.business.groupBy({ by: ["industryId"], _count: { _all: true }, where: { industryId: { not: null } } }).catch(() => [] as { industryId: string | null; _count: { _all: number } }[]);
  const byId = new Map(counts.map((c) => [c.industryId, c._count._all]));
  return rows.map((r) => ({ ...r, businesses: byId.get(r.id) ?? 0 }));
}
