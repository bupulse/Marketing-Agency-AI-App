// The language check for the text the engines write (docs/research/BRAIN.md, "Checking the language"): on-screen
// text, voice lines and the post caption, against how Rwandan sellers actually write (docs/research/reels/captions.jsonl,
// 125 captions, 111 Rwandan, and the Kinyarwanda and French rows of tiktok.jsonl and facebook.jsonl). A word-list check,
// not a translator: it only flags forms the corpus never uses, because a false alarm costs the owner more than a miss.
// Pure.
import type { MotionSpec } from "../spec";
import { looksKinyarwanda, voiceLanguage } from "../voice-language";

/**
 * Kinyarwanda words Rwandan sellers write in captions, by use (captions-patterns.md, "Recurring words"). The corpus
 * spellings are kept: "tuyikujyezaho", "uduhamagare".
 */
export const KINYARWANDA_COMMERCE = {
  callToAction: ["duhamagare", "hamagara", "uhamagare", "uduhamagare", "waduhamagara", "twandikire", "utwandikire", "ukatwandikira", "tuvugishe", "gura", "iyandikishe"],
  price: ["igiciro", "kuri", "gusa", "kiraganirwaho", "ubuntu"],
  selling: ["igurishwa", "bigurishwa", "iragurishwa", "tuguha", "tuyikujyezaho", "ibyangombwa", "birahari"],
  urgency: ["ntucikwe", "amahirwe"],
  /** "Karibu" is Swahili, used as a welcome by Kigali sellers next to the number. */
  greeting: ["murakaza neza", "murakazaneza", "muraho", "karibu"],
  people: ["abakiriya", "barishimye", "nawe"],
  /** Grammar words, used to tell a Kinyarwanda clause from an English one. */
  grammar: ["ni", "na", "kuri", "mu", "ku", "iyi", "izi", "kandi", "cyangwa", "cg", "aya", "uyu", "ibi", "iki", "ariko", "muri", "yawe", "wawe", "yose", "aho"],
} as const;

/** The French the corpus uses (one Kigali wine post and the designer's own French templates). */
export const FRENCH_COMMERCE = {
  callToAction: ["commandez", "appelez", "contactez", "écrivez", "réservez", "venez"],
  selling: ["disponible", "chez", "prix", "livraison", "gratuite"],
  grammar: ["le", "la", "les", "des", "du", "pour", "avec", "chez", "est", "et", "votre", "vous", "sur", "une", "un", "au", "aux"],
} as const;

const ENGLISH_GRAMMAR = ["the", "and", "with", "your", "for", "of", "to", "is", "are", "this", "our", "you", "we", "at", "in", "on"];

/** What Rwandan sellers write, to give the designer instead of a literal translation. */
export const PREFERRED_PHRASES: { say: string; for: string }[] = [
  { say: "Duhamagare cyangwa utwandikire kuri WhatsApp: {phone}", for: "call or WhatsApp us" },
  { say: "Twandikire kuri WhatsApp {phone}", for: "message us on WhatsApp" },
  { say: "Uduhamagare kuri {phone}", for: "call us on" },
  { say: "{product} kuri {price} gusa", for: "{product} for only {price}" },
  { say: "Igiciro: {price}", for: "price" },
  { say: "Kiraganirwaho", for: "negotiable" },
  { say: "Ntucikwe!", for: "don't miss it" },
  { say: "Free delivery / tuyikujyezaho", for: "free delivery / we bring it to you" },
  { say: "Murakaza neza / Karibu", for: "welcome" },
  { say: "Waduhamagara cg ukatwandikira {phone}", for: "call or write to us" },
  { say: "Abakiriya bacu barishimye", for: "our customers are happy" },
  { say: "Iragurishwa / bigurishwa", for: "for sale" },
  { say: "Ibyangombwa birahari", for: "the papers are ready (property)" },
];

