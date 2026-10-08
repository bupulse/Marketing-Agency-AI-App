// Text helpers for store data: plain text from HTML, trimmed lists.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "..." };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Plain text from store HTML: tags dropped, block tags become line breaks, entities decoded. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(withBreaks)
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Unique, trimmed, clipped feature lines (the studio allows 20 of up to 200 characters). */
export function cleanFeatures(lines: (string | null | undefined)[], max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = clip(decodeEntities(raw ?? "").replace(/\s+/g, " "), 200);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/** "$19.00" for a plain amount and ISO currency code; falls back to "19.00 XYZ" for unknown codes. */
export function formatPrice(amount: string | number, currency: string | null | undefined): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  if (currency) {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency}`;
    }
  }
  return n.toFixed(2);
}
