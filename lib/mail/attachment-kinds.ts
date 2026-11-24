// What kind of file an attachment is, how B Mail shows it, and what the attachment route may serve inline. Pure: used
// by the route (server) and the viewer (browser). Senders often label files application/octet-stream, so the file
// name's extension decides first and the stated type second. HTML and SVG are never served inline (they could run
// scripts on our domain); they are shown as text.

export type FileKind =
  | "pdf" | "image" | "video" | "audio" | "text" | "csv" | "sheet" | "docx" | "zip"
  | "model" | "slides" | "oldword" | "blender" | "other";

export function extOf(filename: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(filename.trim());
  return m ? m[1].toLowerCase() : "";
}

const IMAGE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" };
const VIDEO: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg" };
const AUDIO: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", weba: "audio/webm" };
const TEXT = new Set([
  "txt", "text", "md", "markdown", "log", "json", "jsonl", "geojson", "xml", "html", "htm", "svg", "css", "scss", "less",
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rb", "php", "java", "kt", "kts", "swift", "go", "rs", "c", "h", "cpp",
  "hpp", "cc", "cs", "dart", "lua", "pl", "r", "sql", "sh", "bash", "zsh", "ps1", "bat", "yml", "yaml", "toml", "ini",
  "cfg", "conf", "env", "properties", "gradle", "vue", "svelte", "ics", "vcf", "eml", "srt", "vtt", "tex", "rtx",
]);
const SHEET = new Set(["xlsx", "xlsm", "xlsb", "xls", "ods"]);
const MODEL = new Set(["glb", "gltf", "stl", "obj", "fbx", "usdz", "3mf", "ply", "dae"]);
const SLIDES = new Set(["pptx", "ppt", "pptm", "pps", "ppsx", "odp", "key"]);
const OLDWORD = new Set(["doc", "dot", "odt", "rtf", "pages", "wpd"]);

const IMAGE_TYPES = new Set(Object.values(IMAGE));
const VIDEO_TYPES = new Set([...Object.values(VIDEO)]);
const AUDIO_TYPES = new Set([...Object.values(AUDIO), "audio/x-m4a", "audio/x-wav", "audio/wave", "audio/opus", "audio/webm", "audio/mp3"]);

const base = (contentType: string) => contentType.split(";")[0].trim().toLowerCase();

export function fileKind(filename: string, contentType: string): FileKind {
  const e = extOf(filename);
  const t = base(contentType);
  if (e === "pdf" || t === "application/pdf") return "pdf";
  if (IMAGE[e]) return "image";
  if (VIDEO[e]) return "video";
  if (AUDIO[e]) return "audio";
  if (e === "csv" || e === "tsv") return "csv";
  if (SHEET.has(e)) return "sheet";
  if (e === "docx" || e === "docm") return "docx";
  if (e === "zip") return "zip";
  if (MODEL.has(e)) return "model";
  if (SLIDES.has(e)) return "slides";
  if (OLDWORD.has(e)) return "oldword";
  if (e === "blend") return "blender";
  if (TEXT.has(e)) return "text";
  // No telling extension: the stated type.
  if (IMAGE_TYPES.has(t)) return "image";
  if (VIDEO_TYPES.has(t)) return "video";
  if (AUDIO_TYPES.has(t)) return "audio";
  if (t === "text/csv" || t === "text/tab-separated-values") return "csv";
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(t)) return "sheet";
  if (t.includes("wordprocessingml.document")) return "docx";
  if (t === "application/zip" || t === "application/x-zip-compressed") return "zip";
  if (/presentationml|ms-powerpoint|opendocument\.presentation/.test(t)) return "slides";
  if (t === "application/msword" || t === "application/rtf" || t === "text/rtf") return "oldword";
  if (t.startsWith("text/") || /^application\/(json|xml|javascript|x-sh|x-yaml|yaml|sql)$/.test(t) || t.endsWith("+json") || t.endsWith("+xml")) return "text";
  return "other";
}

/**
 * The content type the attachment route may serve this file with, inline in the browser, or null (download only).
 * Text of any kind (code, CSV, HTML, SVG) is plain text, so it can never run as a page.
 */
