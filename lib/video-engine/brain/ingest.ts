// Folds the researchers' rows (docs/research/reels/<source>.jsonl) into the brain's evidence index
// (lib/video-engine/brain/data/evidence.json). Run after new research lands:
//   node lib/video-engine/brain/ingest.ts
// Ids already given keep their number (they are found again by `key`, even if a row moves); new rows get the next
// number. The researchers' files are only read, never written. Plain erasable TypeScript with no project imports, so
// Node runs it directly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Evidence, ResearchSource } from "./types";

const PREFIX: Record<ResearchSource, string> = { tiktok: "tt", facebook: "fb", instagram: "ig" };
const SOURCES: ResearchSource[] = ["tiktok", "facebook", "instagram"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "16.6K" -> 16600, "1.1M" -> 1100000, "1615" -> 1615; null when there is no number. */
export function parseCount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = str(v)?.replace(/,/g, "").match(/^([\d.]+)\s*([KkMm])?/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** A TikTok video id holds its upload time (the top 32 bits are Unix seconds). */
export function tiktokDate(url: string | null): string | null {
  const id = url?.match(/\/video\/(\d{15,})/)?.[1];
  if (!id) return null;
  const seconds = Number(BigInt(id) >> BigInt(32));
  return seconds > 1_400_000_000 ? new Date(seconds * 1000).toISOString().slice(0, 10) : null;
}

/** "Jul 6, 2025" -> "2025-07-06"; ISO dates pass through. */
export function parseDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return m && month >= 0 ? `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

const COUNTRY_WORDS: [string, RegExp][] = [
  ["RW", /kigali|rwanda|\brw\b|kicukiro|kimironko|gasogi|kabeza|vubavuba|rwf|\bfrw\b/i],
  ["KE", /nairobi|kenya|\bkes\b|\bksh\b|roysambu|mombasa/i],
  ["UG", /kampala|uganda|_ug\b|\.ug\b|luganda|jumia uganda/i],
  ["TZ", /tanzania|zanzibar|dar es salaam|\btzs?\b/i],
  ["NG", /nigeria|lagos|osigbo|\.ng\b/i],
  ["ZA", /joburg|johannesburg|south africa/i],
  ["US", /texas|north carolina|new jersey|las vegas|ohio|houston|frisco/i],
];

/** The country a row is from: its own field, else words in its author, caption and text. */
export function rowCountry(row: Row): string | null {
  const own = str(row.country);
  if (own && /^[A-Z]{2}$/.test(own)) return own;
  const text = [row.author, row.page, row.caption, row.on_screen_text, row.hook, row.why_it_works, (row.hashtags as unknown[] | null)?.join(" ")].filter((x) => typeof x === "string").join(" ");
  if (row.language === "rw") return "RW";
  return COUNTRY_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

export const rowKey = (row: Row): string =>
  [str(row.url) ?? "", str(row.author) ?? str(row.page) ?? "", (str(row.hook) ?? str(row.caption) ?? str(row.structure) ?? "").slice(0, 40)].join(" | ");

/** 0 to 1: likes on a log scale (1M likes = 1, 10K = 0.67), days running (a year = 1), a low fixed value for articles. */
export function rowStrength(source: ResearchSource, row: Row, likes: number | null, runningDays: number | null): number {
  if (row.secondary === true) return 0.3;
  const fromLikes = likes ? Math.min(1, Math.log10(Math.max(1, likes)) / 6) : 0;
  const fromDays = runningDays ? Math.min(1, runningDays / 365) : 0;
  const s = source === "facebook" ? Math.max(fromDays, fromLikes) : Math.max(fromLikes, fromDays);
  return Math.round(Math.max(0.2, s) * 100) / 100;
}

/** The index entries for one research file's rows, keeping the ids already given. Pure. */
export function evidenceFromRows(source: ResearchSource, rows: Row[], existing: Evidence[] = []): Evidence[] {
  const prefix = PREFIX[source];
  const known = new Map(existing.filter((e) => e.source === source).map((e) => [e.key, e.id]));
  let next = Math.max(0, ...existing.filter((e) => e.source === source).map((e) => Number(e.id.split("-")[1]) || 0));
  const used = new Set<string>();
  return rows.map((row, i) => {
    const key = rowKey(row);
    let id = known.get(key);
    if (!id || used.has(id)) id = `${prefix}-${String(++next).padStart(3, "0")}`;
    used.add(id);
    const url = str(row.url);
    const stats = (row.stats_as_reported ?? {}) as Row;
    const likes = parseCount(stats.likes ?? row.likes);
    const runningDays = typeof row.running_days === "number" ? row.running_days : null;
    return {
      id,
      source,
      line: i + 1,
      key,
      who: str(row.author) ?? str(row.page) ?? str(row.account) ?? "unknown",
      url,
      country: rowCountry(row),
      category: str(row.category),
      language: str(row.language),
      watched: row.watched === true,
      secondary: row.secondary === true,
      date: source === "tiktok" ? (tiktokDate(url) ?? parseDate(row.posted)) : (parseDate(row.posted_or_started) ?? parseDate(row.posted)),
      likes,
      runningDays,
      strength: rowStrength(source, row, likes, runningDays),
    };
  });
}

export const parseJsonl = (text: string): Row[] =>
  text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row);

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const out = path.join(root, "lib/video-engine/brain/data/evidence.json");
  const existing: Evidence[] = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
  const all: Evidence[] = [];
  for (const source of SOURCES) {
    const file = path.join(root, `docs/research/reels/${source}.jsonl`);
    if (!fs.existsSync(file)) {
      all.push(...existing.filter((e) => e.source === source));
      continue;
    }
    const rows = evidenceFromRows(source, parseJsonl(fs.readFileSync(file, "utf8")), existing);
    console.log(`${source}: ${rows.length} rows (${rows.filter((r) => r.watched).length} watched)`);
    all.push(...rows);
  }
  fs.writeFileSync(out, `[\n${all.map((e) => JSON.stringify(e)).join(",\n")}\n]\n`);
  console.log(`Wrote ${all.length} evidence rows to ${path.relative(root, out)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
