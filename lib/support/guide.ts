import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { GUIDE_FILE, hashInput, planGuideSync, splitGuide, type HashedChunk } from "./guide-split";
import { sha256Hex } from "./tokens";

// The support AI's knowledge: the owner guide's sections in SupportGuideChunk, searched with Postgres full-text search
// (the generated "tsv" column, see the migration), not stuffed whole into every prompt (docs/research 3.9). The index
// is rebuilt by `node scripts/support-guide-index.mjs` after the guide changes, and on first use when it is empty
// (the guide files ship with the server: next.config.ts outputFileTracingIncludes). Hash-based, so re-running changes
// only what changed.

export const GUIDE_DIR = join(process.cwd(), "docs", "guide", "features");

export type GuideHit = { id: string; file: string; title: string; page: string | null; heading: string; anchor: string; body: string };

export async function readGuideFiles(dir = GUIDE_DIR): Promise<{ file: string; text: string }[]> {
  const names = (await readdir(dir)).filter((n) => GUIDE_FILE.test(n)).sort();
  return Promise.all(names.map(async (file) => ({ file, text: await readFile(join(dir, file), "utf8") })));
}

/** Saves new and changed sections and removes the ones that are gone. Returns what it did. */
export async function indexGuide(files: { file: string; text: string }[]): Promise<{ sections: number; written: number; deleted: number }> {
  const chunks: HashedChunk[] = await Promise.all(files.flatMap((f) => splitGuide(f.file, f.text)).map(async (c) => ({ ...c, hash: await sha256Hex(hashInput(c)) })));
  const existing = await prisma.supportGuideChunk.findMany({ select: { id: true, file: true, anchor: true, hash: true } });
  const { upserts, deletes } = planGuideSync(existing, chunks);
  for (const c of upserts) {
    const data = { title: c.title, page: c.page, heading: c.heading, body: c.body, sort: c.sort, hash: c.hash };
    await prisma.supportGuideChunk.upsert({ where: { file_anchor: { file: c.file, anchor: c.anchor } }, create: { file: c.file, anchor: c.anchor, ...data }, update: data });
  }
  if (deletes.length) await prisma.supportGuideChunk.deleteMany({ where: { id: { in: deletes } } });
  mapCache = null;
  return { sections: chunks.length, written: upserts.length, deleted: deletes.length };
}

let checked = false;

/** Fills an empty index from the guide files once per server instance. Never throws: the AI then answers without it. */
export async function ensureGuideIndexed(): Promise<void> {
  if (checked) return;
  try {
    if ((await prisma.supportGuideChunk.count()) === 0) await indexGuide(await readGuideFiles());
    checked = true;
  } catch (error) {
    checked = true; // one try per instance: a missing docs folder must not cost every chat a file read
    await logError(error, { source: "support.guide.index", level: "warn" });
  }
}

/** Search words: letters and digits only (to_tsquery syntax cannot leak in), 3+ characters, at most 16. */
export function searchTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  return [...new Set(words)].slice(0, 16);
}

/** The best sections for a question: any of its words (OR), ranked; titles and headings count more than bodies. */
export async function searchGuide(text: string, limit = 4): Promise<GuideHit[]> {
  const terms = searchTerms(text);
  if (!terms.length) return [];
  const query = terms.join(" | ");
  return prisma.$queryRaw<GuideHit[]>`
    SELECT "id", "file", "title", "page", "heading", "anchor", "body"
    FROM "SupportGuideChunk", to_tsquery('english', ${query}) q
    WHERE "tsv" @@ q
    ORDER BY ts_rank_cd("tsv", q) DESC, "file", "sort"
    LIMIT ${limit}`;
}

export async function guideChunks(ids: string[]): Promise<GuideHit[]> {
  if (!ids.length) return [];
  return prisma.supportGuideChunk.findMany({ where: { id: { in: ids } }, select: { id: true, file: true, title: true, page: true, heading: true, anchor: true, body: true } });
}

let mapCache: { at: number; map: { title: string; page: string | null }[] } | null = null;

/** One line per guide file (its title and page), so the AI knows what exists beyond the sections it was given. */
export async function guideMap(): Promise<{ title: string; page: string | null }[]> {
  if (mapCache && Date.now() - mapCache.at < 10 * 60_000) return mapCache.map;
  const rows = await prisma.supportGuideChunk.findMany({ where: { sort: 0 }, orderBy: { file: "asc" }, select: { title: true, page: true } });
  mapCache = { at: Date.now(), map: rows };
  return rows;
}
