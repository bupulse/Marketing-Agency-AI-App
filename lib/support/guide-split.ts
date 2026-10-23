// Splits the owner guide (docs/guide/features/*.md) into the sections the support AI searches (SupportGuideChunk), and
// works out what an index run must change. Pure and import-free on purpose: the server (lib/support/guide.ts) and the
// indexing script (scripts/support-guide-index.mjs, run by Node with its built-in TypeScript support) share it.

export type GuideChunk = { file: string; title: string; page: string | null; heading: string; anchor: string; body: string; sort: number };
export type HashedChunk = GuideChunk & { hash: string };
export type ExistingChunk = { id: string; file: string; anchor: string; hash: string };

/** Guide files the AI reads: the numbered feature pages, not the README or the code map. */
export const GUIDE_FILE = /^\d{2}-[a-z0-9-]+\.md$/;
/** A section longer than this is cut: the AI gets the top few sections per question and must stay inside its budget. */
export const MAX_SECTION_CHARS = 6000;
/** Sections the support AI must not read: code, keys and environment variables are not for visitors. */
export const SKIPPED_HEADINGS = /^for developers$/i;

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[`*_[\]()]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section"
  );
}

/** Markdown links and images become their text; code ticks and bold marks go, so search and prompts read plain. */
function plain(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One file's sections: the text before the first "## " is "Overview"; each "## " heading starts a section. */
export function splitGuide(file: string, text: string): GuideChunk[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const titleLine = lines.find((l) => /^# /.test(l));
  const title = titleLine ? titleLine.slice(2).trim() : file.replace(/\.md$/, "");
  const page = /\*\*Page:\*\*\s*`(\/[^`\s]*)`/.exec(text)?.[1] ?? null;
  const sections: { heading: string; lines: string[] }[] = [{ heading: "Overview", lines: [] }];
  for (const line of lines) {
    if (line === titleLine) continue;
    const h2 = /^## (.+)$/.exec(line);
    if (h2) sections.push({ heading: h2[1].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  const seen = new Map<string, number>();
  const chunks: GuideChunk[] = [];
  for (const section of sections) {
    const body = plain(section.lines.join("\n"));
    if (!body || SKIPPED_HEADINGS.test(section.heading)) continue;
    const base = slugify(section.heading);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const anchor = n === 1 ? base : `${base}-${n}`;
    const cut = body.length > MAX_SECTION_CHARS ? `${body.slice(0, MAX_SECTION_CHARS)}…` : body;
    chunks.push({ file, title, page, heading: section.heading, anchor, body: cut, sort: chunks.length });
  }
  return chunks;
}

/** What hashing covers: a change to any of these re-saves the section. */
export function hashInput(c: GuideChunk): string {
  return [c.title, c.page ?? "", c.heading, String(c.sort), c.body].join("\u0000");
}

/** Rows to write (new or changed) and ids to delete (sections or files that are gone). Same input, same plan. */
export function planGuideSync(existing: ExistingChunk[], chunks: HashedChunk[]): { upserts: HashedChunk[]; deletes: string[] } {
  const byKey = new Map(existing.map((e) => [`${e.file}#${e.anchor}`, e]));
  const wanted = new Set(chunks.map((c) => `${c.file}#${c.anchor}`));
  return {
    upserts: chunks.filter((c) => byKey.get(`${c.file}#${c.anchor}`)?.hash !== c.hash),
    deletes: existing.filter((e) => !wanted.has(`${e.file}#${e.anchor}`)).map((e) => e.id),
  };
}
