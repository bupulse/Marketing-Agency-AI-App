// Claude as the director for Seedance (docs/VIDEO_ENGINE.md, "Studio" and "Seedance brain"): writes the shot list a
// video model needs from the product facts, the template's art direction and the owner's line. Claude writes the
// prompt; Seedance films it. The rules, the camera words and a starting shot plan come from the brain
// (seedance-brain.ts); when Claude is unavailable, the plan itself is the prompt.
import type { ClaudeTransport, DesignUsage } from "./designer";
import { cameraLanguageText, lintSeedancePrompt, planSeedanceShots, seedanceRulesText, seedanceTemplateById, shotTypesText, type BusinessKind, type SeedanceFormat, type SeedanceIssue } from "./seedance-brain";
import { templateById } from "./templates";

export type PromptBrief = {
  business: { name: string; description?: string | null; language?: string | null; country?: string | null };
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
};

export const SEEDANCE_SYSTEM = [
  "You write prompts for Seedance 2.0, a video generation model, for small-business ads in Rwanda and East Africa. You answer with the prompt text only: no title, no explanation, no quotes around it.",
  "Rules of a good Seedance prompt:",
  seedanceRulesText(),
  `Camera moves Seedance knows: ${cameraLanguageText()}.`,
  `Shot types: ${shotTypesText()}.`,
  "The brief has a starting shot plan made from a proven template. Keep its timing and structure unless the owner asks for something else; improve the actions, the light and the sound with what you see in the facts.",
].join("\n");

export function promptBriefText(b: PromptBrief): string {
  const sd = seedanceTemplateById(b.templateId);
  const t = sd ? null : templateById(b.templateId);
  const plan = planSeedanceShots(b);
  return [
    `Length ${b.seconds} seconds, ratio ${b.ratio}, ${b.audio ? "with sound" : "no sound"}${b.fixedLens ? ", fixed lens (no camera moves)" : ""}.`,
    t ? `Template "${t.name}": ${t.direction}` : `Template "${plan.templateName}".`,
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
    const plan = planSeedanceShots(b);
    const why = error instanceof Error ? error.message : "no answer";
    return { prompt: plan.prompt, usage: { model, inputTokens: 0, outputTokens: 0, costUsd: 0 }, issues: lint(plan.prompt), fallback: `Claude was unavailable (${why.slice(0, 160)}), so this is BuPulse's own shot plan "${plan.templateName}". Change anything you like.` };
  }
  const prompt = answer.text.replace(/^```[a-z]*\n?|```$/g, "").trim().slice(0, 1800);
  return { prompt, usage: answer.usage, issues: lint(prompt) };
}
