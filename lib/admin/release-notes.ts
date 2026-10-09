// Release notes from GitHub are markdown written by whoever made the release. The console shows them as plain
// paragraphs, headings and bullet lists built from React elements (never HTML), so nothing in the notes can run.
// No server imports: safe to import anywhere.

export type NoteBlock = { type: "heading"; text: string } | { type: "paragraph"; text: string } | { type: "list"; items: string[] };

const MAX_CHARS = 8000;

/** Strips inline markdown (emphasis, code, links, images, HTML tags) and leaves readable text. */
export function plainText(line: string): string {
  return line
    .replace(/<[^>]*>/g, "") // HTML tags
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> their text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Turns markdown into blocks for display. Long notes are cut at 8000 characters. */
export function notesToBlocks(markdown: string | null | undefined): NoteBlock[] {
  const text = (markdown ?? "").replace(/\r\n?/g, "\n").slice(0, MAX_CHARS);
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let inFence = false;
  const flushParagraph = () => {
    const t = plainText(paragraph.join(" "));
    if (t) blocks.push({ type: "paragraph", text: t });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "list", items: list });
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      // Code inside a fence is shown as a plain paragraph line.
      flushList();
      paragraph.push(raw.trimEnd());
      continue;
    }
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const t = plainText(heading[1]);
      if (t) blocks.push({ type: "heading", text: t });
      continue;
    }
    const item = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushParagraph();
      const t = plainText(item[1]);
      if (t) list.push(t);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.replace(/^>\s?/, ""));
  }
  flushParagraph();
  flushList();
  return blocks;
}
