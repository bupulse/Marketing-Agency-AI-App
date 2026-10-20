// Folds the viral library (docs/research/viral/<platform>.jsonl, 100 videos per platform, docs/research/viral/README.md)
// into the techniques index the viral recipe reads (lib/video-engine/brain/data/viral.json, docs/VIRAL_RECIPES.md).
// Run after new rows land (TikTok is still being collected):
//   node lib/video-engine/brain/viral-ingest.ts
// The index ships in the repo, and these are other people's videos, so it keeps only how each video was made: the
// opening, the beats, the pace, the camera, where the text, price and phone sat, why it worked. Never a caption, an
// account name, a frame or a comment: names, phone numbers and web addresses are taken out of every text kept, and the
// caption is kept only as its shape (how many lines, whether it had the price, the place...). Safe to re-run at any
// time: the rows are only read, a bad line is skipped with a warning, and the file is replaced in one step. Plain
// erasable TypeScript with no project imports, so Node runs it directly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VIRAL_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube"] as const;
export type ViralPlatform = (typeof VIRAL_PLATFORMS)[number];
/** What a video needs to be remade: photos are enough, filmed footage, a person on camera, or an AI clip may stand in. */
export type ViralNeed = "photos" | "filmed" | "person" | "ai-ok";
/** A beat's job in the video, from the researcher's label ("hook+offer", "demo", "tour", "close"...). */
export type ViralRole = "hook" | "show" | "proof" | "offer" | "cta";
export type ViralBeat = { from: number; to: number; role: ViralRole; beat: string; what: string };
/** The caption's shape only, never its words. */
export type CaptionShape = { lines: number; chars: number; hashtags: number; price: boolean; phone: boolean; place: boolean; delivery: boolean; dm: boolean; question: boolean; emoji: boolean };

/** One viral video as the index keeps it (data/viral.json). */
export type ViralVideo = {
  id: string;
  platform: ViralPlatform;
  country: string | null;
  /** A city (a place, never a business), when the researcher gave one. */
  city: string | null;
  region: "east-africa" | "global";
  /** The researcher's sector: one of the Brain's (brain/data/sectors.json) where it fits. */
  sector: string;
  kind: string;
  isAd: boolean;
  format: string;
  hookType: string;
  seconds: number | null;
  language: string | null;
  /** 0 to 1: how strongly the numbers say it went viral (views against followers, views, likes, days an ad ran). */
  strength: number;
  /** The proof in plain words: "1.2M views", "232x the account's followers", "an ad running 614 days". */
  reach: string;
  hook: string;
  first3s: string;
  beats: ViralBeat[];
  cutsPer10s: number | null;
  camera: string;
  look: string;
  textStyle: string;
  /** On-screen lines with the facts swapped for {price}, {phone}, {business}, {website}. */
  textPatterns: string[];
  priceShown: boolean;
  phoneShown: boolean;
  locationShown: boolean;
  cta: string;
  loop: boolean;
  voice: string;
  music: string;
  why: string;
  lesson: string;
  caption: CaptionShape;
  needs: ViralNeed[];
  /** A short code for the account (not its name), so one recipe never mixes two videos of the same account. */
  group: string;
};

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = str(v).replace(/,/g, "").match(/^([\d.]+)\s*([KkMm])?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1);
  return Number.isFinite(n) ? n : null;
};

const EAST_AFRICA = new Set(["RW", "KE", "UG", "TZ", "BI", "CD", "SS", "ET"]);

// ---- Taking other people's names, numbers and addresses out

