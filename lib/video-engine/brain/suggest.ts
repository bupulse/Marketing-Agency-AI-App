// Ready-to-use opening lines for the Create page (docs/research/BRAIN.md, "Opening lines for the owner"): the brain's
// best hooks for the sector and platform, each filled in from the brief's own facts (product, price, area, number,
// offer...), in the business's language, at most 7 words on screen, and passing the language check. A hook that needs
// a fact the brief lacks is skipped. Pure, no I/O.
import { BRAIN, evidenceById, formatById, hookById, sectorById } from "./database";
import { checkLanguage } from "./language";
import { rankWithOutcomes } from "./outcomes";
import { formatFromTemplate, rankHooks, sectorFromText } from "./select";
import type { Evidence, Hook, Outcome, Platform, Purpose, SectorId } from "./types";

/** The facts a suggestion may use. A DesignBrief fits this shape. */
export type SuggestBrief = {
  business: { name: string; description?: string | null; language?: string | null; phone?: string | null; country?: string | null };
  product: { name: string; summary?: string | null; description?: string | null; price?: string | null; usps?: string[]; features?: string[] };
  note?: string | null;
  styleId?: string | null;
  seconds?: number;
  /** An ad (the default) or a post on the business's own page: a post gets no price or contact lines. */
  purpose?: Purpose | null;
};
export type HookSuggestion = {
  hookId: string;
  /** The hook's name in the brain ("Price banner from frame 0"). */
  name: string;
  /** The on-screen opening line, ready to use (at most 7 words). */
  line: string;
  /** One plain sentence on why, from the research. */
  why: string;
  /** The research rows behind it (up to 3, strongest first). */
  evidence: string[];
};

/** The most words an opening line may have on screen (separators like "·" and "|" do not count). */
export const MAX_HOOK_WORDS = 7;

// ---- Facts from the brief, written the way the corpus writes them

/** Neighbourhoods first, districts last: "Kibagabaga" says more than "Gasabo". */
const AREAS = ["Kimironko", "Remera", "Kacyiru", "Kiyovu", "Nyamirambo", "Gishushu", "Kibagabaga", "Kabeza", "Kanombe", "Gikondo", "Nyarutarama", "Kagugu", "Kinyinya", "Gacuriro", "Masaka", "Kimihurura", "Muhima", "Kisimenti", "Sonatube", "Downtown", "Kicukiro", "Gasabo", "Nyarugenge"];
const TOWNS = ["Kigali", "Musanze", "Rubavu", "Huye", "Nairobi", "Kampala"];
const INSURERS = ["RSSB", "MMI", "Mituelle", "Mutuelle", "Old Mutual", "Sanlam", "Radiant", "Britam", "SONARWA", "Eden Care", "EDENCARE", "Prime"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const factsText = (b: SuggestBrief) => [b.business.name, b.business.description, b.product.name, b.product.summary, b.product.description, ...(b.product.usps ?? []), ...(b.product.features ?? []), b.note].filter(Boolean).join(" \n ");
const found = (list: string[], text: string) => list.find((w) => new RegExp(`\\b${w}\\b`, "i").test(text)) ?? null;

/** "420000" -> "420,000 RWF", 180000000 -> "180M RWF", 1500000 -> "1.5M RWF". */
function rwf(value: number): string {
  if (value >= 1_000_000) return `${String(Math.round((value / 1_000_000) * 10) / 10)}M RWF`;
  return `${value.toLocaleString("en-US")} RWF`;
}
/** The price as a short label with its condition ("from 25,000 RWF", "50,000 RWF per day"); null when there is none. */
function priceLabel(price: string | null | undefined): string | null {
  const p = price?.trim();
  if (!p) return null;
  const nums = [...p.matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM]\b)?/g)].map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? (/k/i.test(m[2]) ? 1000 : 1_000_000) : 1));
  if (!nums.length) return null;
  if (/\b(was|now|avant)\b/i.test(p)) return rwf(nums[nums.length - 1]);
  const before = /\bfrom\b|\bdès\b|\bà partir de\b/i.test(p) ? "from " : "";
  const after = p.match(/\b(per (day|night|month|week|person|hour)|a (day|night|month|week)|\/ ?(month|day|night))\b/i)?.[0] ?? "";
  return `${before}${rwf(nums[0])}${after ? ` ${after.replace(/^\/ ?/, "per ")}` : ""}`;
}
const oldPriceLabel = (price: string | null | undefined) => {
  const m = price?.match(/\bwas\b\s*([\d,.]+\s*[kKmM]?)/i);
  return m ? priceLabel(m[1]) : null;
};
/** The number grouped the way Rwandans read it: 0788 300 400. */
function phoneLabel(phone: string | null | undefined): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("250") && d.length === 12) d = `0${d.slice(3)}`;
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : phone!.trim();
}
/** A short product name: the part before "for sale", "in ...", a comma or a dash; at most 4 words. */
function shortProduct(name: string): string {
  const cut = name.split(/\s+(?:for sale|for rent|in|at|ku|i)\s+|,|\s[-–]\s/i)[0].trim();
  return cut.split(/\s+/).slice(0, 4).join(" ");
}
/** The offer in a few words, normalised the way the corpus writes it ("BUY 1 GET 1 FREE EVERY TUESDAY"). */
function offerLabel(note: string | null | undefined): string | null {
  const n = note?.trim();
  if (!n) return null;
  const day = WEEKDAYS.find((d) => new RegExp(`\\bevery ${d}\\b`, "i").test(n));
  if (/\bbuy (one|1)\b.*\bget (one|1)\b.*\bfree\b/i.test(n)) return `BUY 1 GET 1 FREE${day ? ` EVERY ${day.toUpperCase()}` : ""}`;
  const pct = n.match(/\b(\d{1,2})\s?% off\b/i);
  if (pct) return `${pct[1]}% OFF`;
  const words = n.split(/\s+/);
  return /\b(free|promo|offer|discount|deal)\b/i.test(n) && words.length <= 6 ? n.replace(/[.!]+$/, "") : null;
}