/** Kinyarwanda in a text: a sentence that reads as Kinyarwanda, or two of the sellers' own words (a mixed caption counts). */
const CAPTION_RW = /\b(duhamagare|hamagara|uhamagare|uduhamagare|waduhamagara|twandikire|utwandikire|ukatwandikira|dukorera|tuvugishe|igiciro|igurishwa|bigurishwa|iragurishwa|ntucikwe|gusa|ubuntu|tuguha|tuyikujyezaho|kiraganirwaho|abakiriya|barishimye|murakaza|murakazaneza|ibyangombwa|birahari|ushaka|cyangwa|nziza|inzu|ibibanza|iyi|izi|kandi|ariko|igihe|ese|ufite|waba|uburyo|amahirwe|muri|yawe|wawe|yose|ubu|aho|umwana|ubucuruzi|uramutse|kuri|mu|ku|ni|na)\b/gi;
export function hasKinyarwanda(text: string): boolean {
  const plain = text.replace(/#[\p{L}\p{N}_]+/gu, " ");
  if (plain.split(/[.!?\n]+/).some((x) => looksKinyarwanda(x))) return true;
  return new Set((plain.match(CAPTION_RW) ?? []).map((w) => w.toLowerCase())).size >= 2;
}

export type LanguageText = { where: string; text: string; kind?: "screen" | "caption" | "voice" };
export type LanguageIssue = {
  code: "price-format" | "english-cta" | "mixed-line" | "not-clickable" | "literal-translation";
  where: string;
  /** The words that raised it, as written. */
  found: string;
  message: string;
  /** What Rwandan sellers write instead, when there is one. */
  suggestion: string | null;
};

// Price forms the corpus never writes after a number: "francs" and its literal Kinyarwanda translation (RWF, Frw, FRW,
// rfw, k and M are the forms used), and thousands with dots or spaces (the corpus writes 420,000 or 420000).
const PRICE_WORDS = /\d[\d,]*\s*(francs?|frs?\.?|fcfa|rwandan francs|amafaranga y['’]u rwanda|amafaranga)(?![\p{L}])/iu;
const PRICE_GROUPS = /\b\d{1,3}(?:[. ]\d{3})+\s*(rwf|frw|rfw)\b/i;
// English calls to action that none of the 63 Kinyarwanda and mixed Rwandan texts uses ("Call/WhatsApp:" is used, and allowed).
const ENGLISH_CTA = /\b(call now|call us|order now|order yours|contact us|buy now|book now|dm us|send us a message|shop now|get yours|click the link|link in bio)\b/i;
// Web words on a video frame, which nobody can click.
const CLICK_WORDS = /\b(kanda (hano|kuri link)|click (here|the link|below)|tap (here|the link)|swipe up|link in bio|cliquez( ici| sur le lien)?)\b/i;
// Literal translations the corpus never uses, with what sellers write instead.
const LITERAL: [RegExp, string][] = [
  [/amafaranga y['’]u rwanda/i, "RWF (\"420,000 RWF\") or \"kuri 420k gusa\""],
  [/kohereza ku ?buntu/i, "\"Free delivery\" (as Rwandan sellers write it) or \"tuyikujyezaho\""],
];

const words = (s: string) => s.toLowerCase().match(/[\p{L}']+/gu) ?? [];
const count = (list: readonly string[], ws: string[]) => ws.filter((w) => list.includes(w)).length;

/**
 * The language issues in the texts an engine wrote, for a business whose content language is `language`. Voice lines
 * are checked only when the voice speaks the content language (a Kinyarwanda business's voice speaks English by rule);
 * prices only on screen and in the caption (the voice says "francs" on purpose). Pure.
 */
export function checkLanguage(texts: (string | LanguageText)[], language: string | null | undefined): LanguageIssue[] {
  const v = voiceLanguage(language);
  const content = v.captionLanguage;
  const kinyarwanda = content === "Kinyarwanda";
  const french = content === "French";
  const issues: LanguageIssue[] = [];
  const items = texts.map((t, i) => (typeof t === "string" ? { where: `text ${i + 1}`, text: t, kind: "caption" as const } : { kind: "caption" as const, ...t }));
  for (const { where, text, kind } of items) {
    if (!text?.trim()) continue;
    if (kind === "voice" && v.spokenLanguage !== content) continue;
    const add = (code: LanguageIssue["code"], found: string, message: string, suggestion: string | null = null) => issues.push({ code, where, found, message, suggestion });

    if (kind !== "voice") {
      const pw = text.match(PRICE_WORDS);
      if (pw) add("price-format", pw[0], `"${pw[0]}": Rwandan sellers write prices as "420,000 RWF", "420k" or "Frw", not "${pw[1]}".`, kinyarwanda ? "kuri {price} gusa / Igiciro: {price} RWF" : "{price} RWF");
      const pg = text.match(PRICE_GROUPS);
      if (pg) add("price-format", pg[0], `"${pg[0]}": write the thousands with commas ("420,000 RWF"), as the corpus does.`, pg[0].replace(/[. ](?=\d{3})/g, ","));
    }
    if (kind === "screen") {
      const c = text.match(CLICK_WORDS);
      if (c) add("not-clickable", c[0], `"${c[0]}" on the video: nobody can click a video frame. Put the link or the instruction in the caption.`);
    }
    if (kinyarwanda && kind !== "voice") {
      const cta = text.match(ENGLISH_CTA);
      if (cta) add("english-cta", cta[0], `"${cta[0]}" in a Kinyarwanda ${kind === "screen" ? "video" : "caption"}: Rwandan sellers write "Duhamagare" or "Twandikire kuri WhatsApp".`, "Duhamagare cyangwa utwandikire kuri WhatsApp: {phone}");
    }
    if (french && kind !== "voice") {
      const cta = text.match(ENGLISH_CTA);
      if (cta) add("english-cta", cta[0], `"${cta[0]}" in a French ${kind === "screen" ? "video" : "caption"}: write it in French.`, "Appelez-nous / Écrivez-nous sur WhatsApp : {phone}");
    }
    for (const [re, instead] of LITERAL) {
      const m = text.match(re);
      if (m) add("literal-translation", m[0], `"${m[0]}" reads like a word-for-word translation; Rwandan sellers write ${instead}.`, instead);
    }
    // One sentence built from two languages' grammar words: the corpus switches language between sentences or keeps a
    // product name or "free delivery" inside a Kinyarwanda sentence, but never mixes the grammar itself.
    for (const sentence of text.split(/[.!?\n]+/)) {
      const ws = words(sentence);
      const rw = count(KINYARWANDA_COMMERCE.grammar, ws);
      const en = count(ENGLISH_GRAMMAR, ws);
      const fr = count(FRENCH_COMMERCE.grammar, ws);
      if (rw >= 2 && (en >= 2 || fr >= 2)) add("mixed-line", sentence.trim().slice(0, 80), `"${sentence.trim().slice(0, 60)}" mixes ${en >= 2 ? "English" : "French"} and Kinyarwanda grammar in one sentence; keep one language per sentence (a product name or "free delivery" inside is fine).`);
    }
  }
  return issues;
}

/** The texts of a design, ready for checkLanguage: every on-screen line, every voice line and the caption. */
export function languageTextsOf(spec: Pick<MotionSpec, "scenes" | "caption">): LanguageText[] {
  const out: LanguageText[] = [];
  spec.scenes.forEach((s, i) => {
    for (const l of s.layers) if (l.kind === "text" && l.text.trim()) out.push({ where: `scene ${i + 1} text`, text: l.text, kind: "screen" });
    if (s.say?.trim()) out.push({ where: `scene ${i + 1} voice`, text: s.say, kind: "voice" });
  });
  if (spec.caption?.trim()) out.push({ where: "caption", text: spec.caption, kind: "caption" });
  return out;
}