/** Words a business name is made of that are ordinary words, places or trades: never taken out of a text. */
const COMMON = new Set(
  "the and for with from your our you shop store stores boutique beauty salon spa mobile mobiles phone phones electronics restaurant cafe kitchen food foods fashion fashions collection collections official rwanda kigali kenya nairobi uganda kampala tanzania dar burundi congo africa african east ltd limited company group home homes house houses properties property real estate cars car rental rentals hire tours tour travel travels clinic pharmacy dental hair nails studio studios media events event hotel hotels best new mart market world center centre hub plaza city town global international tech technology accessories wear designs design brand brands skin skincare care cosmetics perfume perfumes furniture decor interior interiors cleaning services service solutions garage motors auto bakery cakes cake coffee grill bar lounge kitchenware wholesale retail supermarket gadgets fitness gym school academy farm farms agro official shopping online deals deal supply supplies trading traders enterprises enterprise store247 tv daily life style styles stylist barber barbershop luxury premium and_co co inc llc".split(" "),
);
const PLACES = /^(kigali|rwanda|kenya|nairobi|uganda|kampala|tanzania|zanzibar|arusha|mombasa|burundi|bujumbura|goma|congo|kimironko|remera|kicukiro|gasabo|nyarugenge|musanze|rubavu|huye|nyamirambo|kacyiru|kiyovu|gikondo|kanombe|kabeza|kibagabaga|nyarutarama|africa|india|dubai|lagos|ghana|accra|london|usa)$/i;

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "SeraBeauty" -> ["Sera", "Beauty"]; "key_property.rw" -> ["key", "property", "rw"]. */
const wordsOf = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The texts a row is described with (not its caption or comments): where a word is used, to tell a business's own name
 * (used only in its own account's rows) from a product brand or an ordinary word (used across accounts).
 */
const describing = (r: Row) => [r.hook_text, r.first_3s, r.why_viral, r.lesson_for_engine, r.camera, r.visual_style, r.text_style, r.cta, r.voice, ...(Array.isArray(r.structure) ? r.structure.map((b) => (b as Row).what) : []), ...(Array.isArray(r.on_screen_text) ? r.on_screen_text : [])].map(str).join(" \n ");
const accountOf = (r: Row) => str(r.account).toLowerCase() || str(r.account_name).toLowerCase();

/**
 * The names to take out of every text: each account's handle and full name (also without its place), and the
 * distinctive words of its name ("Sera" of Sera Beauty) that no other account's rows use. Product brands (Tecno,
 * Samsung) stay: they name what was sold, not who sold it. Longest first, so a full name goes before its words.
 */
export function namesToScrub(rows: Row[]): string[] {
  const wordAccounts = new Map<string, Set<string>>();
  for (const r of rows) {
    const acc = accountOf(r);
    for (const w of new Set(wordsOf(describing(r)).map((x) => x.toLowerCase()))) {
      if (!wordAccounts.has(w)) wordAccounts.set(w, new Set());
      wordAccounts.get(w)!.add(acc);
    }
  }
  // Each account's own words: its handle and its name (not its hashtags: "#BodyLotion" names a product, not the shop).
  const own = new Map<string, { words: string[]; whole: string[] }>();
  for (const r of rows) {
    const acc = accountOf(r);
    const handle = str(r.account).replace(/^@/, "");
    const full = str(r.account_name).replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}☀-➿]/gu, "").trim();
    const mine = own.get(acc) ?? { words: [], whole: [] };
    mine.whole.push(handle, str(r.account), full);
    mine.words.push(...wordsOf(handle), ...wordsOf(full));
    own.set(acc, mine);
  }
  const ownLower = new Map([...own].map(([acc, m]) => [acc, new Set(m.words.map((w) => w.toLowerCase()))]));
  const names = new Set<string>();
  for (const [acc, mine] of own) {
    // The whole name, and the name without its place ("Derma Skin Clinic Rwanda" is also "Derma Skin Clinic").
    for (const n of mine.whole) {
      if (n.length >= 3) names.add(n);
      const parts = n.split(/[\s_.-]+/).filter(Boolean);
      while (parts.length > 1 && (PLACES.test(parts[parts.length - 1]) || /^(rw|ke|ug|tz|ltd|official)$/i.test(parts[parts.length - 1]))) parts.pop();
      const bare = parts.join(" ");
      if (bare.toLowerCase() !== n.toLowerCase() && bare.length >= 6 && !COMMON.has(bare.toLowerCase())) names.add(bare);
    }
    for (const w of mine.words) {
      const low = w.toLowerCase();
      if (low.length < 3 || COMMON.has(low) || PLACES.test(low) || /^\d+$/.test(low)) continue;
      // Used by an account whose own name does not have it: an ordinary word or a product brand ("Tecno", "Samsung"),
      // so it stays. Used only by accounts named with it (a clinic's Rwanda and Uganda pages): a business's name.
      const used = wordAccounts.get(low) ?? new Set<string>();
      if ([...used].some((a) => a !== acc && !ownLower.get(a)?.has(low))) continue;
      names.add(w);
    }
  }
  return [...names].sort((a, b) => b.length - a.length);
}