export type Facts = {
  product: string; price: string | null; oldPrice: string | null; phone: string | null; area: string | null; city: string | null;
  offer: string | null; delivery: boolean; year: string | null; branches: string | null; insurers: string[]; bedrooms: string | null; spec: string | null; reasons: number;
  /** For a treatment or a repair, the problem it fixes ("Acne treatment" -> "acne"); null for a product. */
  problem: string | null;
  /** A named building or landmark ("Makuza Peace Plaza", "T2000 House", "Room 35"), the way Kigali gives directions. */
  landmark: string | null;
};
/** The brief's facts as suggestions use them (the series planner shares the number and the area). */
export function briefFacts(b: SuggestBrief): Facts {
  const text = factsText(b);
  // The product's own place first (a house in Kibagabaga sold by an agency in Gasabo), then the business's.
  const productText = [b.product.name, b.product.summary, b.product.description].filter(Boolean).join(" ");
  const area = found(AREAS, productText) ?? found(AREAS, text);
  const city = found(TOWNS, text) ?? (area ? "Kigali" : null);
  const spec = [...(b.product.features ?? []), ...(b.product.usps ?? [])].find((f) => f.split(/\s+/).length <= 3) ?? null;
  return {
    product: shortProduct(b.product.name),
    price: priceLabel(b.product.price),
    oldPrice: oldPriceLabel(b.product.price),
    phone: phoneLabel(b.business.phone),
    area,
    city,
    offer: offerLabel(b.note),
    delivery: /\b(free delivery|livraison gratuite|tukugezaho|tuyikujyezaho|tuyikugezaho)\b/i.test(text),
    year: text.match(/\bsince (\d{4})\b|\bdepuis (\d{4})\b/i)?.slice(1).find(Boolean) ?? null,
    branches: text.match(/\b(\d{1,2}) branches\b/i)?.[1] ?? null,
    insurers: INSURERS.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text)).slice(0, 3),
    bedrooms: text.match(/\b(\d) ?(?:-| )?bed(?:room)?s?\b|\bibyumba (\d)\b/i)?.slice(1).find(Boolean) ?? null,
    spec,
    reasons: (b.product.usps ?? []).length + (b.product.features ?? []).length,
    landmark: text.match(/\b((?:[A-Z][\w']*|\d+)(?:\s+(?:[A-Z][\w']*|\d+)){0,3}\s+(?:Plaza|House|Building|Mall|Tower|Centre|Center|Market|Arcade))\b(?:,?\s+(Room\s+\d+\w?))?/)?.slice(1).filter(Boolean).join(", ") ?? null,
    problem: b.product.name.match(/^(.{2,30}?)\s+(treatment|removal|repair|therapy|care)$/i)?.[1].toLowerCase() ?? null,
  };
}

