// Folds the researchers' rows (docs/research/reels/<source>.jsonl) into the brain's evidence index
// (lib/video-engine/brain/data/evidence.json). Run after new research lands:
//   node lib/video-engine/brain/ingest.ts            (or --no-new: refresh the indexed rows only;
//                                                     --skip=instagram: leave a source as it is)
// Safe to re-run at any time: ids already given keep their number (found again by `key`, even if a row moves), new
// rows get the next number, a missing file keeps its old index. The researchers' files are only read, never written. Plain erasable TypeScript with no project imports, so
// Node runs it directly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Evidence, ResearchSource } from "./types";

const PREFIX: Record<ResearchSource, string> = { tiktok: "tt", facebook: "fb", instagram: "ig", youtube: "yt", captions: "cp", comments: "cm" };
const SOURCES: ResearchSource[] = ["tiktok", "facebook", "instagram", "youtube", "captions", "comments"];
/** The file each source lives in (docs/research/reels/), when it is not "<source>.jsonl". */
const FILES: Partial<Record<ResearchSource, string>> = { comments: "tiktok-comments.jsonl" };
/**
 * Which rows of a file are evidence. The comments file has one summary per clip and 15 comments under it: the
 * summaries are indexed, the comments stay in the file as their detail.
 */
const INDEXED: Partial<Record<ResearchSource, (row: Row) => boolean>> = { comments: (row) => row.type === "clip_summary" };
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
  const NAMES: Record<string, string> = { rwanda: "RW", kenya: "KE", uganda: "UG", tanzania: "TZ", nigeria: "NG", "south africa": "ZA", china: "CN", "united states": "US", usa: "US" };
  if (own && NAMES[own.toLowerCase()]) return NAMES[own.toLowerCase()];
  const text = [row.author, row.page, row.channel, row.title, row.caption, row.on_screen_text, row.hook, row.why_it_works, (row.hashtags as unknown[] | null)?.join(" ")].filter((x) => typeof x === "string").join(" ");
  if (row.language === "rw") return "RW";
  // The country named most often (a caption listing stockists abroad still belongs to its own country); ties go to
  // the one named first.
  let best: { code: string; n: number; at: number } | null = null;
  for (const [code, re] of COUNTRY_WORDS) {
    const hits = [...text.matchAll(new RegExp(re.source, "gi"))];
    if (!hits.length) continue;
    const c = { code, n: hits.length, at: hits[0].index ?? 0 };
    if (!best || c.n > best.n || (c.n === best.n && c.at < best.at)) best = c;
  }
  return best?.code ?? null;
}

export const rowKey = (row: Row): string =>
  [str(row.url) ?? str(row.clip_url) ?? "", str(row.author) ?? str(row.page) ?? str(row.channel) ?? str(row.page_or_account) ?? "", (str(row.hook) ?? str(row.caption) ?? str(row.title) ?? str(row.structure) ?? "").slice(0, 40)].join(" | ");

/**
 * Ads an advertiser had live at once, as the researchers counted them in the Ad Library
 * (docs/research/reels/facebook-patterns.md: round 1 and the Rwanda playbook). Lower-case advertiser name -> count.
 */
export const STATED_VARIANTS: Record<string, number> = {
  "derma skin clinic rwanda": 15,
  elohome: 8,
  "magic chef kigali": 7,
  "piramie 4g+": 6,
  ugalina: 10,
  "kenlina-b": 7,
  tnzstore: 7,
  "nila baby shop": 3,
  "spot salon & beauty studio": 3,
};
const advertiser = (row: Row) => (str(row.page) ?? str(row.author) ?? "").toLowerCase().replace(/\s+/g, " ");

/**
 * Facebook only: how many ads the advertiser has live, the larger of the rows sharing its name in the file and the
 * researchers' stated count; null for other sources.
 */
export function variantsLive(source: ResearchSource, row: Row, rows: Row[]): number | null {
  if (source !== "facebook") return null;
  const name = advertiser(row);
  if (!name) return 1;
  return Math.max(rows.filter((r) => advertiser(r) === name).length, STATED_VARIANTS[name] ?? 0);
}

/**
 * 0 to 1: likes on a log scale (1M likes = 1, 10K = 0.67), days running (a year = 1), and on Facebook the variants
 * live at once (one ad = 0, 10 or more = 1): Rwandan ads are young, so the playbook counts variants above age.
 * Articles get a low fixed value.
 */
export function rowStrength(source: ResearchSource, row: Row, likes: number | null, runningDays: number | null, variants: number | null = null): number {
  if (row.secondary === true) return 0.3;
  const fromLikes = likes ? Math.min(1, Math.log10(Math.max(1, likes)) / 6) : 0;
  const fromDays = runningDays ? Math.min(1, runningDays / 365) : 0;
  const fromVariants = variants && variants > 1 ? Math.min(1, (variants - 1) / 9) : 0;
  return Math.round(Math.max(0.2, fromLikes, fromDays, fromVariants) * 100) / 100;
}

/**
 * Income-chain and recruiter posts ("Tajyira Akakanya Gukorere Akayabo...", "earn 30K a day", MoMo or M-Money
 * screenshots, "get rich" lines). They run long because they are cheap and re-posted, not because they work
 * (facebook-patterns.md, "Long runners"), so their age and variants never count as strength, and the brain may cite them
 * only for the fake-income and income-promise don'ts (index.ts checkBrain).
 */
