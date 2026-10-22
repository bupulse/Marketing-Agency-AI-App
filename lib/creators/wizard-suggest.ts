// The campaign the AI (or, without it, a template per kind) suggests from the owner's one line and Business info
// (docs/CREATOR_CAMPAIGN_WIZARD.md, "AI"), and how a suggestion fills each step. Pure: the AI call is in
// lib/creators/wizard-ai.ts; the wizard ("Suggest again") and the server (filling a new draft) share this.
//
// Owner decision (22 October 2026): the AI fills every later step; the owner edits. The AI is never needed: when it
// fails or is not set up, the template of the campaign's kind fills the same answers, so the wizard always works.

import { z } from "zod";
import type { Platform } from "./company-forms";
import { defaultForm, fieldSchema, PRESET_FIELDS, type ApplicationForm, type FormField, type FieldType, FIELD_TYPES, hasOptions, MAX_FIELDS } from "./form-fields";
import type { Milestone, PayRules } from "./pay";
import { minRate, suggestedRate, maxRate, RATE_VIEWS, type RateViews } from "./pay-floor";
import { FOLLOWER_STEPS, LANGUAGES, NICHES, type CreatorRequirements } from "./requirements";
import { PLACES } from "./places";
import { addDaysYmd } from "@/lib/demo/slots";
import { DO_SUGGESTIONS, DONT_SUGGESTIONS, type BriefEvery, type CampaignGoal, type CampaignKind, type PostFormat, type WizardStepId } from "./wizard";
import { BRIEF_EVERY_VALUES, FORMAT_VALUES, GOAL_VALUES, KIND_VALUES, mediaFromFormats, nameFromIdea, planTasks, type TaskMedia, type WizardAnswers } from "./wizard-steps";

export type CampaignSuggestion = {
  name: string;
  kind: CampaignKind;
  goal: CampaignGoal;
  niches: string[];
  places: string[];
  languages: string[];
  minFollowers: number;
  platforms: Platform[];
  formats: PostFormat[];
  mentions: string[];
  /** How long the campaign runs, 7 to 90 days. */
  days: number;
  briefEvery: BriefEvery;
  postsPerDay: number;
  mediaKind: TaskMedia;
  brief: string;
  tasks: { title: string; instructions: string }[];
  dos: string[];
  donts: string[];
  pay: { ratePerThousand: number; rateViews: RateViews; feePerPost: number | null; milestones: Milestone[]; viewTargetPerCreator: number | null; budget: number | null };
  /** Extra application form fields (2 or 3). */
  fields: FormField[];
  /** Where it came from: the AI, or the template of its kind. */
  source: "ai" | "template";
};

/** What the suggestions are made from: Business info and the owner's answers so far. */
export type SuggestContext = {
  businessName: string;
  industry: string | null;
  country: string | null;
  contentLanguage: string | null;
  instagramHandle: string | null;
  currency: string;
  /** The networks a campaign can run on now (TikTok only once its app is set up). */
  networks: Platform[];
  /** Names of the products the campaign promotes (or the business's first ones). */
  productNames: string[];
  creatorsPerCampaign: number;
  idea: string;
  name: string;
  kind: CampaignKind | null;
};

// ---- The AI's answer --------------------------------------------------------------------------------------------

