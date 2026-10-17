// A week of videos for Autopilot (docs/research/BRAIN.md, "A week of videos"): distinct posts for one product or
// offer, each with its own hook and template, the same number and area in every post (the long-running Rwandan
// advertisers run 8 to 15 variants of one format sharing the address, the number and the button). Product sectors
// open with the price, clinics and schools with trust; a before/after or a list sits in the middle; a presenter-led
// post only when the business has a presenter. Pure and deterministic.
import { formatById, hookById, sectorById } from "./database";
import { brainFor } from "./select";
import { briefFacts, briefSector, suggestHooks, type SuggestBrief } from "./suggest";
import { VIDEO_TEMPLATES } from "../templates";
import { type FormatId, type Outcome, type Platform, type SectorId } from "./types";

export type SeriesPost = {
  /** 1 to count, in posting order. */
  day: number;
  /** ISO date and weekday when `startDay` is given; null otherwise. */
  date: string | null;
  weekday: string | null;
  platform: Platform;
  hookId: string;
  /** The opening line, ready to use (suggestHooks). */
  line: string;
  /** A Claude engine template (lib/video-engine/templates.ts). */
  templateId: string;
  formatId: FormatId;
  seconds: number;
  /** The caption formula for this platform and sector (brain/data/captions.json). */
  captionFormulaId: string;
  /** A mood of BuPulse's music library (lib/music/tracks.ts). */
  musicMood: string;
  voice: boolean;
  /** One line of direction for the designer. */
  note: string;
  why: string;
  evidence: string[];
};
export type SeriesOptions = {
  platform?: Platform | "any" | null;
  count?: number;
  outcomes?: Outcome[] | null;
  businessId?: string | null;
  /** ISO date of the first post (each post one day later). */
  startDay?: string | null;
  /** The business has a presenter (an AI influencer or a cartoon presenter): presenter-led templates are allowed. */
  presenter?: boolean;
};