export const SCAM_PATTERN = /tajyira|akakanya|akayabo|kama faranga|earn [\d,.]+\s*k?\s*(rwf|frw)?\s*(a|per) day|work and earn|you have received [\d,.]+|m-?money|momo (sms|screenshot)|mobile money received|income proof|passive income|make (your first )?\$?\d+k|(your|my) first \$?\d+ ?(k|m)\b|becoming (a )?(millionaire|billionaire)|u(g|ga)sezera k.ubukene|get rich|wifimoney|millionaire ?mindset/i;
export function looksLikeScam(row: Row): boolean {
  const text = [row.caption, row.title, row.hook, row.on_screen_text, row.structure, (row.hashtags as unknown[] | null)?.join(" ")].filter((x) => typeof x === "string").join(" \n ");
  return SCAM_PATTERN.test(text);
}

/**
 * The index entries for one research file's rows, keeping the ids already given: a row is found again by its URL (when
 * the URL is unique), else by its key, so filling in a row's hook later keeps its id. `addNew: false` refreshes the
 * rows already indexed and leaves new ones out (for rows a researcher is still writing). Pure.
 */
export function evidenceFromRows(source: ResearchSource, rows: Row[], existing: Evidence[] = [], opts: { addNew?: boolean } = {}): Evidence[] {
  const prefix = PREFIX[source];
  const mine = existing.filter((e) => e.source === source);
  const known = new Map(mine.map((e) => [e.key, e.id]));
  const count = (urls: (string | null)[]) => urls.reduce((m, u) => (u ? m.set(u, (m.get(u) ?? 0) + 1) : m), new Map<string, number>());
  const rowUrls = count(rows.map((r) => str(r.url)));
  const oldUrls = count(mine.map((e) => e.url));
  const byUrl = new Map(mine.filter((e) => e.url && oldUrls.get(e.url) === 1).map((e) => [e.url as string, e.id]));
  let next = Math.max(0, ...mine.map((e) => Number(e.id.split("-")[1]) || 0));
  const used = new Set<string>();
  const out: Evidence[] = [];
  rows.forEach((row, i) => {
    if (INDEXED[source] && !INDEXED[source]!(row)) return;
    const key = rowKey(row);
    const rowUrl = str(row.url) ?? str(row.clip_url);
    let id = known.get(key) ?? (rowUrl && rowUrls.get(rowUrl) === 1 ? byUrl.get(rowUrl) : undefined);
    if (id && used.has(id)) id = undefined;
    if (!id && opts.addNew === false) return;
    if (!id) id = `${prefix}-${String(++next).padStart(3, "0")}`;
    used.add(id);
    const url = str(row.url) ?? str(row.clip_url);
    const stats = (row.stats_as_reported ?? {}) as Row;
    // A comments row's signal is how many comments the clip drew (729 is a lot for a Kigali shop); it stands in for likes.
    const likes = parseCount(stats.likes ?? row.likes ?? (source === "comments" ? row.total_comments_shown : null));
    const runningDays = typeof row.running_days === "number" ? row.running_days : null;
    const variants = variantsLive(source, row, rows);
    const scam = looksLikeScam(row);
    out.push({
      id,
      source,
      line: i + 1,
      key,
      who: str(row.author) ?? str(row.page) ?? str(row.channel) ?? str(row.page_or_account) ?? str(row.account) ?? "unknown",
      url,
      country: rowCountry(row),
      category: str(row.category) ?? str(row.sector),
      language: str(row.language),
      watched: row.watched === true,
      secondary: row.secondary === true,
      date: source === "tiktok" ? (tiktokDate(url) ?? parseDate(row.posted)) : (parseDate(row.posted_or_started) ?? parseDate(row.posted)),
      likes,
      runningDays,
      variantsLive: variants,
      // A scam row's age and variants say nothing about what works: only its likes (if any) count.
      strength: scam ? rowStrength(source, row, likes, null, null) : rowStrength(source, row, likes, runningDays, variants),
      ...(scam ? { scam: true as const } : {}),
    });
  });
  return out;
}

export const parseJsonl = (text: string): Row[] =>
  text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row);

function main() {
  // --no-new: refresh the rows already indexed, leave rows the researchers are still writing out.
  const noNew = process.argv.includes("--no-new");
  // --skip=instagram,youtube: leave these sources as they are in the index (a file still being written).
  const skip = (process.argv.find((a) => a.startsWith("--skip="))?.slice(7) ?? "").split(",").filter(Boolean);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const out = path.join(root, "lib/video-engine/brain/data/evidence.json");
  const existing: Evidence[] = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
  const all: Evidence[] = [];
  for (const source of SOURCES) {
    const file = path.join(root, `docs/research/reels/${FILES[source] ?? `${source}.jsonl`}`);
    if (!fs.existsSync(file) || skip.includes(source)) {
      all.push(...existing.filter((e) => e.source === source));
      continue;
    }
    const rows = evidenceFromRows(source, parseJsonl(fs.readFileSync(file, "utf8")), existing, { addNew: !noNew });
    console.log(`${source}: ${rows.length} rows (${rows.filter((r) => r.watched).length} watched, ${rows.filter((r) => r.scam).length} income-chain or scam)`);
    all.push(...rows);
  }
  fs.writeFileSync(out, `[\n${all.map((e) => JSON.stringify(e)).join(",\n")}\n]\n`);
  console.log(`Wrote ${all.length} evidence rows to ${path.relative(root, out)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
