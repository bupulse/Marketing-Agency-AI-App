// The scene brief for "AI photo + brand layout" designs: Gemini paints only the photo, BuPulse
// lays the headline, price chip and logo over it. Pure, so it is unit tested.
import type { AspectRatio } from "./layout";
import type { TemplateId } from "./templates/registry";

// Templates that draw their text over the photo; the others show the photo as a panel.
const TEXT_OVER_PHOTO: TemplateId[] = ["new-arrival", "just-listed", "announcement"];

// buildImagePrompt drops its "no text in the picture" rule when the brief mentions text, so the
// scene must not use those words, whoever wrote it.
const TEXT_WORDS = /\b(text|words?|say(s|ing)?|headline|title|caption|slogan|quote|written|reads?)\b|["“”«»]/gi;

export function cleanScene(value: string): string {
  return value.replace(TEXT_WORDS, " ").replace(/\s+/g, " ").trim();
}

// Prices, offers and dates are not scenery: they would be painted into the picture as text.
const OFFER_WORDS = /\b(off|sale|discounts?|prices?|deals?|free|save|only|offers?|today|tonight|tomorrow|now|new|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekends?|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/gi;

/** Words from the headline that describe what is shown: no digits, currency, percentages, quoted text or offer words. */
export function sceneWords(headline: string): string {
  return headline
    .replace(/["“”«»][^"“”«»]*["“”«»]/g, " ")
    .replace(/\S*[\d%$€£¥]\S*/g, " ")
    .replace(OFFER_WORDS, " ")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSceneBrief(input: { template: TemplateId; aspectRatio: AspectRatio; scene?: string | null; headline: string }): string {
  // The business's industry and description are already in the prompt; the headline only adds the subject.
  const subject = cleanScene(input.scene?.trim() || sceneWords(input.headline)) || "the business at its best";
  const wide = input.aspectRatio === "16:9";
  const space = TEXT_OVER_PHOTO.includes(input.template)
    ? wide
      ? "Place the main subject on the right and keep the left half calm, soft and uncluttered, because a message will be laid over it later."
      : "Place the main subject in the upper half and keep the lower half calm, soft and uncluttered, because a message will be laid over it later."
    : "Make the main subject large and well lit; it will be shown as a framed photo.";
  return [
    `A realistic photograph for an advert: ${subject}.`,
    "Natural light, believable real-world setting, professional photography, shallow depth of field. One photograph only: no collage, no frame, no border, no graphic elements.",
    space,
  ].join(" ");
}
