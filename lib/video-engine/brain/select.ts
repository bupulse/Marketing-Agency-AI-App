// What the brain says for one brief (docs/research/BRAIN.md, "How the engine operates"): the hooks to offer, the
// timeline to follow, the rules and don'ts, and the caption formula, picked from brain/data. Pure and deterministic
// (no clock, no randomness): the same brief always gets the same answer. `brainContext` turns it into a compact
// plain-text block for Claude's briefs (designer.ts briefText, seedance-prompt.ts promptBriefText).
import type { DesignBrief } from "../designer";
import type { PromptBrief } from "../seedance-prompt";
import { seedanceTemplateById } from "../seedance-brain";
import { voiceLanguage } from "../voice-language";
import { BRAIN, evidenceById, formatById, formatForTemplate, hookById, sectorById } from "./index";
import { outcomesLine, rankWithOutcomes } from "./outcomes";
import { SECTORS, type BeatRole, type BrainBrief, type BrainPick, type Engine, type Evidence, type Format, type FormatId, type Hook, type Outcome, type Platform, type Rule, type ScoredHook, type SectorId, type SecondsRange, type TimedBeat } from "./types";

/** Length limits of the two engines (validate.ts scales Claude videos to 6-30 s; Seedance films 4-15 s). */
export const ENGINE_SECONDS: Record<Engine, SecondsRange> = { claude: [6, 30], seedance: [4, 15] };
/** The most hooks offered in one brief. */
export const HOOK_OPTIONS = 3;
/** brainContext stays under about 900 tokens (about 4 characters per token in English). */
export const CONTEXT_MAX_CHARS = 3600;

const EAST_AFRICA = new Set(["KE", "UG", "TZ"]);
const DAY = 86_400_000;
/** The research's own "now": the newest dated row, so recency never depends on the clock. */
const NEWEST = Math.max(...BRAIN.evidence.map((e) => (e.date ? Date.parse(e.date) : 0)));

// ---- Reading a brief

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SECTOR_RES = BRAIN.sectors.map((s) => ({ id: s.id, re: new RegExp(`\\b(${s.words.map(escape).join("|")})\\b`, "gi") }));

/** The sector a business or product text points at (most word hits; ties go to the more specific sector); "shop" when none. */
export function sectorFromText(text: string | null | undefined): SectorId {
  const t = text ?? "";
  let best: SectorId = "shop";
  let hits = 0;
  for (const { id, re } of SECTOR_RES) {
    const n = t.match(re)?.length ?? 0;
    // "shop" is the fallback: a specific sector wins a tie with it.
    if (n > hits || (n === hits && n > 0 && best === "shop" && id !== "shop")) {
      best = id;
      hits = n;
    }
  }
  return best;
}

const SEEDANCE_TO_FORMAT: Record<string, FormatId> = { "product-reveal": "product-reveal", "ugc-testimonial": "ugc-testimonial", "before-after": "before-after", unboxing: "unboxing", tour: "tour", offer: "offer" };
/** The brain format for a Claude template id, a Seedance template id or a Seedance format; null when none fits. */
export function formatFromTemplate(id: string | null | undefined): FormatId | null {
  if (!id) return null;
  return formatById(id)?.id ?? formatForTemplate(id) ?? SEEDANCE_TO_FORMAT[seedanceTemplateById(id)?.format ?? id] ?? null;
}

