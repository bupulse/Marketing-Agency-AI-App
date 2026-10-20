// The Viral library (docs/VIDEO_ENGINE.md): rows saved by the research agents in docs/research/viral/<platform>.jsonl,
// and their still frames in video-lab/data/viral/frames/<platform>/<id>/f1.jpg ... Read-only here. The files grow
// while the agents work, so the rows are re-read whenever a file changes (its mtime), and a half-written line is skipped.
import fs from "node:fs/promises";
import path from "node:path";

export const VIRAL_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube"] as const;
export type ViralPlatform = (typeof VIRAL_PLATFORMS)[number];

/** Test option: VIRAL_ROWS_DIR and VIRAL_FRAMES_DIR point the library at other folders (made-up rows for a check). */
const rowsDir = () => path.resolve(process.env.VIRAL_ROWS_DIR || "docs/research/viral");
const framesDir = () => path.resolve(process.env.VIRAL_FRAMES_DIR || "video-lab/data/viral/frames");

const ID = /^vt-(tt|ig|fb|yt)-\d{3}$/;
const FRAME = /^f\d\.jpg$/;

export type ViralRow = Record<string, unknown> & { id: string; platform: ViralPlatform; framesAvailable: string[] };
export type ViralCounts = Record<"platform" | "country" | "sector" | "format" | "hook_type", Record<string, number>>;

let cache: { key: string; rows: Record<string, unknown>[] } | null = null;

async function readRows(): Promise<Record<string, unknown>[]> {
  const dir = rowsDir();
  const stats = await Promise.all(VIRAL_PLATFORMS.map((p) => fs.stat(path.join(dir, `${p}.jsonl`)).then((s) => `${s.mtimeMs}:${s.size}`, () => "-")));
  const key = `${dir}|${stats.join("|")}`;
  if (cache?.key === key) return cache.rows;
  const byId = new Map<string, Record<string, unknown>>();
  for (const p of VIRAL_PLATFORMS) {
    const text = await fs.readFile(path.join(dir, `${p}.jsonl`), "utf8").catch(() => "");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (row && typeof row === "object" && typeof row.id === "string" && ID.test(row.id)) byId.set(row.id, { ...row, platform: p });
      } catch {
        // A line still being written: skipped until it is complete.
      }
    }
  }
  const rows = [...byId.values()];
  cache = { key, rows };
  return rows;
}

const tally = (rows: Record<string, unknown>[], field: string) => {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v = r[field];
    if (typeof v === "string" && v) out[v] = (out[v] ?? 0) + 1;
  }
  return out;
};

/** Every row with the frame files that exist for it, and the counts the filters show. */
export async function viralLibrary(): Promise<{ rows: ViralRow[]; counts: ViralCounts }> {
  const raw = await readRows();
  const rows = await Promise.all(
    raw.map(async (r) => {
      const files = await fs.readdir(path.join(framesDir(), String(r.platform), String(r.id))).catch(() => [] as string[]);
      return { ...r, framesAvailable: files.filter((f) => FRAME.test(f)).sort() } as ViralRow;
    }),
  );
  return { rows, counts: { platform: tally(rows, "platform"), country: tally(rows, "country"), sector: tally(rows, "sector"), format: tally(rows, "format"), hook_type: tally(rows, "hook_type") } };
}

/** The bytes of one frame, or null when the request is not a frame (wrong platform, id or file name, or outside the frames folder) or the file is missing. */
export async function viralFrame(platform: string, id: string, file: string): Promise<Buffer | null> {
  if (!(VIRAL_PLATFORMS as readonly string[]).includes(platform) || !ID.test(id) || !FRAME.test(file)) return null;
  const root = framesDir();
  const full = path.resolve(root, platform, id, file);
  if (!full.startsWith(root + path.sep)) return null;
  return fs.readFile(full).catch(() => null);
}
