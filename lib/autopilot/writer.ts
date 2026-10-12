// The writer: one Gemini call per post group, returning a version for each network plus the short
// text for the image. Facts rules follow lib/ai/marketing.ts: only the facts given, nothing invented.
import "server-only";
import { z } from "zod";
import type { BrandContext } from "@/lib/ai/marketing";
import { AIProviderError, type TextProvider, type TokenUsage } from "@/lib/ai/types";
import { getVoice } from "@/lib/brand/voices";
import { getProvider } from "@/lib/social/registry";
import type { Network } from "@/lib/social/types";
import { normalizeHashtags, truncateSmart } from "@/lib/studio/variants";
import type { Trend } from "./learning";
import type { AutopilotFormat, Idea } from "./playbook";

export interface WriterFacts {
  project?: { type: string; title: string; price?: string | null; features: string[]; notes?: string };
  faq?: { question: string; answer: string };
  holiday?: { name: string; date: string };
  /** "YYYY-MM-DD" the post goes out, for "time of year" ideas. */
  date: string;
  trends?: Trend[];
}

export interface WriterBrand extends BrandContext {
  /** Owner's name from sign-up, usable for team and story posts. */
  ownerName?: string | null;
  country?: string | null;
}

export interface WriteRequest {
  brand: WriterBrand;
  idea: Idea;
  facts: WriterFacts;
  /** One entry per network to write for, with the format that network gets. */
  targets: { network: Network; format: AutopilotFormat }[];
  /** For "regenerate": the text being replaced and the owner's wish. */
  previousText?: string | null;
  instruction?: string | null;
}

const imageSchema = z.object({
  kicker: z.string().describe("A 1 to 3 word label above the headline, in the content language. Empty if none."),
  headline: z.string().describe("The main text on the image, at most 45 characters"),
  subline: z.string().describe("One short supporting line for the image, at most 70 characters. Empty if none."),
  chip: z.string().describe("A price or badge for the image, exactly as given in the facts, at most 18 characters. Empty if none."),
});

const versionSchema = z.object({
  network: z.enum(["instagram", "facebook", "linkedin", "tiktok", "youtube"]),
  title: z.string().describe("Article title for ARTICLE posts; empty otherwise"),
  text: z.string().describe("The post text without hashtags (the script for SCRIPT posts)"),
  hashtags: z.array(z.string()).describe("Hashtags each starting with #; empty where the network version needs none"),
});

export const writerOutputSchema = z.object({
  image: imageSchema,
  versions: z.array(versionSchema),
});

export type WriterOutput = z.infer<typeof writerOutputSchema>;

const jsonSchema = z.toJSONSchema(writerOutputSchema) as Record<string, unknown>;
delete jsonSchema.$schema;

export const SYSTEM = `You are BuPulse Autopilot, the marketing writer for a small business. You plan a week of social media posts and write each one so that it sounds like the business itself, in its brand voice, for its customers.
Each network gets its own version, written for how people use that network. Never paste the same text everywhere.
Be specific to the business. Use only the facts you are given: never invent prices, numbers, dates, discounts, specifications, addresses, contact details, customer names, quotes, reviews, statistics or claims.
If a price or offer is given you may state it exactly as written; if none is given, do not mention a price.
Never write a quote or review as if a customer said it. Never claim the business is open, closed or running an offer unless the facts say so.
Hashtags must not contain years, dates or other numbers unless they appear in the facts.
Return only the requested JSON.`;

/** Hashtags kept per network. */
const HASHTAGS: Record<Network, number> = { instagram: 10, facebook: 3, linkedin: 3, tiktok: 5, youtube: 5 };

