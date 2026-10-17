// The fact check of a Claude design (docs/VIDEO_ENGINE.md): every on-screen text, say line and the caption are compared
// with the brief, and anything that looks like a fact the brief does not give is reported as a warning for the owner
// (nothing is removed). Checked: numbers (prices, specs, percentages, phone numbers), durations ("1-year", "12-month",
// compared by length, so "one-year" and "12-month" match) and claim words (new, refurbished, genuine, free, warranty,
// best ...). A claim found only in the business's general description is reported too, more softly: it is true of the
// shop, but may not be true of this product (a shop that sells "new and refurbished" phones advertising one new phone).
// Pure and unit tested.
import type { MotionSpec } from "./spec";

/** The facts the check compares with: the brief's business and product, and the owner's own line. */
export type FactBrief = {
  business: { name: string; description?: string | null; phone?: string | null; website?: string | null; country?: string | null };
  product: { name: string; summary?: string | null; description?: string | null; price?: string | null; usps?: string[]; features?: string[]; targetCustomer?: string | null };
  note?: string | null;
};

export type FactWarning = {
  /** Where it is: "scene 2 text", "scene 3 voice", "caption". */
  where: string;
  /** What was found ("refurbished", "15%", "2-year"). */
  found: string;
  /** not-in-brief: nowhere in the facts; business-only: only in the business's general description. */
  problem: "not-in-brief" | "business-only";
  message: string;
};

/** Claim words a design may only use when the facts say so (the owner's note counts as a fact). */
export const CLAIM_WORDS = [
  "new",
  "brand new",
  "refurbished",
  "genuine",
  "original",
  "authentic",
  "official",
  "free",
  "guarantee",
  "guaranteed",
  "warranty",
  "discount",
  "sale",
  "award",
  "award-winning",
  "best",
  "cheapest",
  "number one",
  "no. 1",
  "#1",
  "certified",
] as const;

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const NUMBER_WORD = `(?:${[...SMALL, ...TENS.filter(Boolean), "hundred", "thousand", "million", "point"].join("|")})`;
const NUMBER_RUN = new RegExp(`\\b${NUMBER_WORD}(?:[\\s-]+(?:and[\\s-]+)?${NUMBER_WORD})*\\b`, "g");

/** "four hundred and twenty thousand" -> 420000, "six point seven" -> 6.7, "fifty" -> 50. */
export function wordsToNumber(run: string): number {
  let total = 0;
  let current = 0;
  let decimals = "";
  let afterPoint = false;
  for (const w of run.split(/[\s-]+/).filter((x) => x && x !== "and")) {
    const small = SMALL.indexOf(w);
    if (afterPoint) decimals += small >= 0 ? String(small) : "";
    else if (w === "point") afterPoint = true;
    else if (small >= 0) current += small;
    else if (TENS.includes(w)) current += TENS.indexOf(w) * 10;
    else if (w === "hundred") current = (current || 1) * 100;
    else if (w === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else if (w === "million") {
      total += (current || 1) * 1_000_000;
      current = 0;
    }
  }
  return Number(`${total + current}${decimals ? `.${decimals}` : ""}`);
}

const HOURS: Record<string, number> = { year: 8760, month: 730, week: 168, day: 24, hour: 1 };

/** Lower case, accents off, number words as digits ("one-year" -> "1-year"), spaces collapsed. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(NUMBER_RUN, (run: string, at: number, all: string) => {
      // "one" on its own is usually a pronoun ("the one for you"), a number only before a unit ("one-year", "one %").
      if (run === "one" && !/^[\s-]*(?:years?|months?|weeks?|days?|hours?|%|percent)\b/.test(all.slice(at + run.length))) return run;
      return String(wordsToNumber(run));
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** "420,000" -> 420000, "420k" -> 420000, "6.7" -> 6.7. */
function value(raw: string, suffix = ""): number {
  const n = Number(raw.replace(/[,\s]/g, ""));
  return /^k$/i.test(suffix) ? n * 1000 : /^m$/i.test(suffix) ? n * 1_000_000 : n;
}

type Found = { text: string; kind: "number" | "duration" | "phone"; value: number };

/** The numbers, durations and phone-like digit runs in a (normalised) text. */
export function numbersIn(text: string): Found[] {
  const out: Found[] = [];
  let rest = text;
  // Phone numbers first (7+ digits with spaces, dashes or a +), so their groups are not read as separate numbers.
  rest = rest.replace(/\+?\d[\d\s-]{5,}\d/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 7 && !/[,.]/.test(m)) {
      out.push({ text: m.trim(), kind: "phone", value: Number(digits) });
      return " ";
    }
    return m;
  });
  rest = rest.replace(/(\d+(?:[.,]\d+)?)\s*-?\s*(years?|months?|weeks?|days?|hours?)\b/g, (m, n: string, unit: string) => {
    out.push({ text: m.trim(), kind: "duration", value: value(n) * HOURS[unit.replace(/s$/, "")] });
    return " ";
  });
  for (const m of rest.matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m)?\b/g)) out.push({ text: m[0].trim(), kind: "number", value: value(m[1], m[2] ?? "") });
  return out;
}