/** What the AI is asked to return (a JSON Schema is made from it). Loose on purpose: sanitizeSuggestion keeps the good parts. */
export const aiSuggestionSchema = z.object({
  name: z.string().describe("Short campaign name creators see, 2 to 6 words"),
  kind: z.string().describe(`One of: ${KIND_VALUES.join(", ")}`),
  goal: z.string().describe(`One of: ${GOAL_VALUES.join(", ")}`),
  niches: z.array(z.string()).describe("1 to 3 creator topics from the list given"),
  places: z.array(z.string()).describe("0 to 3 places from the list given; empty for anywhere"),
  languages: z.array(z.string()).describe("1 or 2 languages from the list given"),
  minFollowers: z.number().describe("Least followers a creator needs, e.g. 1000"),
  platforms: z.array(z.string()).describe("Networks from the list given"),
  formats: z.array(z.string()).describe(`From: ${FORMAT_VALUES.join(", ")}`),
  hashtag: z.string().describe("One campaign hashtag starting with #, letters and numbers only"),
  days: z.number().describe("How many days the campaign runs, 14 to 90"),
  briefEvery: z.string().describe(`One of: ${BRIEF_EVERY_VALUES.join(", ")}`),
  postsPerDay: z.number().describe("Posts a creator hands in each day, usually 1"),
  mediaKind: z.string().describe("VIDEO, IMAGE or ANY"),
  brief: z.string().describe("The brief for creators: 3 to 6 short sentences, what to show and how"),
  tasks: z.array(z.object({ title: z.string().describe("Task title, under 8 words"), instructions: z.string().describe("What to post: 1 to 3 sentences") })).describe("One task per period of the brief (whole campaign, each week or each day), at most 8"),
  dos: z.array(z.string()).describe("3 to 5 short do's"),
  donts: z.array(z.string()).describe("3 to 5 short don'ts"),
  ratePerThousand: z.number().describe("Price creators get for every 1,000 views, in the currency given, at least the floor given"),
  feePerPost: z.number().describe("Fee per post handed in, 0 for none"),
  fields: z.array(z.object({ label: z.string(), type: z.string().describe(`One of: ${FIELD_TYPES.join(", ")}`), options: z.array(z.string()).describe("Answers to pick from, for choice types"), required: z.boolean() })).describe("2 or 3 extra questions for the application form"),
});
export type AiSuggestion = z.infer<typeof aiSuggestionSchema>;

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const cleanText = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v.trim().toUpperCase()) ? (v.trim().toUpperCase() as T) : null);
const sameCase = (list: readonly string[], v: unknown) => (typeof v === "string" ? (list.find((x) => x.toLowerCase() === v.trim().toLowerCase()) ?? null) : null);
const picks = (list: readonly string[], v: unknown, max: number) => [...new Set((Array.isArray(v) ? v : []).map((x) => sameCase(list, x)).filter((x): x is string => Boolean(x)))].slice(0, max);
const lines = (v: unknown, max: number) => [...new Set((Array.isArray(v) ? v : []).map((x) => clean(x, 160)).filter((x) => x.length >= 2))].slice(0, max);

/** A hashtag of letters and numbers ("#LeafJuice"), or null. */
export function hashtagOf(text: string): string | null {
  const body = text
    .replace(/^#/, "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("")
    .slice(0, 30);
  return body.length >= 2 ? `#${body}` : null;
}

/** The business's Instagram handle as a mention, or null. */
export function handleMention(handle: string | null | undefined): string | null {
  const h = (handle ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "");
  return /^[\w.]{1,60}$/.test(h) ? `@${h}` : null;
}

/** A field the AI wrote, as a real form field (a fresh id), or null when it is not usable. */
function fieldFrom(raw: unknown, i: number): FormField | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = oneOf(FIELD_TYPES, r.type) as FieldType | null;
  if (!type || type === "UPLOAD" || type === "LOCATION") return null;
  const options = hasOptions(type) ? lines(r.options, 12).map((o) => o.slice(0, 100)) : undefined;
  const field: FormField = { id: `ai_${i + 1}`, type, label: clean(r.label, 200), required: r.required === true, ...(options ? { options } : {}), ...(type === "SCALE" ? { min: 1, max: 5 } : {}) };
  return fieldSchema.safeParse(field).success ? field : null;
}