// ---- One line template per hook. {placeholders} are facts; a template whose facts are missing is skipped.
// "any": language-neutral (names, numbers, "WhatsApp"); en, rw, fr: the line in that language (rw only in forms the
// corpus shows: "kuri ... gusa", "INZU IGURISHWA I ...", "KURI ... TUGUHA ...").

/** Each language may list fallbacks, tried in order (a clinic with a founding year but no branch count). */
type Template = { any?: string | string[]; en?: string | string[]; rw?: string | string[]; fr?: string | string[] };
const LINES: Record<string, Template> = {
  "price-banner": { any: "{product} · {price}", rw: "{product} kuri {price} gusa", fr: "{product} à {price}" },
  "promo-price": { en: "PROMO: {product} for {price}", rw: "PROMO: {product} kuri {price} · Ntucikwe!", fr: "PROMO : {product} à {price}" },
  "was-now": { en: "Was {oldPrice}, now {price}", fr: "Avant {oldPrice}, maintenant {price}" },
  "price-on-each": { any: "{product} {price}" },
  "number-in-hand": { any: "{product} · WhatsApp {phone}" },
  "counter-price-bar": { any: "{product} | {price} | {phone}" },
  "price-card-split": { any: "{product} | {price}" },
  "kinyarwanda-price-line": { rw: "KURI {price} TUGUHA {product}" },
  "offer-badge-day": { any: "{offer}" },
  "percent-free-delivery": { en: "{offer} + free delivery in {city}" },
  "poster-first": { any: "{offer} · {area}" },
  "pov-local-find": { en: "POV: you found {product} in {city}" },
  // Moments for page posts (a walk in, a look around, a relatable line); facts only, no price or number.
  "door-open-walk": { en: "Step inside our shop in {city}" },
  "whip-in-tour": { en: "A quick look around {area}" },
  "me-when": { en: "Me when {product} finally arrives" },
  "now-available": { en: "{product} is here" },
  "model-badge": { en: "{product} available now" },
  "location-stack": { any: ["{CITY} · {AREA} | {bedrooms} BEDROOMS | {price}", "{CITY} · {AREA} | {price}"], rw: "INZU IGURISHWA I {AREA} · {price}" },
  "what-x-buys": { en: "What {price} buys in {city}" },
  "spec-words": { any: "{product} · {spec}" },
  "trust-number": { en: ["Since {year} · {branches} branches in {city}", "Since {year} in {city}"], fr: ["Depuis {year} · {branches} agences", "Depuis {year} à {city}"] },
  "insurers-accepted": { en: "We take {insurers}", fr: "Nous acceptons {insurers}" },
  "pain-question": { en: "Still dealing with {problem}?", fr: "Encore des problèmes de {problem} ?" },
  "service-claim": { any: "{area}, {city} · {phone}" },
  "result-first": { en: "Wait for it...", fr: "Attendez la fin..." },
  "before-after-word": { en: "before... | after" },
  "numbered-list": { en: "{reasons} reasons to choose {product}" },
  "talk-to-city": { en: "{city}, we need to talk." },
  "unwrap-reveal": { en: "Unboxing {product}" },
  "empty-frame": { en: "You forgot something!" },
  "how-it-changes": { en: "How {product} changes your space" },
  "search-bar": { en: "why choose {product}" },
  "colour-swap": { any: "{product} · {phone}" },
  "menu-card-loop": { en: "{product} {price} | ORDER NOW" },
};

