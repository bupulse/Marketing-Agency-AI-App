// Types of the creative brain (docs/research/BRAIN.md): the database of how winning marketing videos are made
// (brain/data/*.json, built from docs/research/reels/*.jsonl) and what the engine picks from it for one brief.
// Data only; the loader (index.ts) checks the JSON against these shapes and every cross-reference.

export const PLATFORMS = ["tiktok", "facebook", "instagram", "shorts"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const ENGINES = ["claude", "seedance"] as const;
export type Engine = (typeof ENGINES)[number];
/** Which engine a rule binds: Claude's motion designer, the Seedance prompt writer, or both. */
export type RuleEngine = Engine | "both";

/** Business sectors. "shop" is the general fallback (cosmetics, gadgets, kitchenware, jewellery, wholesale). */
export const SECTORS = ["restaurant", "phone-shop", "salon", "fashion", "real-estate", "school", "car-rental", "clinic", "events", "services", "shop"] as const;
export type SectorId = (typeof SECTORS)[number];

export const FORMATS = ["product-reveal", "ugc-testimonial", "before-after", "unboxing", "tour", "offer", "3d-motion", "kinetic-typography", "tutorial", "list"] as const;
export type FormatId = (typeof FORMATS)[number];

export const HOOK_TYPES = ["question", "price-first", "offer-badge", "bold-claim", "pov", "problem", "reveal", "before-after", "social-proof", "demo", "announcement", "location", "authority", "greeting", "list", "curiosity", "series", "contact-first"] as const;
export type HookType = (typeof HOOK_TYPES)[number];

/** Facts a hook cannot be made without. A hook whose needs the brief lacks is never offered. */
export const HOOK_NEEDS = ["price", "phone", "offer", "old-price", "location", "result", "claim", "person", "series"] as const;
export type HookNeed = (typeof HOOK_NEEDS)[number];

export const RESEARCH_SOURCES = ["tiktok", "facebook", "instagram", "youtube", "captions"] as const;
export type ResearchSource = (typeof RESEARCH_SOURCES)[number];

/**
 * One research row, as an index entry (data/evidence.json, written by ingest.ts). The id is stable; `line` and `key`
 * point back at the researcher's row in docs/research/reels/<source>.jsonl.
 */
export type Evidence = {
  id: string;
  source: ResearchSource;
  line: number;
  /** url | author | the first 40 characters of the hook (or caption): finds the row again if lines move. */
  key: string;
  who: string;
  url: string | null;
  /** ISO country code where known (RW, KE, UG, TZ, NG...), else null. */
  country: string | null;
  category: string | null;
  language: string | null;
  /** Watched first-hand by a researcher (true) or only read about (false). */
  watched: boolean;
  /** From an article or case study, not the platform itself. */
  secondary: boolean;
  /** Posted (TikTok, from the video id) or started running (Facebook Ad Library), ISO date; null when unknown. */
  date: string | null;
  likes: number | null;
  runningDays: number | null;
  /** Facebook: ads the advertiser has live at once (rows sharing its name, or the researchers' count); null elsewhere. */
  variantsLive: number | null;
  /** 0 to 1: how strongly the row shows "this works" (likes on TikTok; days running or variants live on Facebook). */
  strength: number;
};

export type Hook = {
  id: string;
  name: string;
  type: HookType;
  /** The line or frame, with placeholders: {product} {price} {old_price} {offer} {city} {area} {business} {phone} {day} {problem} {result} {count} {claim}. */
  pattern: string;
  /** What is on screen in the first 2 seconds. */
  visual: string;
  platforms: Platform[];
  sectors: (SectorId | "any")[];
  formats: FormatId[];
  engines: Engine[];
  needs: HookNeed[];
  /** Lines seen in the research, verbatim. */
  examples: string[];
  evidence: string[];
  note?: string;
};

export type BeatRole = "hook" | "body" | "proof" | "offer" | "cta";
/** One beat of a format's timeline at its reference length; select.ts scales it to the brief's length. */
export type Beat = { from: number; to: number; role: BeatRole; beat: string; onScreen: string };
export type SecondsRange = [number, number];

export type Format = {
  id: FormatId;
  name: string;
  what: string;
  engines: Engine[];
  /** Claude engine templates (lib/video-engine/templates.ts) that make this format. */
  claudeTemplates: string[];
  /** The Seedance format (seedance-brain.ts SEEDANCE_FORMATS) closest to it, or null. */
  seedanceFormat: string | null;
  refSeconds: number;
  timeline: Beat[];
  length: Record<Platform, SecondsRange>;
  cutsPer10s: SecondsRange;
  text: string[];
  voice: string;
  music: string;
  cta: string;
  eastAfrica: string[];
  hooks: string[];
  evidence: string[];
};

export type CaptionFormula = { id: string; name: string; pattern: string; examples: string[]; sectors: (SectorId | "any")[]; evidence: string[] };
export type PlatformCaptions = {
  platform: Platform;
  /** "researched" when the platform's own research is in; "interim" while it borrows from the others. */
  status: "researched" | "interim";
  length: string;
  mustInclude: string[];
  formulas: CaptionFormula[];
  hashtags: { count: SecondsRange; practice: string[]; local: string[]; examples: string[] };
  language: string;
  /** Counted findings from the research (how many ads use each route, caption languages, lengths). */
  findings?: string[];
  evidence: string[];
};
export type CaptionsData = { platforms: PlatformCaptions[]; tradeRoutes: { id: string; words: string; when: string }[] };

export const RULE_STAGES = ["hook", "structure", "text", "cta", "offer", "voice", "sound", "caption", "claims", "people", "language", "series", "visual"] as const;
export type RuleStage = (typeof RULE_STAGES)[number];

export type Rule = {
  id: string;
  kind: "do" | "dont";
  stage: RuleStage;
  rule: string;
  /** A shorter wording for brainContext (the full rule is the reference). */
  short?: string;
  why: string;
  engine: RuleEngine;
  /** 1 must, 2 should, 3 nice to have. */
  priority: 1 | 2 | 3;
  /** Where the rule came from: tiktok-A (watched), tiktok-B (articles), tiktok-3d, facebook, rwanda, instagram, youtube, captions (the caption corpus), engine (owner and policy). */
  origin: "tiktok-A" | "tiktok-B" | "tiktok-3d" | "facebook" | "rwanda" | "instagram" | "youtube" | "captions" | "engine";
  platforms?: Platform[];
  sectors?: SectorId[];
  formats?: FormatId[];
  /** Only applies when the brief has (true) or lacks (false) these facts. */
  when?: { hasPrice?: boolean; hasPhone?: boolean };
  evidence: string[];
};

export type Sector = {
  id: SectorId;
  name: string;
  /** Words in a business or product description that point at this sector. */
  words: string[];
  /** The Seedance business kind (seedance-brain.ts BUSINESS_KINDS) for this sector, or null. */
  seedanceKind: string | null;
  formats: FormatId[];
  hooks: string[];
  settings: string[];
  offers: string[];
  cta: string;
  longestRunning: string;
  /** What the research is thin on for this sector. */
  gaps?: string;
  evidence: string[];
};

export type BrainData = { evidence: Evidence[]; hooks: Hook[]; formats: Format[]; captions: CaptionsData; rules: Rule[]; sectors: Sector[] };

// ---- What select.ts works with

export type BrainBrief = {
  platform?: Platform | "any" | null;
  sector?: SectorId | null;
  format?: FormatId | null;
  engine: Engine;
  /** The business content language (as in DesignBrief.business.language). */
  language?: string | null;
  hasPrice: boolean;
  hasPhone: boolean;
  /** Other facts the brief carries, so hooks that need them can be offered. */
  hasOffer?: boolean;
  hasOldPrice?: boolean;
  hasLocation?: boolean;
  hasPresenter?: boolean;
  seconds: number;
};

export type ScoredHook = Hook & { score: number; why: string[] };
export type TimedBeat = { from: number; to: number; role: BeatRole; beat: string; onScreen: string };

export type BrainPick = {
  platform: Platform | "any";
  sector: SectorId;
  format: Format;
  engine: Engine;
  seconds: number;
  language: { screen: string; voice: string; note: string | null };
  hooks: ScoredHook[];
  timeline: TimedBeat[];
  /** The platform's length range for this format, and whether the brief's length is inside it. */
  length: { range: SecondsRange; ok: boolean };
  rules: Rule[];
  donts: Rule[];
  caption: { formula: CaptionFormula; mustInclude: string[]; hashtags: string };
  cta: string;
  sectorInfo: Sector;
};