/** The AI's answer made safe: every value checked, anything missing or wrong taken from `fallback` (the template). */
export function sanitizeSuggestion(raw: unknown, ctx: SuggestContext, fallback: CampaignSuggestion): CampaignSuggestion {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Partial<Record<keyof AiSuggestion, unknown>>;
  const name = clean(r.name, 80);
  const brief = cleanText(r.brief, 4000);
  const platforms = [...new Set((Array.isArray(r.platforms) ? r.platforms : []).map((p) => (typeof p === "string" ? p.trim().toLowerCase() : "")))].filter((p): p is Platform => ctx.networks.includes(p as Platform));
  const formats = [...new Set((Array.isArray(r.formats) ? r.formats : []).map((f) => oneOf(FORMAT_VALUES, f)).filter((f): f is PostFormat => Boolean(f)))];
  const tasks = (Array.isArray(r.tasks) ? r.tasks : [])
    .map((t) => (t && typeof t === "object" ? { title: clean((t as Record<string, unknown>).title, 100), instructions: cleanText((t as Record<string, unknown>).instructions, 1500) } : null))
    .filter((t): t is { title: string; instructions: string } => Boolean(t && t.title.length >= 2 && t.instructions.length >= 5))
    .slice(0, 14);
  const days = typeof r.days === "number" && Number.isFinite(r.days) ? Math.round(Math.min(90, Math.max(7, r.days))) : fallback.days;
  const ppd = typeof r.postsPerDay === "number" && Number.isFinite(r.postsPerDay) ? Math.round(Math.min(3, Math.max(1, r.postsPerDay))) : fallback.postsPerDay;
  const minFollowers = typeof r.minFollowers === "number" && Number.isFinite(r.minFollowers) ? closestStep(r.minFollowers) : fallback.minFollowers;
  const hashtag = typeof r.hashtag === "string" ? hashtagOf(r.hashtag) : null;
  const mentions = [...new Set([handleMention(ctx.instagramHandle), hashtag].filter((m): m is string => Boolean(m)))];
  const fields = (Array.isArray(r.fields) ? r.fields : []).map(fieldFrom).filter((f): f is FormField => Boolean(f)).slice(0, 3);
  return {
    name: name.length >= 2 ? name : fallback.name,
    kind: (oneOf(KIND_VALUES, r.kind) as CampaignKind | null) ?? fallback.kind,
    goal: (oneOf(GOAL_VALUES, r.goal) as CampaignGoal | null) ?? fallback.goal,
    niches: picks(NICHES, r.niches, 3).length ? picks(NICHES, r.niches, 3) : fallback.niches,
    places: Array.isArray(r.places) ? picks(PLACES, r.places, 3) : fallback.places,
    languages: picks(LANGUAGES, r.languages, 2).length ? picks(LANGUAGES, r.languages, 2) : fallback.languages,
    minFollowers,
    platforms: platforms.length ? platforms : fallback.platforms,
    formats: formats.length ? formats : fallback.formats,
    mentions: mentions.length ? mentions : fallback.mentions,
    days,
    briefEvery: (oneOf(BRIEF_EVERY_VALUES, r.briefEvery) as BriefEvery | null) ?? fallback.briefEvery,
    postsPerDay: ppd,
    mediaKind: (oneOf(["VIDEO", "IMAGE", "ANY"] as const, r.mediaKind) as TaskMedia | null) ?? fallback.mediaKind,
    brief: brief.length >= 10 ? brief : fallback.brief,
    tasks: tasks.length ? tasks : fallback.tasks,
    dos: lines(r.dos, 6).length ? lines(r.dos, 6) : fallback.dos,
    donts: lines(r.donts, 6).length ? lines(r.donts, 6) : fallback.donts,
    pay: { ...fallback.pay, ratePerThousand: fairRate(r.ratePerThousand, ctx.currency), feePerPost: typeof r.feePerPost === "number" && r.feePerPost >= 1 ? Math.min(Math.round(r.feePerPost), 1_000_000) : null },
    fields: fields.length >= 2 ? fields : fallback.fields,
    source: "ai",
  };
}

/** A price for 1,000 views that is never below the floor (the suggestion is a round number above it) nor a typo. */
export function fairRate(value: unknown, currency: string): number {
  const floor = minRate(currency);
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  if (n < floor || n > maxRate(currency)) return suggestedRate(currency);
  return n;
}

const closestStep = (n: number) => FOLLOWER_STEPS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), FOLLOWER_STEPS[0] as number);

// ---- Templates (no AI) -----------------------------------------------------------------------------------------

const NICHE_OF: [RegExp, string][] = [
  [/food|restaurant|caf|juice|drink|bak|coffee|kitchen|catering/i, "Food and drinks"],
  [/fashion|cloth|shoe|boutique|tailor/i, "Fashion"],
  [/beauty|salon|hair|spa|cosmetic|barber|nail|skin/i, "Beauty"],
  [/tech|phone|electronic|software|app|computer/i, "Tech"],
  [/school|education|training|course|academy/i, "Education"],
  [/gym|fitness|sport|yoga/i, "Sports and fitness"],
  [/health|clinic|pharma/i, "Health"],
  [/travel|tour|hotel|lodge|safari|resort/i, "Travel"],
  [/farm|agri/i, "Farming"],
  [/car|motor|garage/i, "Cars"],
  [/bank|financ|insur|money/i, "Business and money"],
];

