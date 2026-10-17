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

/** Research files: comments is TikTok's comments study, instagram-comments Instagram's (each indexed by clip summary). */
export const RESEARCH_SOURCES = ["tiktok", "facebook", "instagram", "youtube", "captions", "comments", "instagram-comments"] as const;
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
  /** The researcher's sector label for the row ("salons", "clinics/pharmacies"), when the row has one. */
  sector?: string | null;
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
  /** Plays as reported (Instagram account grids, Facebook page reels), when the row has them. */
  views?: number | null;
  /** The account's followers when the row was found from the account (Instagram round 2). */
  followers?: number | null;
  /** TikTok round 4: how the clip was made ("generated people", "generated scene", "motion graphics", "none" for a real-shop control, "unknown"). */
  ai?: string;
  /** TikTok's own AI label was shown on the clip. */
  aiLabel?: boolean;
  /** A business page's own post (organic reel), not an ad: evidence for page posts only (BrainBrief.purpose "post"). */
  organic?: true;
  /** An income-chain, recruiter or MoMo-screenshot post: cited only by the fake-income and income-promise don'ts. */
  scam?: true;
  /** 0 to 1: how strongly the row shows "this works" (likes on TikTok; days running or variants live on Facebook). */
  strength: number;
};

export type Hook = {
  id: string;
  name: string;
  type: HookType;
  /** Early evidence: fewer than 3 research rows (brain-evidence-audit.md); brainContext says so. */
  weak?: true;
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

export type CaptionFormula = {
  id: string;
  name: string;
  pattern: string;
  examples: string[];
  sectors: (SectorId | "any")[];
  evidence: string[];
  /** Ads only or posts only; ads when absent. */
  purposes?: Purpose[];
  /** Early evidence: fewer than 3 rows, or not yet observed on this platform. */
  weak?: true;
  /** BuPulse's own synthesis of several captions, not a caption seen as is (brain-evidence-audit.md). */
  model?: true;
  /** Where the examples come from when it is not obvious. */
  note?: string;
};
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
/** The first comment for the seller to pin (Instagram comments study): one line each for price, place, delivery, number. */
export type FirstCommentGuide = { why: string; en: string[]; rw: string[]; evidence: string[] };
export type CaptionsData = { platforms: PlatformCaptions[]; tradeRoutes: { id: string; words: string; when: string }[]; firstComment: FirstCommentGuide };

/**
 * What the video is for: an "ad" (the default: price, number and one way to order on screen) or a "post" on the
 * business's own page (organic: a place, a face or a moment; the offer and contact in the caption; Facebook round 6).
 */
export const PURPOSES = ["ad", "post"] as const;
export type Purpose = (typeof PURPOSES)[number];

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
  /** Where the rule came from: tiktok-A (watched), tiktok-B (articles), tiktok-3d, facebook, rwanda, instagram, youtube, captions (the caption corpus), comments (what viewers ask), engine (owner and policy). */
  origin: "tiktok-A" | "tiktok-B" | "tiktok-3d" | "facebook" | "rwanda" | "instagram" | "youtube" | "captions" | "comments" | "engine";
  platforms?: Platform[];
  sectors?: SectorId[];
  formats?: FormatId[];
  /** Only applies when the brief has (true) or lacks (false) these facts. */
  when?: { hasPrice?: boolean; hasPhone?: boolean };
  /** Only for ads, or only for page posts; both when absent. */
  purposes?: Purpose[];
  /** Early evidence: fewer than 3 research rows, or provisional rules from a thin round; brainContext says so and the scorer weighs it at half. */
  weak?: true;
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
  /** The music kind for this sector: BuPulse library moods (lib/music/tracks.ts MOODS), never a named track. */
  music?: { moods: string[]; note: string };
  /** When a voice-over helps in this sector. */
  voice?: string;
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
  /** An ad (the default) or a post on the business's own page. */
  purpose?: Purpose;
};

export type ScoredHook = Hook & { score: number; why: string[] };
export type TimedBeat = { from: number; to: number; role: BeatRole; beat: string; onScreen: string };

export type BrainPick = {
  platform: Platform | "any";
  purpose: Purpose;
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
  /** firstComment: the lines for the seller's pinned first comment (ads only; suggest.ts firstCommentFor fills them). */
  caption: { formula: CaptionFormula; mustInclude: string[]; hashtags: string; firstComment: string[] | null };
  cta: string;
  sectorInfo: Sector;
};

// ---- What BuPulse's own posted videos did (outcomes.ts)

/**
 * A post's numbers as the publisher reads them (Prisma PostMetrics: every field may be missing on some networks).
 * `messages` is the WhatsApp taps or DM conversations the post started, when the network reports them: Kigali viewers
 * message or call rather than like (likes are about 0.55% of plays), so a message counts most.
 */
export type OutcomeStats = { views: number | null; reach: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null; messages?: number | null };

/**
 * One video BuPulse made and a client posted, with what it did after 24 hours and after 7 days. The lab keeps these in
 * video-lab/data/outcomes.jsonl; the app will keep them in a database table with the same fields (docs/research/BRAIN.md,
 * "Learning from our own results").
 */
export type Outcome = {
  videoId: string;
  businessId: string;
  sector: SectorId;
  platform: Platform;
  templateId: string | null;
  hookId: string | null;
  formatId: FormatId | null;
  captionFormulaId: string | null;
  seconds: number;
  language: string | null;
  /** ISO date-time the post went out. */
  postedAt: string;
  stats24h: OutcomeStats | null;
  stats7d: OutcomeStats | null;
  source: "bupulse";
};
