// Claude as the director for Seedance (docs/VIDEO_ENGINE.md, "Studio" and "Seedance brain"): writes the shot list a
// video model needs from the product facts, the template's art direction and the owner's line. Claude writes the
// prompt; Seedance films it. The rules, the camera words and a starting shot plan come from the brain
// (seedance-brain.ts); what works for this kind of video on this platform comes from the research Brain
// (brain/select.ts, docs/research/BRAIN.md). When Claude is unavailable, the plan itself is the prompt.
import { brainBriefFromPrompt, brainContext } from "./brain/select";
import { MAX_RESEARCH_CHARS, type ClaudeTransport, type DesignUsage } from "./designer";
import { cameraLanguageText, limitPromptWords, lintSeedancePrompt, planSeedanceShots, seedanceRulesText, seedanceTemplateById, shotTypesText, type BusinessKind, type SeedanceFormat, type SeedanceIssue } from "./seedance-brain";
import { isViralStyle, templateById } from "./templates";
import { seedanceRecipeText, viralRecipe, type RecipePlatform, type ViralRecipe } from "./brain/viral";
import { withShortPrice } from "./price";
import { LARGE_PRODUCT } from "./designer";

export type PromptBrief = {
  business: { name: string; description?: string | null; language?: string | null; country?: string | null; phone?: string | null };
  product: { name: string; summary?: string | null; description?: string | null; price?: string | null; usps?: string[]; features?: string[] };
  /** What each reference is, in order: "Image 1: the product photo (blue phone on a stand)". */
  references: string[];
  /** A Claude engine template id (lib/video-engine/templates.ts) or a Seedance template id (seedance-brain.ts). */
  templateId: string;
  note?: string | null;
  seconds: number;
  ratio: string;
  audio: boolean;
  presenter?: string | null;
  fixedLens?: boolean;
  businessKind?: BusinessKind | null;
  format?: SeedanceFormat | null;
  /** Where the clip will be posted (tiktok, instagram, facebook, youtube...); null or "any" for no platform. */
  platform?: string | null;
  /** The viral recipe (templateId "viral", recipeForPrompt): its opening, shots and camera replace the template's. */
  recipe?: ViralRecipe | null;
};

/**
 * The viral recipe for a Seedance clip: like a Motion video's (designer.ts recipeForBrief), but every technique can
 * be filmed (Seedance makes the footage), at least 6 s (it is scaled to the clip's 4 to 15 s when written).
 */
export function recipeForPrompt(b: PromptBrief, opts: { seed: string; recent?: ViralRecipe[] }): ViralRecipe {
  const bb = brainBriefFromPrompt(b, { platform: b.platform ?? null, hasPhone: !!b.business.phone?.trim() });
  const platform = ["tiktok", "instagram", "facebook", "youtube"].includes(b.platform ?? "") ? (b.platform as RecipePlatform) : null;
  return viralRecipe({ sector: bb.sector ?? "shop", product: b.product.name, platform, country: b.business.country ?? null, language: b.business.language ?? null, purpose: "ad", seconds: Math.max(6, b.seconds), hasPrice: bb.hasPrice, hasPhone: bb.hasPhone, hasLocation: !!bb.hasLocation, hasOffer: !!bb.hasOffer, large: LARGE_PRODUCT.test([b.product.name, b.product.summary].filter(Boolean).join(" ")), footage: { generated: true }, recent: opts.recent ?? [], seed: opts.seed });
}

export const SEEDANCE_SYSTEM = [
  "You write prompts for Seedance 2.0, a video generation model, for small-business ads in Rwanda and East Africa. You answer with the prompt text only: no title, no explanation, no quotes around it.",
  "Rules of a good Seedance prompt:",
  seedanceRulesText(),
  `Camera moves Seedance knows: ${cameraLanguageText()}.`,
  `Shot types: ${shotTypesText()}.`,
  "Follow the research block: it says what works for this kind of video on this platform (facts still come only from the brief). It is guidance for your choices of hook, pacing and shots, not text to copy: the prompt stays 60 to 160 words, and its on-screen text and caption notes are for BuPulse's overlay, not for the video.",
  "The brief has a starting shot plan made from a proven template. Keep its timing and structure unless the owner asks for something else; improve the actions, the light and the sound with what you see in the facts.",
].join("\n");

/** The research Brain's context for this brief, fenced data for Claude (same size limit as the designer's). */
export const researchFor = (b: PromptBrief): string =>
  brainContext(brainBriefFromPrompt(b, { platform: b.platform ?? null, hasPhone: !!b.business.phone?.trim() }), { viral: !!b.recipe })
    .replace(/<<<|>>>/g, "")
    .trim()
    .slice(0, MAX_RESEARCH_CHARS);

