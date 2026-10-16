import "server-only";
import { prisma } from "@/lib/db";
import { industries as siteIndustries } from "@/lib/content/site";
import { INDUSTRY_OTHER, type IndustryOption } from "./shared";

// The Industry rows (Admin -> Industries), cached like the regions. The sign-up, welcome and brand forms list the
// active ones; the server actions resolve the chosen slug to a row and write every industry field of the Business.

export type IndustryRow = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  customers: string;
  offerings: string;
  postIdeas: string;
  tone: string;
  hashtags: string[];
  seasons: string;
  avoid: string;
  active: boolean;
  sortOrder: number;
};

const TTL_MS = 30_000;
let lastGood: IndustryRow[] | null = null;
let fetchedAt = 0;

export function clearIndustryCache() {
  fetchedAt = 0;
}
/** For tests: forget everything, including the last good copy. */
export function resetIndustryCache() {
  fetchedAt = 0;
  lastGood = null;
}

/**
 * Every industry (active or not) in sort order. Cached 30 s; on a database error the last good copy, else nothing
 * (the forms then offer "Other" only, and the migration's seeds appear once the table exists).
 */
export async function getIndustries(opts: { force?: boolean; now?: number } = {}): Promise<IndustryRow[]> {
  const now = opts.now ?? Date.now();
  if (!opts.force && lastGood && now - fetchedAt < TTL_MS) return lastGood;
  try {
    const rows = await prisma.industry.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    lastGood = rows.map((r) => ({ ...r, hashtags: r.hashtags ?? [] }));
    fetchedAt = now;
    return lastGood;
  } catch {
    return lastGood ?? [];
  }
}

/**
 * The sectors a form offers: active rows in order. With `currentIndustryId` (the Brand form) the company's own sector
 * stays in the list even when it was deactivated, marked "(no longer offered)".
 */
export async function industryOptions(opts: { currentIndustryId?: string | null } = {}): Promise<IndustryOption[]> {
  return (await getIndustries())
    .filter((i) => i.active || i.id === opts.currentIndustryId)
    .map((i) => ({ slug: i.slug, name: i.active ? i.name : `${i.name} (no longer offered)` }));
}

/** An unknown slug only forces a refetch when the cached copy is older than this (a public POST must not hammer the database). */
const REFETCH_AFTER_MS = 5_000;

/**
 * The Business columns to write for a form's sector choice, or null when the slug is not an active sector. A company
 * that is already on a deactivated sector may keep it: pass its current `industryId`.
 */
export async function resolveIndustryChoice(input: { industry: string; industryOther: string; industryDescription: string }, opts: { currentIndustryId?: string | null } = {}): Promise<{ industryId: string | null; industryOther: string | null; industry: string | null; industryDescription: string } | null> {
  const description = input.industryDescription.trim();
  if (input.industry === INDUSTRY_OTHER) {
    const other = input.industryOther.trim();
    if (!other) return null;
    return { industryId: null, industryOther: other, industry: other, industryDescription: description };
  }
  const find = (rows: IndustryRow[]) => rows.find((i) => i.slug === input.industry);
  let row = find(await getIndustries());
  if (!row && Date.now() - fetchedAt > REFETCH_AFTER_MS) row = find(await getIndustries({ force: true }));
  if (!row || (!row.active && row.id !== opts.currentIndustryId)) return null;
  return { industryId: row.id, industryOther: null, industry: row.name, industryDescription: description };
}

/** A sector's slug from a legacy Business.industry name ("Shops & retail" -> "retail"), for the marketing list and old sign-up metadata. */
export function slugForIndustryName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  return siteIndustries.find((i) => i.name.toLowerCase() === n)?.slug ?? null;
}