const OFFER_WORDS = /%|\boff\b|\bfree\b|\bpromo|\boffer|\bdiscount|\bdeal\b|\bbuy \w+,? get\b|\bbonus\b|\bgratuit|\bréduction|\bubuntu\b|\bporomosiyo/i;
const OLD_PRICE = /\bwas\b|\bnow\b|instead of|\bavant\b|\bau lieu de\b|\bbefore\b.*\d/i;
const LOCATION_WORDS = /\b(kigali|kicukiro|gasabo|nyarugenge|kimironko|remera|kacyiru|kiyovu|nyamirambo|gishushu|kibagabaga|kabeza|kanombe|gikondo|nyarutarama|kagugu|kinyinya|musanze|rubavu|huye|located|address|street|road|plaza|house|room \d+|KK \d+|KG \d+|KN \d+)\b/i;
const CLAIM_WORDS = /\b(best|cheapest|biggest|most affordable|number one|no\.? ?1|leading|top-rated|meilleur|moins cher)\b/i;
const SERIES_WORDS = /\bevery (week|day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\bweekly\b|\bepisode\b|\bseries\b|\bep\.? ?\d|\bpart \d/i;

/** Facts in free text (description, offer line, note) that hooks may need. */
function factsFrom(texts: (string | null | undefined)[], price: string | null | undefined) {
  const all = texts.filter(Boolean).join(" \n ");
  return {
    hasOffer: OFFER_WORDS.test(all) || OFFER_WORDS.test(price ?? ""),
    hasOldPrice: !!price && OLD_PRICE.test(price),
    hasLocation: LOCATION_WORDS.test(all),
    hasClaim: CLAIM_WORDS.test(all),
    hasSeries: SERIES_WORDS.test(all),
  };
}

type FullBrief = BrainBrief & { hasClaim?: boolean; hasSeries?: boolean };

/** The brain's platform for the designer's (designer.ts PLATFORMS calls Shorts "youtube"). */
const DESIGN_PLATFORMS: Record<string, Platform> = { tiktok: "tiktok", instagram: "instagram", facebook: "facebook", youtube: "shorts", shorts: "shorts" };

/** A BrainBrief from the Claude designer's brief (its platform unless one is passed). */
export function brainBriefFromDesign(b: DesignBrief, platform: Platform | "any" | null = null): FullBrief {
  const texts = [b.business.description, b.product.summary, b.product.description, ...(b.product.usps ?? []), ...(b.product.features ?? []), b.note];
  return {
    platform: platform ?? (b.platform ? (DESIGN_PLATFORMS[b.platform] ?? null) : null),
    sector: sectorFromText([b.business.name, b.business.description, b.product.name, b.product.summary].filter(Boolean).join(" ")),
    format: formatFromTemplate(b.styleId),
    engine: "claude",
    language: b.business.language ?? null,
    hasPrice: !!b.product.price?.trim(),
    hasPhone: !!b.business.phone?.trim(),
    hasPresenter: !!b.cartoonId || b.photos.some((p) => /presenter|influencer/i.test(p.note ?? "")),
    seconds: b.seconds,
    ...factsFrom([...texts, b.business.website], b.product.price),
  };
}

/**
 * A BrainBrief from the Seedance prompt writer's brief. PromptBrief has no phone or platform yet: pass them (the
 * platform as the brain's or designer.ts's key; BuPulse overlays the phone when the business has one).
 */
export function brainBriefFromPrompt(b: PromptBrief, opts: { platform?: string | null; hasPhone?: boolean } = {}): FullBrief {
  const texts = [b.business.description, b.product.summary, b.product.description, ...(b.product.usps ?? []), ...(b.product.features ?? []), b.note];
  const kindSector: Partial<Record<string, SectorId>> = { education: "school" };
  return {
    platform: opts.platform === "any" ? "any" : opts.platform ? (DESIGN_PLATFORMS[opts.platform] ?? null) : null,
    sector: (b.businessKind && (kindSector[b.businessKind] ?? sectorById(b.businessKind)?.id)) || sectorFromText([b.business.name, b.business.description, b.product.name, b.product.summary].filter(Boolean).join(" ")),
    format: (b.format ? SEEDANCE_TO_FORMAT[b.format] : null) ?? formatFromTemplate(b.templateId),
    engine: "seedance",
    language: b.business.language ?? null,
    hasPrice: !!b.product.price?.trim(),
    hasPhone: opts.hasPhone ?? false,
    hasPresenter: !!b.presenter,
    seconds: b.seconds,
    ...factsFrom(texts, b.product.price),
  };
}

// ---- Picking

/** The format for a brief: the one asked for (if the engine makes it), else the sector's best for that engine. */
function pickFormat(b: FullBrief, sector: SectorId): Format {
  const asked = formatById(b.format);
  if (asked && asked.engines.includes(b.engine)) return asked;
  const s = sectorById(sector)!;
  const id = s.formats.find((f) => formatById(f)?.engines.includes(b.engine)) ?? "product-reveal";
  return formatById(id)!;
}

function needsMet(h: Hook, b: FullBrief, format: FormatId, sector: SectorId): boolean {
  return h.needs.every((n) => {
    switch (n) {
      case "price": return b.hasPrice;
      case "phone": return b.hasPhone;
      case "offer": return !!b.hasOffer;
      case "old-price": return b.hasPrice && !!b.hasOldPrice;
      case "location": return !!b.hasLocation || sector === "real-estate";
      case "result": return format === "before-after" || sector === "salon" || sector === "services";
      case "claim": return !!b.hasClaim;
      case "person": return !!b.hasPresenter;
      case "series": return !!b.hasSeries;
    }
  });
}

const rows = (h: Hook): Evidence[] => h.evidence.map(evidenceById).filter((e): e is Evidence => !!e);

/**
 * The hook score (docs/research/BRAIN.md, "How hooks are ranked"):
 * - evidence: first-hand rows count 1, article rows 0.4, each times (0.5 + strength), up to 25 points;
 * - platform: 20 when seen there (Instagram and Shorts borrow TikTok's at 12 until their research is in; "any" 10);
 * - sector: 25 when made for it ("any" hooks 10), plus 20, 15, 10, 5 for the first four hooks the sector lists;
 * - format: 15 when made for it, plus 10, 8, 6... for the hooks the format lists;
 * - facts: 3 per common fact the hook needs (price, phone, offer), 12 per rare one (old price, location, claim,
 *   presenter, series);
 * - local: up to 10 for Rwandan rows (East African rows count half);
 * - recency: up to 10 for rows from the newest year of research.
 */
export function scoreHook(h: Hook, ctx: { platform: Platform | "any"; sector: SectorId; format: Format }): ScoredHook {
  const why: string[] = [];
  const ev = rows(h);
  const weight = ev.reduce((s, e) => s + (e.watched ? 1 : 0.4) * (0.5 + e.strength), 0);
  const evidence = Math.min(25, weight * 6.25);
  why.push(`${ev.length} research rows`);

  let platform = 0;
  if (ctx.platform === "any") platform = 10;
  else if (h.platforms.includes(ctx.platform)) platform = 20;
  else if ((ctx.platform === "instagram" || ctx.platform === "shorts") && h.platforms.includes("tiktok")) platform = 12;
  if (platform >= 12 && ctx.platform !== "any") why.push(`seen on ${h.platforms.includes(ctx.platform) ? ctx.platform : "TikTok"}`);

  const listed = sectorById(ctx.sector)!.hooks.indexOf(h.id);
  const sector = (h.sectors.includes(ctx.sector) ? 25 : h.sectors.includes("any") ? 10 : 0) + (listed >= 0 ? Math.max(0, 20 - 5 * listed) : 0);
  if (h.sectors.includes(ctx.sector) || listed >= 0) why.push(`works for ${ctx.sector}`);

  const ranked = ctx.format.hooks.indexOf(h.id);
  const format = (h.formats.includes(ctx.format.id) ? 15 : 0) + (ranked >= 0 ? Math.max(2, 10 - 2 * ranked) : 0);
  if (format) why.push(`fits ${ctx.format.id}`);

  const local = ev.length ? (10 * ev.reduce((s, e) => s + (e.country === "RW" ? 1 : EAST_AFRICA.has(e.country ?? "") ? 0.5 : 0), 0)) / ev.length : 0;
  if (ev.some((e) => e.country === "RW")) why.push("seen in Rwanda");

  const recency = ev.length ? (10 * ev.reduce((s, e) => s + (e.date ? (NEWEST - Date.parse(e.date) <= 365 * DAY ? 1 : 0.3) : 0.5), 0)) / ev.length : 0;

  // A hook made for facts the brief has fits better than a generic one; rare facts (an old price, a location, the
  // owner's claim, a presenter, a series) more so.
  const specific = h.needs.reduce((s, n) => s + (n === "price" || n === "phone" || n === "offer" ? 3 : 12), 0);
  if (specific >= 12) why.push("made for the facts in this brief");

  const score = Math.round((evidence + platform + sector + format + local + recency + specific) * 10) / 10;
  return { ...h, score, why };
}

/** The ranked hooks a brief can use (needs met, made by the engine), best first; ties by id. */
export function rankHooks(b: FullBrief, sector: SectorId, format: Format): ScoredHook[] {
  const platform = b.platform ?? "any";
  const usable = BRAIN.hooks.filter((h) => h.engines.includes(b.engine) && needsMet(h, b, format.id, sector));
  // Hooks made for another sector only come in when this sector has too few of its own.
  const fits = (h: Hook) => h.sectors.includes(sector) || h.sectors.includes("any") || sectorById(sector)!.hooks.includes(h.id);
  const pool = usable.filter(fits).length >= HOOK_OPTIONS ? usable.filter(fits) : usable;
  return pool.map((h) => scoreHook(h, { platform, sector, format })).sort((a, z) => z.score - a.score || a.id.localeCompare(z.id));
}

/** The research ranking moved by our own results, when there are any (rankWithOutcomes keeps its safeguards). */
function withOutcomes(hooks: ScoredHook[], opts: OutcomeOptions, sector: SectorId, platform: Platform | "any"): ScoredHook[] {
  if (!opts.outcomes?.length) return hooks;
  const ranked = rankWithOutcomes(hooks, opts.outcomes, { sector, platform, businessId: opts.businessId, kind: "hook" });
  return ranked.map((r) => {
    const h = hooks.find((x) => x.id === r.id)!;
    return r.results && r.results.weight ? { ...h, why: [...h.why, r.why] } : h;
  });
}

const round = (n: number) => Math.round(n * 2) / 2;

/**
 * A format's timeline at the brief's length. The hook and the call to action keep their reference length (at most a
 * fifth of the video each, at least 1.5 s); the beats between share the rest in proportion. Middle beats that would
 * be shorter than 1.5 s are dropped (body first, even a longer one, then proof; the offer stays). Boundaries are
 * rounded to 0.5 s.
 */
export function scaleTimeline(format: Format, seconds: number): TimedBeat[] {
  const total = Math.max(1, seconds);
  const beats = format.timeline.map((b) => ({ ...b, len: b.to - b.from }));
  const ends = (role: BeatRole) => role === "hook" || role === "cta";
  const edge = (len: number) => Math.min(len, Math.max(1.5, total / 5));
  const middle = () => beats.filter((b) => !ends(b.role));
  for (;;) {
    const fixed = beats.filter((b) => ends(b.role)).reduce((s, b) => s + edge(b.len), 0);
    const ref = middle().reduce((s, b) => s + b.len, 0);
    const room = Math.max(0, total - fixed);
    const short = ref ? middle().filter((b) => (b.len / ref) * room < 1.5) : [];
    if (!short.length || middle().length === 0) break;
    // A short proof or offer beat (the "before" of a before/after) is kept by dropping a body beat instead.
    const body = middle().filter((x) => x.role === "body").sort((a, z) => a.len - z.len)[0];
    const drop = short.some((x) => x.role !== "body") && body ? body : [...short].sort((a, z) => order(a.role) - order(z.role))[0];
    if (middle().length === 1 && drop.role === "offer") break;
    beats.splice(beats.indexOf(drop), 1);
  }
  const fixed = beats.filter((b) => ends(b.role)).reduce((s, b) => s + edge(b.len), 0);
  const ref = middle().reduce((s, b) => s + b.len, 0);
  const room = Math.max(0, total - fixed);
  let t = 0;
  const out: TimedBeat[] = [];
  beats.forEach((b, i) => {
    const len = ends(b.role) ? edge(b.len) : ref ? (b.len / ref) * room : 0;
    const from = out.length ? out[out.length - 1].to : 0;
    t += len;
    const to = i === beats.length - 1 ? total : Math.max(from + 0.5, Math.min(total - 0.5, round(t)));
    out.push({ from, to, role: b.role, beat: b.beat, onScreen: b.onScreen });
  });
  return out;
}
const order = (role: BeatRole) => ({ body: 0, proof: 1, offer: 2, hook: 3, cta: 3 })[role];

function ruleApplies(r: Rule, b: FullBrief, platform: Platform | "any", sector: SectorId, format: FormatId): boolean {
  if (r.engine !== "both" && r.engine !== b.engine) return false;
  if (r.platforms && platform !== "any" && !r.platforms.includes(platform)) return false;
  if (r.sectors && !r.sectors.includes(sector)) return false;
  if (r.formats && !r.formats.includes(format)) return false;
  if (r.when?.hasPrice !== undefined && r.when.hasPrice !== b.hasPrice) return false;
  if (r.when?.hasPhone !== undefined && r.when.hasPhone !== b.hasPhone) return false;
  return true;
}

/** BuPulse's own posted results to blend in (outcomes.ts), and whose brief this is (their own results weigh more). */
export type OutcomeOptions = { outcomes?: Outcome[] | null; businessId?: string | null };

/** Everything the brain says for one brief; with outcomes, the hooks are re-ranked by our own results too. Pure. */
export function brainFor(brief: BrainBrief, opts: OutcomeOptions = {}): BrainPick {
  const b = brief as FullBrief;
  const platform = b.platform ?? "any";
  const sector: SectorId = b.sector && (SECTORS as readonly string[]).includes(b.sector) ? b.sector : "shop";
  const sectorInfo = sectorById(sector)!;
  const format = pickFormat(b, sector);
  const [lo, hi] = ENGINE_SECONDS[b.engine];
  const seconds = Math.min(hi, Math.max(lo, Math.round(b.seconds || format.refSeconds)));

  const lengths = platform === "any" ? Object.values(format.length) : [format.length[platform]];
  const range: SecondsRange = [Math.min(...lengths.map((r) => r[0])), Math.max(...lengths.map((r) => r[1]))];

  const rules = BRAIN.rules.filter((r) => ruleApplies(r, b, platform, sector, format.id)).sort((a, z) => a.priority - z.priority);

  const captions = BRAIN.captions.platforms.find((p) => p.platform === (platform === "any" ? "tiktok" : platform))!;
  // The formula that names this sector earliest (its main sector first), else a general one.
  const rank = (f: { sectors: string[] }) => (f.sectors.includes(sector) ? f.sectors.indexOf(sector) : f.sectors.includes("any") ? 50 : 99);
  const formula = [...captions.formulas].sort((a, z) => rank(a) - rank(z))[0];
  const v = voiceLanguage(b.language);
  const reliable = v.spokenLanguage === v.captionLanguage && ["English", "French"].includes(v.spokenLanguage);
  const route = b.hasPhone ? "WhatsApp {phone}" : b.hasLocation ? "Find us at {area}" : "DM to order";

  return {
    platform,
    sector,
    format,
    engine: b.engine,
    seconds,
    language: {
      screen: v.captionLanguage,
      voice: b.engine === "seedance" ? (reliable ? v.spokenLanguage : "none (music and ambient sound only)") : v.spokenLanguage,
      note: v.note,
    },
    hooks: withOutcomes(rankHooks(b, sector, format), opts, sector, platform).slice(0, HOOK_OPTIONS),
    timeline: scaleTimeline(format, seconds),
    length: { range, ok: seconds >= range[0] && seconds <= range[1] },
    rules: rules.filter((r) => r.kind === "do"),
    donts: rules.filter((r) => r.kind === "dont"),
    caption: { formula, mustInclude: captions.mustInclude, hashtags: `${captions.hashtags.count[0]} to ${captions.hashtags.count[1]}, local first: ${captions.hashtags.local.slice(0, 4).join(" ")}` },
    cta: b.hasPhone ? sectorInfo.cta : `${route} (the brief has no number), with the area and a landmark if it gives them.`,
    sectorInfo,
  };
}

// ---- The text for Claude

const PLATFORM_NAMES: Record<Platform | "any", string> = { tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram Reels", shorts: "YouTube Shorts", any: "TikTok, Reels and Facebook" };
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const WATCHED = BRAIN.evidence.filter((e) => e.watched).length;
/** Hook notes that limit the hook (only, never, not...) go into the brief; background notes stay in the database. */
const CONSTRAINT = /\b(only|never|no|not|skip|without)\b/i;

/**
 * Rules left out of brainContext (brainFor and the scorer still use them): either the engine's own system prompt
 * already gives them to Claude (designer.ts systemPrompt and its voice-language line; seedance-brain.ts SEEDANCE_RULES),
 * or they are the studio's or the owner's decision rather than the writer's (the length, versions, series, posting),
 * or, for Seedance, they are about the text BuPulse overlays afterwards.
 */
export const CONTEXT_SKIP: Record<Engine, string[]> = {
  claude: ["hook-3s", "no-invented-facts", "text-placement", "voice-language", "length", "variants", "series", "weekly-series", "one-clip-two-platforms", "no-borrowed-footage", "no-watermarks"],
  seedance: ["hook-3s", "demo-first", "no-invented-facts", "no-lookalikes", "no-body-before-after", "voice-language", "real-place", "plain-words", "native-look", "one-price-frame-0", "length", "variants", "series", "weekly-series", "one-clip-two-platforms"],
};

/**
 * The brain as a compact plain-text block for Claude's brief (at most about 900 tokens): the hook options, the
 * timeline, the on-screen rules, the call to action, the caption and the don'ts that the engine's own system prompt
 * does not already give. Deterministic. Lower-priority lines are dropped first when it runs long. `ownerHook`: the
 * owner already chose the opener (a styles.ts hook other than "auto"), so the hooks are wording and layout ideas only.
 * `outcomes` (and `businessId`): BuPulse's own posted results; they re-rank the hooks and add one "What has worked for
 * you" line when there are enough.
 */
export function brainContext(brief: BrainBrief | BrainPick, opts: { ownerHook?: boolean } & OutcomeOptions = {}): string {
  const p = "timeline" in brief ? brief : brainFor(brief, opts);
  // What our own posted videos say, when there are enough of them (outcomes.ts).
  const worked = opts.outcomes?.length ? outcomesLine(opts.outcomes, { sector: p.sector, platform: p.platform, businessId: opts.businessId }) : null;
  const seedance = p.engine === "seedance";
  const covered = new Set(CONTEXT_SKIP[p.engine]);
  const rules = p.rules.filter((r) => !covered.has(r.id));
  const head = `What works: ${p.sectorInfo.name.toLowerCase()}, ${p.format.name.toLowerCase()}, ${PLATFORM_NAMES[p.platform]}, ${p.seconds} s (from ${WATCHED} ads and reels BuPulse watched).`;
  const hooks = [
    opts.ownerHook
      ? "Hook ideas (the owner chose the opener above: use these for its wording and first frame only):"
      : "Hook options (pick one; fill {placeholders} only with facts from the brief, drop the rest):",
    ...p.hooks.map((h, i) => `${i + 1}. ${h.name}: "${h.pattern}". First 2 s: ${h.visual} Seen: ${h.examples.slice(0, 2).map((e) => `"${e}"`).join(", ")}.${h.note && CONSTRAINT.test(h.note) ? ` ${h.note}` : ""}`),
  ];
  const timeline = [
    `Timeline (${p.seconds} s, ${p.format.cutsPer10s[0]} to ${p.format.cutsPer10s[1]} changes per 10 s):`,
    ...p.timeline.map((t) => `- ${fmt(t.from)}-${fmt(t.to)} s ${t.role}: ${t.beat} ${seedance ? "BuPulse overlays" : "On screen"}: ${t.onScreen}.`),
  ];
  const lengthNote = p.length.ok ? "" : `Research length for this format: ${p.length.range[0]} to ${p.length.range[1]} s; keep the same beats at this length.`;
  const textRules = rules.filter((r) => r.stage === "text" || r.stage === "hook" || r.stage === "visual");
  const otherRules = rules.filter((r) => !textRules.includes(r) && r.stage !== "caption" && r.stage !== "cta" && r.id !== "language-mix");
  const line = (r: Rule) => `- ${r.short ?? r.rule}`;
  const doLines = (list: Rule[], max: number) => list.slice(0, max).map(line);
  const local = `East Africa: ${p.format.eastAfrica.slice(0, 2).join(" ")} Settings that fit: ${p.sectorInfo.settings.slice(0, 2).join("; ")}.`;
  const offers = `Offer wording seen (only if true for this business): ${p.sectorInfo.offers.slice(0, 3).join("; ")}.`;
  // The music and voice for this sector (TikTok sounds research): a library mood, never a track; the clip works muted.
  const sound = p.sectorInfo.music || p.sectorInfo.voice ? `Sound: ${p.sectorInfo.music ? `music mood ${p.sectorInfo.music.moods.join(" or ")} (${p.sectorInfo.music.note}) from BuPulse's library, never a trending track` : "any calm library mood"}${p.sectorInfo.voice ? `; voice: ${p.sectorInfo.voice.charAt(0).toLowerCase()}${p.sectorInfo.voice.slice(1).replace(/\.$/, "")}` : ""}. The clip must work muted.` : "";
  const cta = seedance ? `Call to action (BuPulse overlays it on the last shot; keep that shot clean): ${p.cta}` : `Call to action: ${p.cta}`;
  const example = p.caption.formula.examples[0];
  const caption = `Caption: ${p.caption.formula.pattern} (e.g. "${example.length > 100 ? `${example.slice(0, 97)}...` : example}"). Include: ${p.caption.mustInclude.join("; ")}. Hashtags ${p.caption.hashtags}.`;
  // For Kinyarwanda and Swahili content the language mix is part of the design, so it is never cut for length.
  const mixed = /kinyarwanda|swahili/i.test(p.language.screen) ? rules.find((r) => r.id === "language-mix") : undefined;
  const donts = ["Don't:", ...p.donts.filter((r) => !covered.has(r.id)).slice(0, 7).map(line)];

  // Sections in order of importance; when over budget the last optional ones go first.
  const parts: { lines: string[]; optional: number; trim?: boolean }[] = [
    { lines: [head], optional: 0 },
    { lines: worked ? [worked] : [], optional: 0 },
    { lines: hooks, optional: 0 },
    { lines: timeline, optional: 0 },
    { lines: lengthNote ? [lengthNote] : [], optional: 1 },
    { lines: [seedance ? "Shots and sound:" : "On-screen text and look:", ...doLines(textRules, 6)], optional: 0, trim: true },
    { lines: [cta], optional: 0 },
    { lines: sound ? [sound] : [], optional: 2 },
    { lines: mixed ? [line(mixed)] : [], optional: 0 },
    { lines: seedance ? [] : [caption], optional: 0 },
    { lines: donts, optional: 0, trim: true },
    { lines: ["Also:", ...doLines(otherRules, 5)], optional: 5, trim: true },
    { lines: seedance ? [] : [offers], optional: 4 },
    { lines: [local], optional: 3 },
  ];
  const render = () => parts.filter((x) => x.lines.length > (x.trim ? 1 : 0)).map((x) => x.lines.join("\n")).join("\n");
  let out = render();
  for (let level = 5; level >= 1 && out.length > CONTEXT_MAX_CHARS; level--) {
    for (const part of parts) if (part.optional === level) part.lines = [];
    out = render();
  }
  // Still long (very wordy hooks): shorten the rule lists, keeping their first two lines.
  for (const part of parts.filter((x) => x.trim)) {
    while (out.length > CONTEXT_MAX_CHARS && part.lines.length > 3) {
      part.lines.pop();
      out = render();
    }
  }
  return out.length > CONTEXT_MAX_CHARS ? `${out.slice(0, CONTEXT_MAX_CHARS - 1)}…` : out;
}

/** The hook ids the brain would offer, for the studio's hook picker (best first). */
export const suggestedHooks = (brief: BrainBrief): string[] => brainFor(brief).hooks.map((h) => h.id);
export { hookById };