export function inlineContentType(filename: string, contentType: string): string | null {
  const kind = fileKind(filename, contentType);
  const t = base(contentType);
  const e = extOf(filename);
  switch (kind) {
    case "pdf": return "application/pdf";
    case "image": return IMAGE_TYPES.has(t) ? t : IMAGE[e] ?? null;
    case "video": return VIDEO_TYPES.has(t) ? t : VIDEO[e] ?? null;
    case "audio": return AUDIO_TYPES.has(t) ? t : AUDIO[e] ?? null;
    case "text": case "csv": return "text/plain; charset=utf-8";
    default: return null;
  }
}

/** Whether a sandboxing Content-Security-Policy can go on the response (browsers' PDF and media viewers break under one). */
export const sandboxable = (inlineType: string | null) => !inlineType || !/^(application\/pdf|video\/|audio\/)/.test(inlineType);

/** The badge on a card: the extension, at most 5 letters. */
export const badgeOf = (filename: string) => (extOf(filename) || "file").slice(0, 5).toUpperCase();

const BADGE_COLOR: Record<string, string> = {
  PDF: "#e5483a", DOC: "#2f6bff", DOCX: "#2f6bff", ODT: "#2f6bff", RTF: "#2f6bff", XLS: "#1f9d55", XLSX: "#1f9d55", XLSM: "#1f9d55", ODS: "#1f9d55",
  CSV: "#64748b", TSV: "#64748b", PPT: "#e0662a", PPTX: "#e0662a", KEY: "#e0662a", JPG: "#a855f7", JPEG: "#a855f7", PNG: "#a855f7", GIF: "#a855f7",
  WEBP: "#a855f7", AVIF: "#a855f7", ZIP: "#8e8e93", MP4: "#ff375f", MOV: "#ff375f", WEBM: "#ff375f", MP3: "#14a3a6", M4A: "#14a3a6", WAV: "#14a3a6",
  GLB: "#f59e0b", GLTF: "#f59e0b", STL: "#f59e0b", BLEND: "#ea7600",
};
const KIND_COLOR: Partial<Record<FileKind, string>> = { image: "#a855f7", video: "#ff375f", audio: "#14a3a6", text: "#22c55e", sheet: "#1f9d55", model: "#f59e0b" };
export const badgeColor = (filename: string, kind: FileKind) => BADGE_COLOR[badgeOf(filename)] ?? KIND_COLOR[kind] ?? "#8e8e93";

export const KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF", image: "Photo", video: "Video", audio: "Audio", text: "Text", csv: "Table", sheet: "Excel", docx: "Word",
  zip: "ZIP", model: "3D model", slides: "PowerPoint", oldword: "Word", blender: "Blender", other: "File",
};

export const fileSizeLabel = (n: number) => (n >= 1_073_741_824 ? `${(n / 1_073_741_824).toFixed(1)} GB` : n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ---------------------------------------------------------------------------------------------------------------
// CSV / TSV

/** Picks the separator from the first line: tab, semicolon (European Excel) or comma. */
export function guessDelimiter(text: string, filename = ""): string {
  if (extOf(filename) === "tsv") return "\t";
  const first = text.slice(0, 4096).split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, "");
  const count = (c: string) => first.split(c).length - 1;
  const tabs = count("\t"), semis = count(";"), commas = count(",");
  if (tabs > 0 && tabs >= commas && tabs >= semis) return "\t";
  return semis > commas ? ";" : ",";
}

/**
 * Reads CSV (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes). Keeps the first `maxRows` rows and
 * counts the rest. A trailing empty line is not a row.
 */
export function parseDelimited(text: string, opts: { delimiter?: string; maxRows?: number; filename?: string } = {}): { rows: string[][]; total: number; delimiter: string } {
  const d = opts.delimiter ?? guessDelimiter(text, opts.filename);
  const max = opts.maxRows ?? 500;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let total = 0;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0] === "")) {
      if (rows.length < max) rows.push(row);
      total++;
    }
    row = [];
  };
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { quoted = true; i++; continue; }
    if (c === d) { row.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      endRow();
      i += c === "\r" && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c; i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return { rows, total, delimiter: d };
}