const PHONE = /\+?\(?\d[\d ()-]{7,}\d/g;
const WEB = /https?:\/\/\S+|www\.\S+|\b[\w-]+\.(?:com|rw|shop|store|co\.ke|co\.ug|co\.tz|ke|ug|tz|net|org|africa|biz|info)\b(?:\/\S*)?/gi;

/** A text with the names, phone numbers, web addresses and @mentions taken out. */
export function scrub(text: string, names: string[], mark: { business: string; phone: string; website: string } = { business: "the business", phone: "the number", website: "the website" }): string {
  let out = text.replace(/@(?:\[user\]|[\w.]*\w)/g, mark.business).replace(WEB, mark.website);
  out = out.replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 9 ? mark.phone : m));
  for (const n of names) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "giu"), mark.business);
  // People named on screen ("DR. BOSCO", "Chef Amina") keep only their title.
  const pattern = mark.business.startsWith("{");
  out = out.replace(/\b(Dr|DR|Mr|MR|Mrs|Ms|Chef|CHEF|Mama|Papa|Uncle|Aunty|Auntie|Coach|Pastor|Prof)\b\.?\s+\p{Lu}[\p{L}'-]+/gu, (_m, title: string) => (pattern ? `${title}. {name}` : `the ${title.toLowerCase() === "dr" ? "doctor" : title.toLowerCase()}`));
  // "A the business product" reads "the business product"; marks side by side ("{phone} / {phone}") become one.
  const m = escapeRe(mark.business);
  if (!pattern) out = out.replace(new RegExp(`\\b(?:a|an|the)\\s+${m}`, "gi"), mark.business);
  for (const mk of [mark.business, mark.phone, mark.website]) out = out.replace(new RegExp(`${escapeRe(mk)}(?:[\\s/,&+-]+${escapeRe(mk)})+`, "g"), mk);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Prices in an on-screen line ("20k", "16,499 +VAT", "KES 2,400", "150M rwf") become {price}. */
const PRICE = /(?:(?:rwf|frw|kes|ksh|ugx|tzs|tsh|usd|\$|€|£|₹|rs\.?)\s*)?\d{1,3}(?:[,.]\d{3})+(?:\s*(?:rwf|frw|kes|ksh|ugx|tzs|tsh|\/-))?|(?:(?:rwf|frw|kes|ksh|ugx|tzs|tsh|usd|\$|€|£|₹|rs\.?)\s*)\d+(?:[.,]\d+)?\s*[km]?\b|\b\d+(?:[.,]\d+)?\s*(?:[km]|rwf|frw|kes|ksh|ugx|tzs|tsh|\/-)(?![\p{L}])/giu;
export const textPattern = (line: string, names: string[]): string =>
  scrub(line, names, { business: "{business}", phone: "{phone}", website: "{website}" }).replace(PRICE, "{price}").replace(/\{price\}(\s*\{price\})+/g, "{price}");

// ---- Reading a row

const ROLE_WORDS: [ViralRole, RegExp][] = [
  ["cta", /cta|call|contact|close|end|outro|sign-?off|order|whatsapp|book|card|logo/i],
  ["offer", /offer|price|deal|promo|discount|sale/i],
  ["proof", /result|after|before|proof|review|testimonial|reaction|crowd|customer|transformation|reveal-?result/i],
  ["hook", /hook|intro|open|title/i],
];
export function beatRole(label: string, index: number, count: number): ViralRole {
  if (index === 0) return "hook";
  const found = ROLE_WORDS.find(([, re]) => re.test(label))?.[0];
  if (found === "hook") return "show";
  return found ?? (index === count - 1 && count > 2 ? "cta" : "show");
}

const PERSON = /talking (head|to (the )?camera)|to camera|selfie|presenter|owner (talks|speaks|talking|explains|holds|shows)|\b(woman|man|girl|guy|lady|creator|chef|stylist|barber|doctor|nurse|customer|influencer|host|she|he)\b (talks|speaks|explains|says|smiles|dances|walks|poses|tries|applies|shows)|\bmodel (wears|wearing|poses|walks)\b|face to camera|lip-?sync|dances?\b/i;
const GRAPHIC = /\b(none|graphic|graphics|poster|motion graphics|animation|animated|slideshow|slides|still|stills|photo|photos|render|renders|3d|cgi|kinetic|text only|carousel|template|screen ?record|flat lay)\b/i;
/** Formats about a real place, a real result or a real person: an AI clip would show something that is not true. */
const REAL_ONLY = new Set(["tour", "before-after", "ugc-testimonial"]);

/** What remaking the video takes: photos alone, filmed footage, a person on camera, and whether an AI clip may stand in. */
export function needsOf(r: Row): ViralNeed[] {
  const filmedText = [r.camera, r.first_3s, ...(Array.isArray(r.structure) ? r.structure.map((b) => (b as Row).what) : []), r.voice].map(str).join(" \n ");
  const person = PERSON.test(filmedText);
  const format = str(r.format);
  const photos = !person && (GRAPHIC.test(str(r.camera)) || GRAPHIC.test(str(r.visual_style)) || format === "kinetic-typography" || format === "3d-motion");
  const out: ViralNeed[] = [photos ? "photos" : "filmed"];
  if (person) out.push("person");
  if (!photos && !person && !REAL_ONLY.has(format)) out.push("ai-ok");
  return out;
}

const compact = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1_000 ? `${Math.round(n / 100) / 10}K` : String(Math.round(n)));

/** 0 to 1 and the proof in words, from the row's numbers (the README's "What counts as viral"). */
export function strengthOf(r: Row): { strength: number; reach: string } {
  const views = num(r.views);
  const likes = num(r.likes);
  const ratio = num(r.viral_ratio);
  const basis = str(r.viral_basis);
  const days = Number(basis.match(/running (\d+) days/i)?.[1] ?? 0) || null;
  const live = Number(basis.match(/(\d+) (?:live )?(?:ads|versions|variants)/i)?.[1] ?? 0) || null;
  const parts = [
    ratio ? Math.min(1, Math.log10(Math.max(1, ratio)) / 2.5) : 0,
    views ? Math.min(1, Math.max(0, (Math.log10(views) - 4) / 3)) : 0,
    likes ? Math.min(1, Math.max(0, (Math.log10(likes) - 2) / 4)) : 0,
    days ? Math.min(1, days / 365) : 0,
    live && live > 1 ? Math.min(1, (live - 1) / 9) : 0,
  ];
  const strength = Math.round(Math.max(0.2, ...parts) * 100) / 100;
  const reach = [views ? `${compact(views)} views` : "", ratio && ratio >= 10 ? `${Math.round(ratio)}x the account's followers` : "", days ? `an ad running ${days} days` : "", live && live > 1 ? `${live} versions live` : "", !views && likes ? `${compact(likes)} likes` : ""].filter(Boolean).join(", ") || "viral by the library's rules";
  return { strength, reach };
}

const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿]/u;
export function captionShape(caption: string, hashtags: unknown): CaptionShape {
  const text = caption ?? "";
  const lines = text.split("\n").filter((l) => l.trim()).length;
  const tags = Array.isArray(hashtags) ? hashtags.length : (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  return {
    lines,
    chars: text.length,
    hashtags: tags,
    price: new RegExp(PRICE.source, "iu").test(text) || /\bprice\b|igiciro|angahe/i.test(text),
    phone: [...text.matchAll(PHONE)].some((m) => m[0].replace(/\D/g, "").length >= 9) || /whats\s?app|call|📞|☎/i.test(text),
    place: /📍|\blocated|\blocation\b|next to|opposite|\bnear\b|kigali|nairobi|kampala|\bdar\b/i.test(text),
    delivery: /deliver|livraison|tubagezaho|tukugezaho/i.test(text),
    dm: /\bdm\b|inbox|message us|direct message/i.test(text),
    question: /\?/.test(text),
    emoji: EMOJI.test(text),
  };
}

const LOOP = /\bloop/i;
/** A short code for an account: the same account always gets the same code, and the name cannot be read back from it. */
export function groupOf(account: string): string {
  let h = 2166136261;
  for (const c of account.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}

/** One row as the index keeps it, or null for a scam or a row without an id. Pure. */
export function viralFromRow(r: Row, names: string[]): ViralVideo | null {
  const id = str(r.id);
  const platform = str(r.platform) as ViralPlatform;
  if (!/^vt-(tt|ig|fb|yt)-\d{3}$/.test(id) || !(VIRAL_PLATFORMS as readonly string[]).includes(platform) || r.scam === true) return null;
  const s = (v: unknown) => scrub(str(v), names);
  const country = /^[A-Z]{2}$/.test(str(r.country)) ? str(r.country) : null;
  const structure = (Array.isArray(r.structure) ? r.structure : []) as Row[];
  const beats: ViralBeat[] = structure
    .map((b, i) => ({ from: num(b.from) ?? 0, to: num(b.to) ?? 0, role: beatRole(str(b.beat), i, structure.length), beat: s(b.beat), what: s(b.what) }))
    .filter((b) => b.to > b.from);
  const { strength, reach } = strengthOf(r);
  const looped = [r.first_3s, r.why_viral, r.lesson_for_engine, r.notes, ...structure.map((b) => b.what)].some((t) => LOOP.test(str(t)));
  return {
    id,
    platform,
    country,
    city: str(r.city) || null,
    region: country && EAST_AFRICA.has(country) ? "east-africa" : "global",
    sector: str(r.sector) || "shop",
    kind: str(r.kind) || "business",
    isAd: r.is_ad === true,
    format: str(r.format) || "product-reveal",
    hookType: str(r.hook_type) || "curiosity",
    seconds: num(r.duration_s),
    language: str(r.language) || null,
    strength,
    reach,
    hook: textPattern(str(r.hook_text), names),
    first3s: s(r.first_3s),
    beats,
    cutsPer10s: num(r.cuts_per_10s),
    camera: s(r.camera),
    look: s(r.visual_style),
    textStyle: s(r.text_style),
    textPatterns: [...new Set((Array.isArray(r.on_screen_text) ? r.on_screen_text : []).map((t) => textPattern(str(t), names)).filter((t) => t && t.length <= 80))].slice(0, 6),
    priceShown: r.price_shown === true,
    phoneShown: r.phone_shown === true,
    locationShown: r.location_shown === true,
    cta: s(r.cta),
    loop: looped,
    voice: s(r.voice),
    music: s(r.music_mood),
    why: s(r.why_viral),
    lesson: s(r.lesson_for_engine),
    caption: captionShape(str(r.caption), r.hashtags),
    needs: needsOf(r),
    group: groupOf(accountOf(r) || id),
  };
}

/** Parses JSON Lines, skipping (and naming) lines that are not one JSON object: a collector may be mid-write. */
export function parseRows(text: string, file = "rows"): { rows: Row[]; bad: number[] } {
  const rows: Row[] = [];
  const bad: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const v = JSON.parse(line) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) rows.push(v as Row);
      else bad.push(i + 1);
    } catch {
      bad.push(i + 1);
    }
  });
  if (bad.length) console.warn(`${file}: skipped line${bad.length > 1 ? "s" : ""} ${bad.join(", ")} (not one JSON object).`);
  return { rows, bad };
}