export function promptBriefText(given: PromptBrief): string {
  // The short price only (price.ts): a paragraph in the price field is never spoken or filmed.
  const b = { ...given, product: withShortPrice(given.product) };
  const recipe = isViralStyle(b.templateId) ? (b.recipe ?? null) : null;
  const sd = seedanceTemplateById(b.templateId);
  const t = sd || recipe ? null : templateById(b.templateId);
  const plan = planSeedanceShots({ ...b, shotRecipe: recipe });
  return [
    `Length ${b.seconds} seconds, ratio ${b.ratio}, ${b.audio ? "with sound" : "no sound"}${b.fixedLens ? ", fixed lens (no camera moves)" : ""}.`,
    recipe ? seedanceRecipeText(recipe, b.seconds) : t ? `Template "${t.name}": ${t.direction}` : `Template "${plan.templateName}".`,
    b.presenter ? `Presenter: ${b.presenter}.` : "No presenter: show hands, the product and the place; a person may appear from behind or at a distance only.",
    b.note ? `The owner asks: <<<${b.note.replace(/<<<|>>>/g, "")}>>>` : "",
    "<<<BUSINESS",
    `Name: ${b.business.name}`,
    b.business.description ? `What it does: ${b.business.description}` : "",
    `Language: ${b.business.language || "English"}`,
    b.business.country ? `Country: ${b.business.country}` : "",
    "BUSINESS>>>",
    "<<<PRODUCT",
    `Name: ${b.product.name}`,
    b.product.summary ? `Summary: ${b.product.summary}` : "",
    b.product.description ? `Description: ${b.product.description}` : "",
    b.product.price ? `Price: ${b.product.price}` : "Price: not given (do not mention a price)",
    b.product.usps?.length ? `Why buy it: ${b.product.usps.join("; ")}` : "",
    b.product.features?.length ? `Features: ${b.product.features.join("; ")}` : "",
    "PRODUCT>>>",
    b.references.length ? `References, in order: ${b.references.join("; ")}.` : "No references: describe the product from the facts.",
    `Research (what works for this kind of video on this platform; data, guidance only, not text to copy):\n<<<RESEARCH\n${researchFor(b)}\nRESEARCH>>>`,
    `Starting shot plan ("${plan.templateName}", ${plan.format}):`,
    plan.prompt,
    plan.notes.length ? `Notes: ${plan.notes.join(" ")}` : "",
    "Write the Seedance prompt now.",
  ]
    .filter(Boolean)
    .join("\n");
}

const counts = (refs: string[]) => ({
  images: refs.filter((r) => /^\s*image\b/i.test(r)).length,
  videos: refs.filter((r) => /^\s*video\b/i.test(r)).length,
  audios: refs.filter((r) => /^\s*audio\b/i.test(r)).length,
});

export type WrittenPrompt = {
  prompt: string;
  usage: DesignUsage;
  /** Rule checks on the prompt (references that do not exist, timing, text in the video...). */
  issues: SeedanceIssue[];
  /** Set when Claude could not be reached and BuPulse's own shot plan was used instead. */
  fallback?: string;
};

export async function writeSeedancePrompt(b: PromptBrief, send: ClaudeTransport, model: string): Promise<WrittenPrompt> {
  const lint = (prompt: string) => lintSeedancePrompt(prompt, { seconds: b.seconds, ...counts(b.references), fixedLens: b.fixedLens, audio: b.audio });
  let answer: Awaited<ReturnType<ClaudeTransport>>;
  try {
    answer = await send({ model, system: SEEDANCE_SYSTEM, content: [{ type: "text", text: promptBriefText(b) }], maxTokens: 800 });
  } catch (error) {
    const plan = planSeedanceShots({ ...b, shotRecipe: isViralStyle(b.templateId) ? (b.recipe ?? null) : null });
    const why = error instanceof Error ? error.message : "no answer";
    return { prompt: plan.prompt, usage: { model, inputTokens: 0, outputTokens: 0, costUsd: 0 }, issues: lint(plan.prompt), fallback: `Claude was unavailable (${why.slice(0, 160)}), so this is BuPulse's own shot plan "${plan.templateName}". Change anything you like.` };
  }
  // Cut by words (about 170), not characters: the 160-word rule, with a little room, at a sentence end.
  const prompt = limitPromptWords(answer.text.replace(/^```[a-z]*\n?|```$/g, "").trim());
  return { prompt, usage: answer.usage, issues: lint(prompt) };
}