const NETWORK_BRIEF: Record<Network, (format: AutopilotFormat) => string> = {
  linkedin: (f) =>
    f === "ARTICLE"
      ? "LinkedIn article: a clear title in `title`, then the article in `text` (350 to 600 words, plain section headings on their own lines, no markdown symbols, no emojis). Professional, informed, useful. At most 3 hashtags."
      : "LinkedIn post: professional and personal, short paragraphs with blank lines, no emojis unless the brand voice clearly wants them, 600 to 1200 characters. Business-like, not salesy. At most 3 hashtags at the end.",
  instagram: (f) =>
    f === "SCRIPT"
      ? "Instagram Reel script in `text`: 30 to 45 seconds, timestamped scenes (for example 0-3s), a shot direction and a voiceover line for each. A hook in the first 3 seconds. 5 to 8 hashtags."
      : "Instagram caption: a hook in the first line, 2 to 4 short paragraphs, emojis in line with the brand voice, a clear call to action. 6 to 10 relevant hashtags.",
  facebook: () =>
    "Facebook post: conversational and friendly, as if talking to local customers, 300 to 700 characters, one clear call to action or a question to get comments. At most 3 hashtags.",
  tiktok: () =>
    "TikTok video script in `text`: 30 to 45 seconds, timestamped scenes (for example 0-3s), a shot direction and a voiceover or on-screen line for each. A strong hook in the first 3 seconds, casual and quick. Add the caption as the final line starting with 'Caption:'. 3 to 5 hashtags.",
  youtube: () =>
    "YouTube Shorts script in `text`: 30 to 45 seconds, timestamped scenes (for example 0-3s), a shot direction and a voiceover line for each, and a title as the first line starting with 'Title:'. 3 to 5 hashtags.",
};