type Template = {
  goal: CampaignGoal;
  formats: PostFormat[];
  briefEvery: BriefEvery;
  brief: (p: string, b: string) => string;
  tasks: (p: string, b: string) => { title: string; instructions: string }[];
  dos: string[];
  donts: string[];
  presets: string[];
};

const TAG = "Tag our account and use the campaign hashtag.";

const TEMPLATES: Record<CampaignKind, Template> = {
  PRODUCT_REVIEW: {
    goal: "SALES",
    formats: ["REEL", "STORY"],
    briefEvery: "MONTH",
    brief: (p, b) => `Try ${p} from ${b} and tell your followers what you really think. Show it clearly, use it the way you normally would and say one thing you love about it. Keep it short, real and in your own words. End by saying where people can get it.`,
    tasks: (p) => [{ title: `Your honest review of ${p}`, instructions: `Film a 15 to 30 second video: show ${p} in the first 3 seconds, use it, and say what you like about it. ${TAG}` }],
    dos: ["Show the product in the first 3 seconds", "Say our name out loud", "Be yourself: your own words and style", "Tag our account"],
    donts: ["No false claims about the product", "No other brands in view", "Don't delete the post before the campaign ends"],
    presets: ["used_product", "camera"],
  },
  CHALLENGE: {
    goal: "VIEWS",
    formats: ["REEL"],
    briefEvery: "WEEK",
    brief: (p, b) => `Join the ${b} challenge: a short, fun video your followers want to copy. Show ${p} in it, keep the energy high and invite your friends to try it too. The more people copy it, the more you earn.`,
    tasks: (p) => [
      { title: "Start the challenge", instructions: `Film yourself doing the challenge with ${p} in view. Under 20 seconds. ${TAG}` },
      { title: "Challenge a friend", instructions: "Do the challenge again with a friend or family member, and tag who should go next." },
      { title: "Your best take", instructions: "Your most creative version of the challenge: a new place, a twist, a costume. Make people want to copy it." },
      { title: "The final round", instructions: "Show the best moments of your challenge week and tell people to join before it ends." },
    ],
    dos: ["Use the campaign hashtag", "Film vertically (9:16)", "Add captions to your video", "Show the product in the first 3 seconds"],
    donts: ["Keep it family friendly", "Don't buy views or followers", "No copyrighted music the platform doesn't allow"],
    presets: ["camera", "adult"],
  },
  UNBOXING: {
    goal: "SALES",
    formats: ["REEL", "STORY"],
    briefEvery: "MONTH",
    brief: (p, b) => `Open ${p} from ${b} on camera, as if it is the first time. Show the box, what's inside and your first reaction. Point out the details people would want to see before they buy.`,
    tasks: (p) => [{ title: `Unbox ${p}`, instructions: `Film yourself opening ${p}: the box, each thing inside and your honest first reaction. 20 to 45 seconds. ${TAG}` }],
    dos: ["Film in good light", "Show the product in the first 3 seconds", "Say our name out loud", "Tag our account"],
    donts: ["No other brands in view", "No false claims about the product", "Don't delete the post before the campaign ends"],
    presets: ["used_product", "camera"],
  },
  TUTORIAL: {
    goal: "SALES",
    formats: ["REEL", "CAROUSEL"],
    briefEvery: "MONTH",
    brief: (p, b) => `Show your followers how to use ${p} from ${b}, step by step. Keep each step short and easy to follow, and show the result at the end.`,
    tasks: (p) => [{ title: `How to use ${p}`, instructions: `Show 3 to 5 easy steps using ${p}, then the result. Add captions so people can follow without sound. ${TAG}` }],
    dos: ["Add captions to your video", "Film in good light", "Show the product in the first 3 seconds", "Film vertically (9:16)"],
    donts: ["No false claims about the product", "No other brands in view", "No bad language"],
    presets: ["camera", "languages"],
  },
  EVENT: {
    goal: "VISITS",
    formats: ["REEL", "STORY"],
    briefEvery: "WEEK",
    brief: (p, b) => `Get your followers to come to ${p} by ${b}. Tell them when and where it is, what they will enjoy there and why they should not miss it. On the day, show the best moments live.`,
    tasks: (p) => [
      { title: "Tell people it's coming", instructions: `Say what ${p} is, when and where, and why you are going. Ask your followers to come with you. ${TAG}` },
      { title: "The countdown", instructions: "Remind people how many days are left and show one thing they will love there." },
      { title: "On the day", instructions: "Film the best moments while you are there: the place, the people, the fun. Post a Story too." },
    ],
    dos: ["Use the campaign hashtag", "Tag our account", "Say our name out loud", "Film vertically (9:16)"],
    donts: ["Keep it family friendly", "No alcohol or smoking in the video", "Don't delete the post before the campaign ends"],
    presets: ["location", "available"],
  },
  LAUNCH: {
    goal: "VIEWS",
    formats: ["REEL", "STORY", "POST"],
    briefEvery: "WEEK",
    brief: (p, b) => `${b} has something new: ${p}. Be one of the first to show it. Show what is new about it, try it, and tell your followers why they should try it too.`,
    tasks: (p) => [
      { title: `First look at ${p}`, instructions: `Show ${p} for the first time: what it is and what makes it new. ${TAG}` },
      { title: "Try it", instructions: `Use ${p} in your day and show what you think of it.` },
      { title: "Why tell a friend", instructions: `Say the one reason your friends should try ${p}, and where to get it.` },
    ],
    dos: ["Show the product in the first 3 seconds", "Say our name out loud", "Use the campaign hashtag", "Tag our account"],
    donts: ["No false claims about the product", "No other brands in view", "Don't delete the post before the campaign ends"],
    presets: ["niches", "camera"],
  },
  TESTIMONIAL: {
    goal: "SALES",
    formats: ["REEL"],
    briefEvery: "MONTH",
    brief: (p, b) => `Tell your own story with ${b}: how you found ${p}, what it changed for you, and who you would recommend it to. Real stories work best, so speak from the heart.`,
    tasks: (p) => [{ title: "Your story with us", instructions: `In 30 to 60 seconds, tell how you use ${p} and what it changed for you. Look at the camera and speak naturally. ${TAG}` }],
    dos: ["Be yourself: your own words and style", "Say our name out loud", "Film in good light", "Tag our account"],
    donts: ["No false claims about the product", "No bad language", "Don't delete the post before the campaign ends"],
    presets: ["used_product", "why"],
  },
  OTHER: {
    goal: "VIEWS",
    formats: ["REEL", "STORY"],
    briefEvery: "MONTH",
    brief: (p, b) => `Show your followers ${p} from ${b} in your own style. Keep it short, fun and real, and tell them where to find us.`,
    tasks: (p) => [{ title: `Show ${p}`, instructions: `Post a short video about ${p} in your own style. Show it clearly and say our name. ${TAG}` }],
    dos: ["Show the product in the first 3 seconds", "Say our name out loud", "Be yourself: your own words and style", "Tag our account"],
    donts: ["No other brands in view", "Keep it family friendly", "Don't delete the post before the campaign ends"],
    presets: ["niches", "camera"],
  },
};

