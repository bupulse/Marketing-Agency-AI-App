import "server-only";
import { z } from "zod";
import { getVoice } from "@/lib/brand/voices";
import { MAX_HEADLINE_LENGTH } from "@/lib/studio/schemas";
import { normalizeHashtags, truncateSmart } from "@/lib/studio/variants";
import { AIProviderError, type TextProvider, type TokenUsage } from "./types";

export const marketingContentSchema = z.object({
  caption: z.string().describe("Social media caption, without hashtags"),
  hashtags: z.array(z.string()).describe("8 to 15 hashtags, each starting with #"),
  videoScript: z
    .string()
    .describe("30-second vertical video script with timestamps, scene directions and voiceover lines"),
  adHeadlines: z.array(z.string()).describe(`2 or 3 ad headlines, each at most ${MAX_HEADLINE_LENGTH} characters`),
});

export type MarketingContent = z.infer<typeof marketingContentSchema>;

// Drop the "$schema" meta key; both Gemini and Claude only need the schema body.
const jsonSchema = z.toJSONSchema(marketingContentSchema) as Record<string, unknown>;
delete jsonSchema.$schema;

export interface BrandContext {
  businessName: string;
  industry?: string | null;
  /** What the business sells or does. */
  description?: string | null;
  audience?: string | null;
  /** Voice preset id (lib/brand/voices.ts). */
  tone?: string | null;
  website?: string | null;
  /** Language the content is written in, e.g. "French". Defaults to English. */
  contentLanguage?: string | null;
  /** Facts the AI may use for calls to action. */
  knowledge?: { hours?: string; area?: string; contact?: string } | null;
}

export interface PromotionInput {
  type: string;
  title: string;
  price?: string | null;
  features: string[];
  extraDetails?: string | null;
  /** Owner's note for a regeneration, e.g. "shorter" or "mention free delivery". */
  instruction?: string | null;
  /** The caption being replaced, so a regeneration is a fresh take. */
  previousCaption?: string | null;
}

const SYSTEM = `You are BuPulse, a marketing writer for businesses of every kind: shops, services, schools, events, offers, listings and projects.
Write social media content that sounds like the business itself, in its brand voice, for its customers.
Be specific to what is being promoted. Use only the facts you are given: never invent prices, numbers, dates, discounts, specifications, addresses, contact details or claims.
If a price or offer is given, you may state it exactly as written; if none is given, do not mention a price.
Return only the requested JSON.`;

export function buildPrompt(brand: BrandContext, input: PromotionInput): string {
  const language = brand.contentLanguage?.trim() || "English";
  const voice = getVoice(brand.tone);
  const k = brand.knowledge;

  return [
    `Write all content in ${language}. Hashtags may stay in English where that is normal for ${language}-speaking audiences; everything else must be in ${language}.`,
    "",
    `Business: ${brand.businessName}`,
    brand.industry && `Industry: ${brand.industry}`,
    brand.description && `What the business sells or does: ${brand.description}`,
    brand.audience && `Its customers: ${brand.audience}`,
    brand.website && `Website: ${brand.website}`,
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
    "",
    `Promoting (${input.type}): ${input.title}`,
    input.price && `Price or offer: ${input.price}`,
    input.features.length > 0 && `Key features:\n- ${input.features.join("\n- ")}`,
    input.extraDetails && `Other details: ${input.extraDetails}`,
    input.previousCaption &&
      `A previous version read:\n"""${input.previousCaption}"""\nWrite a clearly different take, not a light rewording.`,
    input.instruction && `The owner asks: ${input.instruction}\nFollow this request while keeping the rules above.`,
    "",
    "Create:",
    "1. caption: a social media caption without hashtags. Open with a hook, say what is on offer and why it matters, and end with a clear, friendly call to action.",
    "2. hashtags: 8 to 15 relevant hashtags, each starting with #.",
    "3. videoScript: a 30-second vertical video script. Use timestamps (for example 0-5s), a scene direction and a voiceover line for each part.",
    `4. adHeadlines: 2 or 3 ad headlines, each at most ${MAX_HEADLINE_LENGTH} characters.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateMarketingContent(
  provider: TextProvider,
  brand: BrandContext,
  input: PromotionInput,
): Promise<{ content: MarketingContent; provider: string; model: string; usage: TokenUsage }> {
  const result = await provider.generate({ system: SYSTEM, prompt: buildPrompt(brand, input), jsonSchema });

  let parsed: MarketingContent;
  try {
    parsed = marketingContentSchema.parse(JSON.parse(result.text));
  } catch {
    throw new AIProviderError(
      "The AI returned content in an unexpected format",
      result.provider,
      true,
      result.usage,
      result.model,
    );
  }

  return {
    content: {
      caption: parsed.caption.trim(),
      videoScript: parsed.videoScript.trim(),
      hashtags: normalizeHashtags(parsed.hashtags).slice(0, 15),
      adHeadlines: parsed.adHeadlines
        .map((h) => truncateSmart(h, MAX_HEADLINE_LENGTH))
        .filter(Boolean)
        .slice(0, 3),
    },
    provider: result.provider,
    model: result.model,
    usage: result.usage,
  };
}