/** The whole index from every platform's rows: one entry per id (the last row wins), sorted by id. Pure. */
export function buildIndex(rows: Row[]): ViralVideo[] {
  const names = namesToScrub(rows);
  const byId = new Map<string, ViralVideo>();
  for (const r of rows) {
    const v = viralFromRow(r, names);
    if (v) byId.set(v.id, v);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const rows: Row[] = [];
  for (const platform of VIRAL_PLATFORMS) {
    const file = path.join(root, `docs/research/viral/${platform}.jsonl`);
    if (!fs.existsSync(file)) {
      console.log(`${platform}: no file yet.`);
      continue;
    }
    const got = parseRows(fs.readFileSync(file, "utf8"), `${platform}.jsonl`).rows;
    console.log(`${platform}: ${got.length} rows`);
    rows.push(...got);
  }
  const index = buildIndex(rows);
  const out = path.join(root, "lib/video-engine/brain/data/viral.json");
  // In one step (a temp file renamed over it): the studio bundles the index and must never read half a file.
  fs.writeFileSync(`${out}.tmp`, `[\n${index.map((v) => JSON.stringify(v)).join(",\n")}\n]\n`);
  fs.renameSync(`${out}.tmp`, out);
  const ea = index.filter((v) => v.region === "east-africa").length;
  console.log(`Wrote ${index.length} viral videos (${ea} East African) to ${path.relative(root, out)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