const presetField = (id: string) => PRESET_FIELDS.find((f) => f.id === id);

/** The template's answers for the campaign's kind (no AI): good enough to go live after a few edits. */
export function templateSuggestion(ctx: SuggestContext): CampaignSuggestion {
  const kind = ctx.kind ?? "OTHER";
  const t = TEMPLATES[kind];
  const product = ctx.productNames[0] || (kind === "EVENT" ? "our event" : "our products");
  const business = ctx.businessName || "us";
  const niche = NICHE_OF.find(([re]) => ctx.industry && re.test(ctx.industry))?.[1] ?? "Lifestyle";
  const rwanda = /rwanda|^rw$/i.test(ctx.country ?? "");
  const language = LANGUAGES.find((l) => l.toLowerCase() === (ctx.contentLanguage ?? "").toLowerCase());
  const languages = [...new Set([...(rwanda ? ["Kinyarwanda"] : []), language ?? "English"])].slice(0, 2);
  const mentions = [handleMention(ctx.instagramHandle), hashtagOf(ctx.name || ctx.businessName)].filter((m): m is string => Boolean(m));
  return {
    name: ctx.name || nameFromIdea(ctx.idea) || `${business} creators`.slice(0, 80),
    kind,
    goal: t.goal,
    niches: [niche],
    places: rwanda ? ["Kigali"] : [],
    languages,
    minFollowers: 1_000,
    platforms: ctx.networks.length ? ctx.networks.filter((n) => n !== "facebook" || ctx.networks.length === 1) : ["instagram"],
    formats: t.formats,
    mentions: [...new Set(mentions)],
    days: 30,
    briefEvery: t.briefEvery,
    postsPerDay: 1,
    mediaKind: mediaFromFormats(t.formats),
    brief: t.brief(product, business),
    tasks: t.tasks(product, business),
    dos: t.dos,
    donts: t.donts,
    pay: { ratePerThousand: suggestedRate(ctx.currency), rateViews: RATE_VIEWS[0], feePerPost: null, milestones: [], viewTargetPerCreator: null, budget: null },
    fields: t.presets.map(presetField).filter((f): f is FormField => Boolean(f)),
    source: "template",
  };
}

