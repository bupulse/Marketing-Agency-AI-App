import "server-only";
import { z } from "zod";
import { AIProviderError, type TextProvider } from "./types";

export const marketingContentSchema = z.object({
  caption: z.string().describe("Instagram caption, without hashtags"),
  hashtags: z.array(z.string()).describe("8 to 15 hashtags, each starting with #"),
  videoScript: z
    .string()
    .describe("30-second vertical video script with timestamps, scene directions and voiceover lines"),
  adHeadlines: z.array(z.string()).describe("2 or 3 short ad headlines"),
});

export type MarketingContent = z.infer<typeof marketingContentSchema>;

// Drop the "$schema" meta key; both Gemini and Claude only need the schema body.
const jsonSchema = z.toJSONSchema(marketingContentSchema) as Record<string, unknown>;
delete jsonSchema.$schema;

export interface BrandContext {
  businessName: string;
  industry?: string | null;
  description?: string | null;
  tone?: string | null;
}

export interface PromotionInput {
  type: string;
  title: string;
  price?: string | null;
  features: string[];
  extraDetails?: string | null;
}

const SYSTEM = `You are BuPulse, a marketing assistant for small businesses of every kind.
Write social media marketing content that sounds like the business itself, in its brand voice.
Be specific to what is being promoted, never invent facts (prices, dates, specs) that were not given,
and end the caption with a clear, friendly call to action. Return only the requested JSON.`;

export async function generateMarketingContent(
  provider: TextProvider,
  brand: BrandContext,
  input: PromotionInput,
) {
  const prompt = [
    `Business: ${brand.businessName}`,
    brand.industry && `Industry: ${brand.industry}`,
    brand.description && `About the business: ${brand.description}`,
    `Brand voice: ${brand.tone || "friendly and professional"}`,
    "",
    `Promoting (${input.type}): ${input.title}`,
    input.price && `Price or offer: ${input.price}`,
    input.features.length > 0 && `Key features:\n- ${input.features.join("\n- ")}`,
    input.extraDetails && `Other details: ${input.extraDetails}`,
    "",
    "Create: an Instagram caption with hashtags, a 30-second video script, and 2-3 ad headlines.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await provider.generate({ system: SYSTEM, prompt, jsonSchema });

  let parsed: MarketingContent;
  try {
    parsed = marketingContentSchema.parse(JSON.parse(result.text));
  } catch {
    throw new AIProviderError("The AI returned content in an unexpected format", result.provider, true);
  }

  return {
    content: {
      ...parsed,
      hashtags: parsed.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)),
      adHeadlines: parsed.adHeadlines.slice(0, 3),
    },
    provider: result.provider,
    model: result.model,
  };
}