/** The phone's digits without the country code or a leading 0, so "0788 300 400" matches "+250 788 300 400". */
const phoneDigits = (digits: string) => digits.replace(/^(?:250|254|255|256|257|243)/, "").replace(/^0/, "");

const has = (text: string, word: string) => new RegExp(`(?:^|[^a-z0-9])${word.replace(/[.#]/g, (c) => `\\${c}`)}(?:$|[^a-z0-9])`).test(text);

/**
 * Compares a design with its brief. Returns one warning per thing found (the same thing in two places is reported
 * once, at its first place). An empty list means every number and claim in the design is in the facts.
 */
export function factCheck(spec: Pick<MotionSpec, "scenes" | "caption">, brief: FactBrief): FactWarning[] {
  const p = brief.product;
  const productFacts = normalise([p.name, p.summary, p.description, p.price, ...(p.usps ?? []), ...(p.features ?? []), p.targetCustomer, brief.business.name, brief.business.website, brief.note].filter(Boolean).join(" \n "));
  const businessFacts = normalise([brief.business.description, brief.business.country].filter(Boolean).join(" \n "));
  const allFacts = `${productFacts} \n ${businessFacts}`;
  const factNumbers = numbersIn(allFacts);
  const productNumbers = numbersIn(productFacts);
  const phone = phoneDigits((brief.business.phone ?? "").replace(/\D/g, ""));
  // Sizes of the lists in the facts ("black, light blue and pink" is 3), so "3 colours" counts as a fact.
  const listSizes = new Set(
    allFacts
      .split(/[\n.;:]/)
      .map((part) => part.split(/,|\band\b/).filter((x) => x.trim()).length)
      .filter((n) => n >= 2),
  );

  const places: { where: string; text: string }[] = [];
  spec.scenes.forEach((s, i) => {
    for (const l of s.layers) if (l.kind === "text") places.push({ where: `scene ${i + 1} text`, text: l.text });
    if (s.say) places.push({ where: `scene ${i + 1} voice`, text: s.say });
  });
  if (spec.caption) places.push({ where: "caption", text: spec.caption });

  const warnings: FactWarning[] = [];
  const seen = new Set<string>();
  const warn = (where: string, found: string, problem: FactWarning["problem"]) => {
    const key = `${problem}:${found}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push({
      where,
      found,
      problem,
      message: problem === "business-only" ? `"${found}" (${where}) is in the business description, not in this product's facts: check it is true of this product.` : `"${found}" (${where}) is not in the facts: check it or remove it.`,
    });
  };
  const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);

  for (const { where, text } of places) {
    const t = normalise(text);
    // A text that is only a small number is a list marker ("1", "#2", "3."), not a fact.
    if (/^#?\d{1,2}[.):]?$/.test(t) && Number(t.replace(/\D/g, "")) <= 10) continue;
    for (const n of numbersIn(t)) {
      if (n.kind === "phone") {
        const d = phoneDigits(String(n.value));
        if (!(phone && d.length >= 6 && (phone.endsWith(d) || d.endsWith(phone)))) warn(where, n.text, "not-in-brief");
        continue;
      }
      if (n.kind === "number" && Number.isInteger(n.value) && listSizes.has(n.value) && /^\d+$/.test(n.text)) continue;
      const inProduct = productNumbers.some((f) => f.kind === n.kind && same(f.value, n.value));
      if (inProduct) continue;
      const inAny = factNumbers.some((f) => f.kind === n.kind && same(f.value, n.value));
      // A plain number also matches the same number inside a phone or duration of the facts ("12" in "12-month").
      const loose = n.kind === "number" && numbersIn(allFacts.replace(/[-+]/g, " ").replace(/\b(years?|months?|weeks?|days?|hours?)\b/g, " ")).some((f) => same(f.value, n.value));
      if (inAny) warn(where, n.text, "business-only");
      else if (!loose) warn(where, n.text, "not-in-brief");
    }
    if (/%/.test(t) && !/%/.test(allFacts)) warn(where, (t.match(/\d+(?:\.\d+)?\s*%/) ?? ["%"])[0], "not-in-brief");
    for (const word of CLAIM_WORDS) {
      const claim = normalise(word);
      if (!has(t, claim)) continue;
      if (has(productFacts, claim)) continue;
      // "brand new" is still "new" when the facts say "new".
      if (claim === "brand new" && has(productFacts, "new")) continue;
      warn(where, claim, has(businessFacts, claim) ? "business-only" : "not-in-brief");
    }
  }
  return warnings;
}