/** The language key of a business content language. */
const langKey = (language: string | null | undefined): "en" | "rw" | "fr" | "other" => {
  const l = (language ?? "English").trim().toLowerCase();
  if (/^(rw|kin|kinyarwanda|ikinyarwanda)$/.test(l)) return "rw";
  if (/^(fr|french|français|francais)$/.test(l)) return "fr";
  return /^(en|english)$/.test(l) ? "en" : "other";
};

function fill(template: string, f: Facts): string | null {
  const values: Record<string, string | null> = {
    product: f.product, price: f.price, oldPrice: f.oldPrice, phone: f.phone, area: f.area, AREA: f.area?.toUpperCase() ?? null, city: f.city, CITY: f.city?.toUpperCase() ?? null,
    offer: f.offer, year: f.year, branches: f.branches, insurers: f.insurers.length ? f.insurers.join(", ") : null, bedrooms: f.bedrooms, spec: f.spec, reasons: f.reasons >= 3 ? "3" : null, problem: f.problem,
  };
  let missing = false;
  const line = template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = values[k];
    if (!v) missing = true;
    return v ?? "";
  });
  return missing ? null : line.replace(/\s+/g, " ").trim();
}
const wordCount = (line: string) => line.split(/\s+/).filter((w) => w && !/^[·|/:+]+$/.test(w)).length;

/**
 * The first comment for the seller to pin under the post (brain/data/captions.json firstComment, from the Instagram
 * comments study): the price, the place, delivery and the WhatsApp number, one line each, in Kinyarwanda for a
 * Kinyarwanda business (the researcher's reply-kit lines), else English. Lines whose facts the brief lacks are left
 * out; delivery only when the brief says the business delivers. Null when fewer than two lines are left. Pure.
 */
export function firstCommentFor(brief: SuggestBrief): { text: string; lines: string[] } | null {
  const f = briefFacts(brief);
  const delivers = f.delivery || /\b(deliver(y|ies)?|we deliver|livraison|turohereza|tukugezaho)\b/i.test(factsText(brief));
  const place = f.landmark ? [f.landmark, f.area ?? f.city].filter(Boolean).join(", ") : [f.area, f.city].filter((x, i, a) => x && a.indexOf(x) === i).join(", ") || null;
  const values: Record<string, string | null> = {
    price: f.price,
    place,
    area: f.area ?? f.city,
    city: delivers ? f.city ?? "Kigali" : null,
    delivery: delivers ? (f.delivery ? `free in ${f.city ?? "Kigali"}` : "available") : null,
    phone: f.phone,
  };
  const guide = BRAIN.captions.firstComment;
  const rw = langKey(brief.business.language) === "rw";
  const lines = (rw ? guide.rw : guide.en)
    .map((line) => (rw && line.includes("{landmark}") && !f.landmark ? line.replace(/, hafi ya \{landmark\}/, "") : line.replace("{landmark}", f.landmark ?? "")))
    .map((line) => {
      let missing = false;
      const out = line.replace(/\{(\w+)\}/g, (_, k: string) => {
        if (!values[k]) missing = true;
        return values[k] ?? "";
      });
      return missing ? null : out;
    })
    .filter((x): x is string => !!x);
  return lines.length >= 2 ? { text: lines.join("\n"), lines } : null;
}

/** The brief's sector, from its business and product words. */
export const briefSector = (brief: SuggestBrief): SectorId => sectorFromText([brief.business.name, brief.business.description, brief.product.name, brief.product.summary].filter(Boolean).join(" "));