/** Sectors that lead with trust rather than a price (trust-first rule). */
const TRUST_SECTORS: SectorId[] = ["clinic", "school"];
/** Templates built around a price; trust sectors do not use them. */
const PRICE_TEMPLATES = new Set(["kigali-price-first", "price-drop", "offer-flash"]);
/** Formats a sector never gets: no skin, body or medical before/after for a clinic (no-body-before-after). */
const NEVER_FORMATS: Partial<Record<SectorId, FormatId[]>> = { clinic: ["before-after"] };
/** The middle post's format: a list for trust sectors, a before/after where the work shows, a list otherwise. */
const MIDDLE: Partial<Record<SectorId, FormatId[]>> = { clinic: ["list"], school: ["list"], salon: ["before-after", "list"], services: ["before-after", "list"], "real-estate": ["before-after", "list"], fashion: ["before-after", "list"] };
/** The platform order when the brief says "any": one post per platform in turn. */
const ROTATION: Platform[] = ["tiktok", "instagram", "facebook", "shorts"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** A library mood by format when the sector has none from the research. */
const MOOD_BY_FORMAT: Partial<Record<FormatId, string>> = { "kinetic-typography": "energetic", "3d-motion": "energetic", tutorial: "calm", tour: "warm", offer: "upbeat", list: "upbeat" };

/**
 * A week (or `count` days) of distinct posts for one brief. No hook or template repeats; fewer posts come back when
 * the brief has fewer usable hooks than days (a hook needs its facts). Pure.
 */
export function planSeries(brief: SuggestBrief, opts: SeriesOptions = {}): SeriesPost[] {
  const count = opts.count ?? 7;
  const presenter = !!opts.presenter;
  const sector = briefSector(brief);
  const sectorInfo = sectorById(sector)!;
  const facts = briefFacts(brief);
  const pool = suggestHooks(brief, { platform: opts.platform ?? "any", count: 60, outcomes: opts.outcomes, businessId: opts.businessId, sector, presenter }).filter((s, i, all) => all.findIndex((x) => x.hookId === s.hookId) === i);
  const hookOf = (id: string) => hookById(id)!;

  // The order of hooks: the opener, then the rest by rank, with the middle post's hook moved to the middle.
  const trust = TRUST_SECTORS.includes(sector);
  const opener = pool.find((s) => (trust ? hookOf(s.hookId).type === "authority" : hookOf(s.hookId).type === "price-first")) ?? pool[0];
  const rest = pool.filter((s) => s !== opener);
  const order = opener ? [opener, ...rest] : rest;
  const middleAt = Math.floor(Math.min(count, order.length) / 2);
  const middleFormats = (MIDDLE[sector] ?? ["list"]).filter((f) => !NEVER_FORMATS[sector]?.includes(f));
  const middleIndex = order.findIndex((s, i) => i > 0 && middleFormats.some((f) => hookOf(s.hookId).formats.includes(f)));
  if (middleIndex > 0 && order.length > 2) {
    const [m] = order.splice(middleIndex, 1);
    order.splice(Math.min(middleAt, order.length), 0, m);
  }

  const usedTemplates = new Set<string>();
  const usedFormats = new Map<FormatId, number>();
  const templateFor = (format: FormatId) => {
    const f = formatById(format)!;
    return f.claudeTemplates.find((id) => !usedTemplates.has(id) && (presenter || !VIDEO_TEMPLATES.find((t) => t.id === id)?.presenter) && !(trust && PRICE_TEMPLATES.has(id)) && (id !== "price-drop" || !!facts.oldPrice));
  };
  const posts: SeriesPost[] = [];
  // The same number and place in every post: a landmark when the brief names one, else the area, else the city.
  const place = facts.landmark ? [facts.landmark, facts.area, facts.city].filter(Boolean).join(", ") : facts.area ? [facts.area, facts.city].filter((x, i, a) => x && a.indexOf(x) === i).join(", ") : facts.city;
  const shared = [facts.phone && `the number (${facts.phone})`, place && `the place (${place})`].filter(Boolean).join(" and ");
  for (const s of order) {
    if (posts.length >= count) break;
    const h = hookOf(s.hookId);
    const day = posts.length + 1;
    const isMiddle = posts.length === middleAt && middleIndex > 0;
    // The format: the middle post's list or before/after, else the hook's formats the sector uses first; never a
    // presenter-led UGC post without a presenter, and no offer video without an offer or a previous price. The format
    // used least so far comes first, so the week varies.
    const wanted = isMiddle ? middleFormats.filter((f) => h.formats.includes(f)) : [];
    const candidates = [...wanted, ...sectorInfo.formats.filter((f) => h.formats.includes(f)), ...h.formats].filter((f, i, all) => all.indexOf(f) === i && formatById(f)!.engines.includes("claude") && (presenter || f !== "ugc-testimonial") && !NEVER_FORMATS[sector]?.includes(f) && (f !== "offer" || !!facts.offer || !!facts.oldPrice));
    const uses = (f: FormatId) => (wanted.includes(f) ? -1 : (usedFormats.get(f) ?? 0));
    const format = [...candidates].sort((a, b) => uses(a) - uses(b)).find((f) => templateFor(f));
    if (!format) continue;
    const templateId = templateFor(format)!;
    usedTemplates.add(templateId);
    usedFormats.set(format, (usedFormats.get(format) ?? 0) + 1);
    const platform: Platform = opts.platform && opts.platform !== "any" ? opts.platform : ROTATION[(day - 1) % ROTATION.length];
    const f = formatById(format)!;
    const [lo, hi] = f.length[platform];
    const suggested = VIDEO_TEMPLATES.find((t) => t.id === templateId)?.seconds ?? f.refSeconds;
    const seconds = Math.max(6, Math.min(30, hi, Math.max(lo, suggested)));
    const pick = brainFor({ platform, sector, format, engine: "claude", language: brief.business.language, hasPrice: !!facts.price, hasPhone: !!facts.phone, hasOffer: !!facts.offer, hasLocation: !!facts.area, seconds });
    const moods = sectorInfo.music?.moods ?? [];
    const musicMood = moods.length ? moods[(day - 1) % moods.length] : (MOOD_BY_FORMAT[format] ?? "upbeat");
    const role = day === 1 ? (trust ? "Opens the week with trust" : facts.price ? "Opens the week with the price" : "Opens the week") : isMiddle ? `The week's ${format === "before-after" ? "before/after" : "list"}` : day === count ? "Closes the week" : `Day ${day}`;
    const note = `${role}, with "${h.name}" ("${s.line}").${shared ? ` Keep ${shared} on screen, as in every post this week.` : ""}`;
    let date: string | null = null;
    let weekday: string | null = null;
    if (opts.startDay && !Number.isNaN(Date.parse(opts.startDay))) {
      const d = new Date(`${opts.startDay.slice(0, 10)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + day - 1);
      date = d.toISOString().slice(0, 10);
      weekday = WEEKDAYS[d.getUTCDay()];
    }
    posts.push({ day, date, weekday, platform, hookId: s.hookId, line: s.line, templateId, formatId: format, seconds, captionFormulaId: pick.caption.formula.id, musicMood, voice: presenter && (format === "ugc-testimonial" || format === "tutorial"), note, why: s.why, evidence: s.evidence });
  }
  return posts;
}