export function buildPrompt(req: WriteRequest): string {
  const { brand, idea, facts, targets } = req;
  const language = brand.contentLanguage?.trim() || "English";
  const voice = getVoice(brand.tone);
  const k = brand.knowledge;
  const faq = facts.faq;
  const p = facts.project;

  return [
    `Write all content in ${language}. Hashtags may stay in English where that is normal for ${language}-speaking audiences; everything else must be in ${language}.`,
    "",
    `Business: ${brand.businessName}`,
    !brand.industryContext && brand.industry && `Industry: ${brand.industry}`,
    brand.description && `What the business sells or does: ${brand.description}`,
    brand.audience && `Its customers: ${brand.audience}`,
    brand.website && `Website: ${brand.website}`,
    brand.ownerName && `Owner: ${brand.ownerName}`,
    `Brand voice: ${voice ? `${voice.label}. ${voice.guide}` : "Friendly and professional."}`,
    (k?.hours || k?.area || k?.contact) &&
      [
        "Business facts you may use in the call to action (use only these):",
        k.hours && `- Opening hours: ${k.hours}`,
        k.area && `- Area served: ${k.area}`,
        k.contact && `- Contact: ${k.contact}`,
      ]
        .filter(Boolean)
        .join("\n"),
    brand.industryContext && `\n${brand.industryContext}`,
    "",
    `Post idea: ${idea.name} (goal: ${idea.goal})`,
    `How to write it: ${idea.guidance}`,
    `This post goes out on ${facts.date}.`,
    facts.holiday && `Occasion: ${facts.holiday.name} (${facts.holiday.date}).`,
    p &&
      [
        `About (${p.type}): ${p.title}`,
        p.price && `Price or offer: ${p.price}`,
        p.features.length > 0 && `Key features:\n- ${p.features.join("\n- ")}`,
        p.notes && `Other details: ${p.notes}`,
      ]
        .filter(Boolean)
        .join("\n"),
    faq && `Question customers ask: ${faq.question}\nThe business's own answer (use only this): ${faq.answer}`,
    facts.trends && facts.trends.length > 0 && `Currently popular topics and hashtags you may use if they genuinely fit:\n- ${facts.trends.map((t) => `${t.topic} ${t.hashtags.join(" ")}`).join("\n- ")}`,
    req.previousText && `A previous version read:\n"""${req.previousText}"""\nWrite a clearly different take, not a light rewording.`,
    req.instruction && `The owner asks: ${req.instruction}\nFollow this request while keeping the rules above.`,
    "",
    "Write one version for each of these networks (the `network` value must match exactly):",
    ...targets.map((t) => `- ${t.network}: ${NETWORK_BRIEF[t.network](t.format)}`),
    "",
    "Also write the text for the post's image in `image`: kicker (1 to 3 words, may be empty), headline (at most 45 characters, a hook or the key message), subline (at most 70 characters, may be empty) and chip (a price or badge exactly as in the facts, at most 18 characters, otherwise empty). The image text uses only facts you were given and must be in " + language + ".",
    idea.kicker && `Suggested kicker (translate it): ${idea.kicker}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface ImageText {
  kicker: string;
  headline: string;
  subline: string;
  chip: string;
}

export interface WrittenVersion {
  network: Network;
  title: string | null;
  text: string;
  hashtags: string[];
}

export interface WrittenGroup {
  image: ImageText;
  versions: WrittenVersion[];
  provider: string;
  model: string;
  usage: TokenUsage;
}

/** One number as written, with thousands separators removed, and the digit runs it was made of. */
export interface WrittenNumber {
  merged: string;
  parts: string[];
}

/** Numbers in a text: "5,000" and "420 000" are one number, "A55 128GB" is two. */
export function numberGroups(text: string): WrittenNumber[] {
  return (text.match(/\d+(?:[.,\s]\d{3})*(?:[.,]\d+)?|\d+/g) ?? []).map((raw) => ({
    merged: raw.replace(/[.,\s]/g, ""),
    parts: raw.match(/\d+/g) ?? [],
  }));
}

export function numbersIn(text: string): string[] {
  return numberGroups(text).map((n) => n.merged);
}

/** Every number the facts contain, merged and as separate digit runs. */
export function knownNumbers(text: string): Set<string> {
  return new Set(numberGroups(text).flatMap((n) => [n.merged, ...n.parts]));
}

/** Numbers in `text` that the facts do not contain. */
export function inventedNumbers(text: string, known: Set<string>): string[] {
  return numberGroups(text)
    .filter((n) => !(known.has(n.merged) || n.parts.every((p) => known.has(p))))
    .map((n) => n.merged);
}

/** The text of every fact given to the writer, for checking that nothing numeric was invented. */
export function factsText(req: WriteRequest): string {
  const { brand, facts } = req;
  return [
    brand.businessName,
    brand.industry,
    brand.industryContext,
    brand.description,
    brand.audience,
    brand.website,
    brand.knowledge?.hours,
    brand.knowledge?.area,
    brand.knowledge?.contact,
    facts.date,
    facts.holiday?.name,
    facts.holiday?.date,
    facts.project?.title,
    facts.project?.price,
    ...(facts.project?.features ?? []),
    facts.project?.notes,
    facts.faq?.question,
    facts.faq?.answer,
    ...(facts.trends ?? []).flatMap((t) => [t.topic, ...t.hashtags]),
  ]
    .filter(Boolean)
    .join(" ");
}

function cleanImageText(image: ImageText, known: Set<string>): ImageText {
  // A number on the image that is not in the facts is dropped with its field.
  const safe = (text: string, max: number) => {
    const t = text.trim().replace(/\s+/g, " ");
    if (!t) return "";
    if (inventedNumbers(t, known).length > 0) return "";
    return truncateSmart(t, max);
  };
  return {
    kicker: safe(image.kicker, 24),
    headline: safe(image.headline, 45),
    subline: safe(image.subline, 70),
    chip: safe(image.chip, 18),
  };
}

export async function writeGroup(provider: TextProvider, req: WriteRequest): Promise<WrittenGroup> {
  const result = await provider.generate({ system: SYSTEM, prompt: buildPrompt(req), jsonSchema });

  let parsed: WriterOutput;
  try {
    parsed = writerOutputSchema.parse(JSON.parse(result.text));
  } catch {
    throw new AIProviderError("The AI returned posts in an unexpected format", result.provider, true, result.usage, result.model);
  }

  const versions: WrittenVersion[] = [];
  for (const target of req.targets) {
    const v = parsed.versions.find((x) => x.network === target.network);
    const text = v?.text.trim();
    if (!v || !text) {
      throw new AIProviderError(`The AI left out the ${target.network} post`, result.provider, true, result.usage, result.model);
    }
    const rules = getProvider(target.network).rules;
    const hashtags = normalizeHashtags(v.hashtags).slice(0, Math.min(HASHTAGS[target.network], rules.maxHashtags ?? 99));
    // Hashtags are kept in their own list; a script may keep any it wrote inline.
    const body = target.format === "SCRIPT" ? text : text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1").replace(/[ \t]+\n/g, "\n").trim();
    const reserve = hashtags.join(" ").length + 2;
    versions.push({
      network: target.network,
      title: target.format === "ARTICLE" ? truncateSmart(v.title.trim() || req.idea.name, 120) : null,
      text: truncateSmart(body, Math.max(200, rules.maxText - reserve)),
      hashtags: target.format === "SCRIPT" ? hashtags.slice(0, 5) : hashtags,
    });
  }

  const known = knownNumbers(factsText(req));
  return {
    image: cleanImageText(parsed.image, known),
    versions,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
  };
}