// ---- A suggestion as each step's answers ------------------------------------------------------------------------

/** The step's answers from a suggestion (what "Suggest again" puts on screen), on top of the answers so far. */
export function stepFromSuggestion(step: WizardStepId, s: CampaignSuggestion, a: WizardAnswers, opts: { creatorsPerCampaign: number; today: string }): Partial<WizardAnswers> {
  switch (step) {
    case "idea":
      return { name: s.name, kind: s.kind };
    case "goal":
      return { goal: s.goal };
    case "creators":
      return { requirements: suggestedRequirements(s, a.requirements, opts.creatorsPerCampaign) };
    case "where":
      return { platforms: s.platforms, formats: s.formats, mentions: s.mentions, platformMode: "ANY" };
    case "when": {
      const startsOn = a.startsOn >= opts.today ? a.startsOn : opts.today;
      return { startsOn, endsOn: addDaysYmd(startsOn, s.days - 1), briefEvery: s.briefEvery, postsPerDay: s.postsPerDay, mediaKind: s.mediaKind };
    }
    case "content":
      return {
        brief: s.brief,
        tasks: planTasks({ startsOn: a.startsOn, endsOn: a.endsOn, briefEvery: a.briefEvery ?? s.briefEvery, postsPerDay: a.postsPerDay, mediaKind: a.mediaKind, platforms: a.platforms.length ? a.platforms : s.platforms, platformMode: a.platformMode, texts: s.tasks }),
      };
    case "rules":
      return { dos: s.dos, donts: s.donts };
    case "pay":
      return { payRules: suggestedPay(s, a.currency), viewTargetPerCreator: s.pay.viewTargetPerCreator, budget: s.pay.budget };
    case "form":
      return { applicationForm: withFields(a.applicationForm, s.fields) };
    default:
      return {};
  }
}

export function suggestedRequirements(s: CampaignSuggestion, current: CreatorRequirements | null, creatorsPerCampaign: number): CreatorRequirements {
  return { niches: s.niches, locations: s.places, languages: s.languages, minFollowers: s.minFollowers || null, creatorsWanted: current?.creatorsWanted ?? Math.min(5, creatorsPerCampaign) };
}

/** The suggested pay in the campaign's currency (the AI priced it in that currency; the floor is checked again). */
export function suggestedPay(s: CampaignSuggestion, currency: string): PayRules {
  return { ratePerThousand: fairRate(s.pay.ratePerThousand, currency), rateViews: 1_000, feePerPost: s.pay.feePerPost, milestones: s.pay.milestones, capPerPost: null, capPerCreator: null };
}

/** The form with the suggested fields added after the owner's (none twice, by label or preset), within MAX_FIELDS. */
export function withFields(form: ApplicationForm | null, fields: FormField[]): ApplicationForm {
  const base = form ?? defaultForm();
  const have = new Set(base.fields.map((f) => f.label.toLowerCase()));
  const ids = new Set(base.fields.map((f) => f.id));
  const added = fields.filter((f) => !have.has(f.label.toLowerCase()) && !ids.has(f.id));
  return { ...base, fields: [...base.fields, ...added].slice(0, MAX_FIELDS) };
}

/** Suggested do's and don'ts the owner can tap: the AI's first, then the ready-made ones, without repeats. */
export function ruleChips(kind: "dos" | "donts", ai: string[]): string[] {
  const base = kind === "dos" ? DO_SUGGESTIONS : DONT_SUGGESTIONS;
  const seen = new Set<string>();
  return [...ai, ...base].filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).slice(0, 14);
}

/** The steps "Suggest again" works on. */
export const SUGGEST_STEPS: WizardStepId[] = ["idea", "goal", "creators", "where", "when", "content", "rules", "pay", "form"];
