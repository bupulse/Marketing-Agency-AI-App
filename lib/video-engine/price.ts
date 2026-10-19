// A product's price as the video engine uses it (docs/VIRAL_RECIPES.md, "Prices"). Owners often write a paragraph in
// the price field ("From 250,000 RWF · delivery extra, installment possible, final pricing depends on the size"):
// the video and the caption's first line show only the amount with its condition ("from 250,000 RWF", "50,000 RWF
// per day"), and the rest stays a fact for the caption's later lines. Pure, shared by the designer, the Brain, the fact
// check and the studio's pages.

/** Where the amount ends and the owner's notes begin: " · ", a bracket, a bar, a new line, " - ", "; " or a sentence end. */
const NOTES_START = /\s*[(·|\n;]|\s+[-–—]\s+|\.\s+(?=\p{Lu}|\p{Ll}{3,})/u;
const AMOUNT = /(?:(?:rwf|frw|rfw|kes|ksh|ugx|tzs|tsh|usd|\$|€|£)\s*)?\d{1,3}(?:[,.\s]\d{3})+(?:\.\d+)?\s*(?:[km]\b)?|(?:(?:rwf|frw|rfw|kes|ksh|ugx|tzs|tsh|usd|\$|€|£)\s*)?\d+(?:\.\d+)?\s*(?:[km]\b)?/i;
const CURRENCY_AFTER = /^\s*(rwf|frw|rfw|kes|ksh|ugx|tzs|tsh|usd|francs?|fr\b)/i;
const FROM = /\b(from|starting at|starts at|à partir de|dès|guhera)\b/i;
const CONDITION = /\b(?:per|a|an|each|\/)\s*(?:day|night|month|week|person|hour|kg|kilo|piece|plate|unit|metre|meter|m2|year|session|class|head)\b|\/\s*(?:day|night|month|week|kg|piece|person)\b|\bfor \d+ (?:nights?|days?|months?|people|persons|pieces)\b|\bwith extension\b|\bper\b \w+/i;
const MAX = 32;

/** The price field split in two: the amount with its condition, and the owner's notes after it (null when none). */
export function splitPrice(price: string | null | undefined): { short: string | null; notes: string | null } {
  const text = (price ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { short: null, notes: null };
  // "was 300,000 now 250,000": the price is the one it costs now.
  const now = text.match(/\bnow\b\s*:?\s*(.+)$/i);
  const cut = text.search(NOTES_START);
  const head = (now ? now[1] : cut > 0 ? text.slice(0, cut) : text).replace(/[\s,:;.]+$/, "").trim();
  const rest = (now ? text.slice(0, now.index).replace(/\bwas\b\s*:?/i, "").trim() : cut > 0 ? text.slice(cut) : "").replace(/^[\s(·|;,.\-–—]+|[\s)]+$/g, "").trim();
  const amount = head.match(AMOUNT);
  let short = head;
  let left = "";
  if (amount && head.length > MAX) {
    // A long head: the amount, its currency, and its condition only; the words after them join the notes.
    const end = (amount.index ?? 0) + amount[0].length;
    const currency = /[a-z$€£]/i.test(amount[0]) ? null : head.slice(end).match(CURRENCY_AFTER);
    const condition = head.match(CONDITION)?.[0] ?? "";
    const from = head.slice(0, amount.index).match(FROM)?.[0].toLowerCase();
    short = `${from ? `${from} ` : ""}${amount[0].trim()}${currency ? ` ${currency[1]}` : ""}${condition ? ` ${condition}` : ""}`;
    left = head.slice(end + (currency ? currency[0].length : 0)).replace(condition, "").replace(/^[\s,;:.-]+/, "").trim();
  }
  // The notes read as a list: brackets go ("(delivery extra) · installment possible" -> "delivery extra · installment possible").
  const notes = [left, rest].filter(Boolean).join(" · ").replace(/\s*[()]\s*/g, " ").replace(/\s+·/g, " ·").replace(/\s{2,}/g, " ").trim() || null;
  return { short: short || null, notes };
}

/** The amount with its condition: "from 250,000 RWF", "50,000 RWF per day"; null when the field is empty. */
export const shortPrice = (price: string | null | undefined): string | null => splitPrice(price).short;
/** The owner's notes after the amount ("delivery extra · installment possible"), or null. */
export const priceNotes = (price: string | null | undefined): string | null => splitPrice(price).notes;

/** A product with its price split: `price` short, `priceNotes` the rest. Leaves a product already split as it is. */
export function withShortPrice<T extends { price?: string | null; priceNotes?: string | null }>(product: T): T {
  if (!product.price || product.priceNotes !== undefined) return product;
  const { short, notes } = splitPrice(product.price);
  return { ...product, price: short, priceNotes: notes };
}