/** Spreadsheet column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(n: number): string {
  let s = "";
  for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Text files

/** Text from bytes: UTF-8 (or UTF-16 with a byte-order mark); null when the bytes look like a binary file. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const head = bytes.subarray(0, 8192);
  let odd = 0;
  for (const b of head) {
    if (b === 0) return null;
    if (b < 9 || (b > 13 && b < 32)) odd++;
  }
  if (head.length > 0 && odd / head.length > 0.1) return null;
  return new TextDecoder("utf-8").decode(bytes);
}

export type Token = { t: "" | "c" | "s" | "n" | "k" | "p" | "g"; v: string };

const KEYWORDS = new Set(("abstract as async await break case catch class const continue def default del do elif else enum export extends " +
  "false final finally fn for from func function go if impl import in interface is lambda let match mod module mut new nil none " +
  "not null or package pass private protected pub public raise return self static struct super switch this throw throws true try " +
  "type typeof undefined use val var void where while with yield select insert update delete into values create table drop alter " +
  "join left right inner outer on group order by having limit and echo fi then esac done").split(" "));

type Lang = "c" | "hash" | "markup" | "sql" | "css" | "json" | "plain";
export function langOf(filename: string): Lang {
  const e = extOf(filename);
  if (["json", "jsonl", "geojson"].includes(e)) return "json";
  if (["html", "htm", "xml", "svg", "vue", "svelte"].includes(e)) return "markup";
  if (["css", "scss", "less"].includes(e)) return "css";
  if (e === "sql") return "sql";
  if (["py", "rb", "sh", "bash", "zsh", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "properties", "r", "pl", "ps1"].includes(e)) return "hash";
  if (["js", "mjs", "cjs", "jsx", "ts", "tsx", "java", "kt", "kts", "swift", "go", "rs", "c", "h", "cpp", "hpp", "cc", "cs", "dart", "php", "gradle", "lua"].includes(e)) return "c";
  return "plain";
}

const STR = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`;
const PATTERNS: Record<Exclude<Lang, "plain">, RegExp> = {
  c: new RegExp(String.raw`(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(${STR}|\x60(?:[^\x60\\]|\\.)*\x60)|(\b\d[\d_.]*(?:[eE][+-]?\d+)?\b|\b0x[\da-fA-F]+\b)|([A-Za-z_$][\w$]*)`, "g"),
  hash: new RegExp(String.raw`(#[^\n]*)|(${STR})|(\b\d[\d_.]*\b)|([A-Za-z_][\w]*)`, "g"),
  sql: new RegExp(String.raw`(--[^\n]*|\/\*[\s\S]*?\*\/)|(${STR})|(\b\d[\d.]*\b)|([A-Za-z_][\w]*)`, "g"),
  css: new RegExp(String.raw`(\/\*[\s\S]*?\*\/)|(${STR})|(#[\da-fA-F]{3,8}\b|\b\d[\d.]*(?:px|em|rem|%|vh|vw|s|ms)?\b)|([\w-]+(?=\s*:))`, "g"),
  json: new RegExp(String.raw`()("(?:[^"\\\n]|\\.)*")|(-?\b\d[\d.]*(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b`, "g"),
  markup: new RegExp(String.raw`(<!--[\s\S]*?-->)|(${STR})|()(<\/?[A-Za-z][\w:.-]*|\/?>)`, "g"),
};

/** Simple colouring for code and text files, split into lines (for line numbers). */
export function tokenizeCode(text: string, filename: string): Token[][] {
  const lang = langOf(filename);
  const tokens: Token[] = [];
  if (lang === "plain") tokens.push({ t: "", v: text });
  else {
    const re = new RegExp(PATTERNS[lang].source, "g");
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0] === "") { re.lastIndex++; continue; }
      if (m.index > last) tokens.push({ t: "", v: text.slice(last, m.index) });
      let t: Token["t"] = "";
      if (m[1]) t = "c";
      else if (m[2]) t = lang === "json" && /^\s*:/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 8)) ? "p" : "s";
      else if (m[3]) t = "n";
      else if (m[4]) t = lang === "markup" ? "g" : lang === "css" ? "p" : lang === "json" ? "k" : KEYWORDS.has(m[4].toLowerCase()) && (lang === "sql" || m[4] === m[4].toLowerCase()) ? "k" : "";
      tokens.push({ t, v: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) tokens.push({ t: "", v: text.slice(last) });
  }
  const lines: Token[][] = [[]];
  for (const tok of tokens) {
    const parts = tok.v.split(/\r?\n/);
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ t: tok.t, v: p });
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Byte ranges (video and audio players ask for parts of a file)

/** A single "bytes=a-b" range within a file of `size` bytes; null when absent, "bad" when it cannot be served. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "bad" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return header.trim().startsWith("bytes=") && header.includes(",") ? null : "bad";
  let start: number, end: number;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return "bad";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "bad";
  return { start, end };
}
