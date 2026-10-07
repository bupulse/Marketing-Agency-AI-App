import { getVoice } from "@/lib/brand/voices";
import { readKnowledge } from "@/lib/brand/schemas";
import type { AspectRatio } from "./layout";

export type BrandForPrompt = {
  name: string;
  industry?: string | null;
  description?: string | null;
  audience?: string | null;
  brandColors?: readonly string[] | null;
  country?: string | null;
  tone?: string | null;
  knowledge?: unknown;
};

// The user asked for no people (or only the product), so the scene stays empty of people.
const NO_PEOPLE = /\b(no|without|zero)\s+(people|persons?|humans?|models?|faces?)\b|\b(product|object)s?[- ]only\b|\bflat[- ]?lay\b/i;

/** Who appears in the picture: real-looking customers or staff of this business, like a real ad. */
function peopleLines(business: BrandForPrompt, hasPhoto?: boolean): string[] {
  const area = readKnowledge(business.knowledge).area;
  const place = [area, business.country].filter(Boolean).join(", ");
  return [
    "People: include one to three realistic people who are this business's typical customers or staff" +
      (business.audience ? ` (${business.audience.slice(0, 160)})` : "") +
      (place ? `, who look like local people in ${place.slice(0, 120)}` : "") +
      ", naturally using, wearing, tasting or enjoying what is on offer, so the picture sells it.",
    "Make the people look like a real advertising photo shoot: natural skin and expressions, correct hands and faces, authentic everyday setting, candid and warm rather than stiff stock poses.",
    hasPhoto ? "The product in the attached photo stays the clear focus; the people interact with it." : null,
  ].filter((l): l is string => l !== null);
}

/** A brand colour in words ("deep blue"): image models paint hex codes into the picture as text. */
export function colorName(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.15 || d < 0.08) return l > 0.85 ? "white" : l < 0.15 ? "black" : l > 0.6 ? "light grey" : "dark grey";
  const hue = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const names: [number, string][] = [[15, "red"], [40, "orange"], [65, "yellow"], [160, "green"], [190, "teal"], [255, "blue"], [290, "purple"], [345, "pink"], [360, "red"]];
  let name = names.find(([upTo]) => hue < upTo)![1];
  if (name === "orange" && l < 0.35) name = "brown";
  const shade = l < 0.3 ? "deep " : l > 0.75 ? "light " : "";
  return shade + name;
}

const SHAPE: Record<AspectRatio, string> = {
  "1:1": "square",
  "4:5": "portrait (4:5)",
  "9:16": "tall vertical story format (9:16)",
  "16:9": "wide landscape (16:9)",
};

/** Brand-aware prompt for the image model. It never asks for text in the picture unless the user did, and adds realistic people unless told not to. */
export function buildImagePrompt(input: {
  business: BrandForPrompt;
  prompt: string;
  aspectRatio: AspectRatio;
  hasLogo?: boolean;
  hasPhoto?: boolean;
  language?: string | null;
  /** Realistic people chosen from the business info (default on); skipped when the prompt asks for none. */
  includePeople?: boolean;
}): string {
  const { business, prompt, aspectRatio, hasLogo, hasPhoto, includePeople = true } = input;
  const voice = getVoice(business.tone);
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
    "Style: realistic, professional marketing photography, strong composition, good lighting, uncluttered, suitable for Instagram and Facebook.",
    voice ? `Mood: ${voice.label.toLowerCase()} (${voice.description.toLowerCase()})` : null,
    ...(includePeople && !NO_PEOPLE.test(prompt) ? peopleLines(business, hasPhoto) : []),
    colors.length ? `Use the brand colours (${[...new Set(colors.map(colorName))].join(", ")}) as accents in the scene, backgrounds, clothing or props.` : null,
    hasPhoto ? "Use the attached photo as the main subject and keep the product faithful to it." : null,
    hasLogo ? "The attached image is the business logo. Use it only as a style and colour reference; do not copy it into the picture." : null,
    asksForText
      ? "Only include the exact text the description asks for, spelled correctly and clearly legible."
      : "Do not put any text, letters, numbers, watermarks or logos in the image.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}
