import type { AspectRatio } from "./layout";

export type BrandForPrompt = {
  name: string;
  industry?: string | null;
  description?: string | null;
  audience?: string | null;
  brandColors?: readonly string[] | null;
};

const SHAPE: Record<AspectRatio, string> = {
  "1:1": "square",
  "4:5": "portrait (4:5)",
  "9:16": "tall vertical story format (9:16)",
  "16:9": "wide landscape (16:9)",
};

/** Brand-aware prompt for the image model. It never asks for text in the picture unless the user did. */
export function buildImagePrompt(input: {
  business: BrandForPrompt;
  prompt: string;
  aspectRatio: AspectRatio;
  hasLogo?: boolean;
  hasPhoto?: boolean;
  language?: string | null;
}): string {
  const { business, prompt, aspectRatio, hasLogo, hasPhoto } = input;
  const colors = (business.brandColors ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3);
  const asksForText = /\b(text|words?|say(s|ing)?|headline|title|caption|slogan|quote|written|reads?)\b|["“”«»]/i.test(prompt);

  const lines = [
    `Create a ${SHAPE[aspectRatio]} social media image for a small business called "${business.name}".`,
    business.industry ? `Industry: ${business.industry}.` : null,
    business.description ? `What they offer: ${business.description.slice(0, 300)}.` : null,
    business.audience ? `Audience: ${business.audience.slice(0, 200)}.` : null,
    "",
    `The image: ${prompt.trim()}`,
    "",
    "Style: clean, modern, professional marketing photography or illustration, strong composition, good lighting, uncluttered, suitable for Instagram and Facebook.",
    colors.length ? `Use the brand colours ${colors.join(", ")} as accents in the scene, backgrounds or props.` : null,
    hasPhoto ? "Use the attached photo as the main subject and keep the product faithful to it." : null,
    hasLogo ? "The attached image is the business logo. Use it only as a style and colour reference; do not copy it into the picture." : null,
    asksForText
      ? "Only include the exact text the description asks for, spelled correctly and clearly legible."
      : "Do not put any text, letters, numbers, watermarks or logos in the image.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}