/** One plain sentence on why a hook, from its research rows (how many, how many Rwandan, its strongest signal). */
function whyOf(h: Hook, sector: SectorId): { why: string; evidence: string[] } {
  const all = h.evidence.map(evidenceById).filter((e): e is Evidence => !!e && !e.scam);
  // The signal comes from rows of the same sector when the researcher tagged any ("clinics/pharmacies" for a clinic).
  const same = all.filter((e) => e.sector && sectorFromText(e.sector) === sector);
  const rows = same.length ? same : all;
  const top = [...rows].sort((a, z) => z.strength - a.strength).slice(0, 3);
  const rw = all.filter((e) => e.country === "RW").length;
  const best = [...rows].sort((a, z) => (z.runningDays ?? 0) - (a.runningDays ?? 0))[0];
  const liked = [...rows].sort((a, z) => (z.likes ?? 0) - (a.likes ?? 0))[0];
  const signal = best?.runningDays && best.runningDays >= 90 ? `${best.who} ran it for ${best.runningDays} days on Facebook` : liked?.likes && liked.likes >= 500 ? `${liked.who}'s video got ${liked.likes >= 1000 ? `${Math.round(liked.likes / 100) / 10}K` : liked.likes} likes` : null;
  const forSector = h.sectors.includes(sector) ? ` for ${sectorById(sector)!.name.toLowerCase()}` : "";
  const price = h.type === "price-first" ? ", and viewers ask the price in a fifth of comments when it is missing" : "";
  return {
    why: `Seen in ${all.length} research video${all.length === 1 ? "" : "s"}${forSector}${rw ? `, ${rw} of them Rwandan` : ""}${signal ? `; ${signal}` : ""}${price}.`,
    evidence: top.map((e) => e.id),
  };
}

/**
 * Up to `count` ready-to-use opening lines for a brief: the brain's best hooks for its sector and platform (re-ranked
 * by BuPulse's own results when `outcomes` are given), each filled in from the brief's facts, in its language, at most
 * MAX_HOOK_WORDS words and passing checkLanguage. Clinics and schools never get a price hook (they lead with trust).
 * Pure and deterministic.
 */
export function suggestHooks(brief: SuggestBrief, opts: { platform?: Platform | "any" | null; count?: number; outcomes?: Outcome[] | null; businessId?: string | null; sector?: SectorId | null; presenter?: boolean; purpose?: Purpose | null } = {}): HookSuggestion[] {
  const count = opts.count ?? 3;
  const f = briefFacts(brief);
  const sector = opts.sector ?? briefSector(brief);
  // A page post (Ads and page posts, BRAIN.md): no price or contact hooks and no offer format without an offer, as brainFor.
  const purpose: Purpose = (opts.purpose ?? brief.purpose) === "post" ? "post" : "ad";
  const post = purpose === "post";
  const sectorFormat = sectorById(sector)!.formats.find((id) => formatById(id)?.engines.includes("claude") && !(post && id === "offer" && !f.offer));
  const format = formatById(formatFromTemplate(brief.styleId)) ?? formatById(sectorFormat ?? (post ? "tour" : "product-reveal"))!;
  const platform = opts.platform ?? "any";
  const lang = langKey(brief.business.language);
  const ranked = rankHooks(
    { platform, sector, format: format.id, engine: "claude", language: brief.business.language, hasPrice: !!f.price, hasPhone: !!f.phone, hasOffer: !!f.offer, hasOldPrice: !!f.oldPrice, hasLocation: !!f.area, hasPresenter: !!opts.presenter, seconds: brief.seconds ?? format.refSeconds, purpose },
    sector,
    format,
  );
  const order = opts.outcomes?.length ? rankWithOutcomes(ranked, opts.outcomes, { sector, platform, businessId: opts.businessId, kind: "hook" }).map((r) => ranked.find((h) => h.id === r.id)!) : ranked;
  const out: HookSuggestion[] = [];
  for (const h of order) {
    if (out.length >= count) break;
    if ((sector === "clinic" || sector === "school") && h.type === "price-first") continue;
    const t = LINES[h.id];
    if (!t) continue;
    const options = [(lang === "rw" ? t.rw : lang === "fr" ? t.fr : t.en) ?? t.any ?? []].flat();
    const line = options
      .map((o) => fill(o, f))
      .find((l): l is string => !!l && wordCount(l) <= MAX_HOOK_WORDS && !checkLanguage([{ where: "hook", text: l, kind: "screen" }], brief.business.language).length && !out.some((x) => x.line === l));
    if (!line) continue;
    // A post keeps the price and the number in the caption, never in the opening line.
    if (post && ((f.price && line.includes(f.price)) || (f.phone && line.includes(f.phone)))) continue;
    out.push({ hookId: h.id, name: hookById(h.id)!.name, line, ...whyOf(h, sector) });
  }
  return out;
}
