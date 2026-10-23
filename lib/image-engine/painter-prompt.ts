// The Painter's prompt (docs/IMAGE_ENGINE.md): the finished advert, words included, in the layout the Director chose,
// with no template (owner decision, 23 October 2026). The Prompter's image prompt is the heart of it; this adds only
// what every picture needs: how to treat the product photo, the logo, the exact words, and the safety rules. Short on
// purpose, so the concept, not boilerplate, decides the picture. Pure, so it is tested.
import type { AspectRatio } from "@/lib/designs/layout";
import type { Treatment } from "./patterns";
import { realismBlock } from "./realism";

const SHAPE: Record<AspectRatio, string> = {
  "1:1": "square (1:1)",
  "4:5": "portrait (4:5)",
  "9:16": "tall vertical story (9:16)",
  "16:9": "wide landscape (16:9)",
};

const TREATMENT: Record<Treatment, string> = {
  exact: "The first attached photo is the real product: keep its exact shape, colours, materials and logo.",
  scale: "The first attached photo is the real product: show many of exactly this product working together, in a bigger professional setting.",
  line: "The first attached photo shows the product line: invent a new item of the same line, with the same materials, colours, logo and design language in a new shape or size, so it looks like a real product of this brand.",
};

export function painterPrompt(input: {
  businessName: string;
  aspectRatio: AspectRatio;
  concept: { prompt: string; headline: string; subline: string; cta: string };
  layout: string;
  /** The camera and medium the Director chose (realism.ts CAMERAS). */
  camera: string;
  treatment: Treatment;
  hasPhoto: boolean;
  hasLogo: boolean;
  /** Without a photo: what the product is, from Business info. */
  productText?: string | null;
  colors: string[];
}): string {
  const { concept } = input;
  const words = [
    `- Headline, large and bold: "${concept.headline}"`,
    concept.subline ? `- Small line under it: "${concept.subline}"` : null,
    concept.cta ? `- Button, a rounded pill: "${concept.cta}"` : null,
  ].filter(Boolean);
  return [
    `Make a finished ${SHAPE[input.aspectRatio]} social media advert for the business "${input.businessName}": a real photograph with clean, flat ad typography placed on it, like a print ad from a good local agency.`,
    concept.prompt,
    realismBlock(input.camera),
    input.hasPhoto ? TREATMENT[input.treatment] : input.productText ? `The product: ${input.productText.slice(0, 300)}.` : null,
    input.hasLogo ? `The ${input.hasPhoto ? "last" : ""} attached image is the business logo: show it once, small and clean, exactly as given.`.replace("  ", " ") : null,
    "Draw exactly these words, spelled exactly, as flat graphic type (no glow, no 3D, no shadows on the letters) in a clean modern sans-serif with strong contrast, easy to read on a phone:",
    ...(words as string[]),
    `Layout of the words: ${input.layout}.`,
    input.colors.length ? `Use the brand colours (${input.colors.slice(0, 3).join(", ")}) for the button and accents.` : null,
    "No other words, letters, numbers, prices, watermarks or extra logos anywhere in the picture.",
    "People are realistic adults with natural faces and hands; never a famous or real person, never children.",
  ]
    .filter(Boolean)
    .join("\n");
}
