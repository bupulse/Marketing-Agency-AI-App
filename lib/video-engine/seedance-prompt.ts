// Claude as the director for Seedance (docs/VIDEO_ENGINE.md, "Studio"): writes the shot list a video model needs from
// the product facts, the template's art direction and the owner's line. Claude writes the prompt; Seedance films it.
import type { ClaudeTransport } from "./designer";
import { templateById } from "./templates";

export type PromptBrief = {
  business: { name: string; description?: string | null; language?: string | null; country?: string | null };
  product: { name: string; summary?: string | null; description?: string | null; price?: string | null; usps?: string[]; features?: string[] };
  /** What each reference is, in order: "Image 1: the product photo (blue phone on a stand)". */
  references: string[];
  templateId: string;
  note?: string | null;
  seconds: number;
  ratio: string;
  audio: boolean;
  presenter?: string | null;
};

const SYSTEM = [
  "You write prompts for Seedance 2.0, a video generation model, for small-business ads in Rwanda and East Africa. You answer with the prompt text only: no title, no explanation, no quotes around it.",
  "Rules of a good Seedance prompt:",
  "- Structure by time: '0-2s: ...; 2-5s: ...' adding up to the requested length. One clear subject, one place, 2 to 4 shots.",
  "- Name the subject, the action, the place, the light, the camera move (dolly in, slow orbit, handheld, close-up, pull back) and the sound (ambient sound, music mood, a spoken line in quotes if the presenter talks).",
  "- Refer to references by number exactly as given (Image 1, Video 1, Audio 1). The product must stay exactly as in its photo: 'same shape, colours and label as Image N'.",
  "- Use ONLY facts in the brief. No invented prices, discounts, claims or ingredients. Spoken lines are short and in the business's content language.",
  "- People: only a presenter the brief names (from the character library) or a fictional adult described generally (no real or famous people). Respectful everyday clothing. Nothing medical.",
  "- End the clip on the product, clearly visible, as a natural hero shot (no on-screen text: text is added later).",
  "- 60 to 160 words.",
].join("\n");

export function promptBriefText(b: PromptBrief): string {
  const t = templateById(b.templateId);
  return [
    `Length ${b.seconds} seconds, ratio ${b.ratio}, ${b.audio ? "with sound" : "no sound"}.`,
    `Template "${t.name}": ${t.direction}`,
    b.presenter ? `Presenter: ${b.presenter}.` : "No presenter: show hands, the product and the place; a person may appear from behind or at a distance only.",
    b.note ? `The owner asks: <<<${b.note.replace(/<<<|>>>/g, "")}>>>` : "",
    "",
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
    "Write the Seedance prompt now.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function writeSeedancePrompt(b: PromptBrief, send: ClaudeTransport, model: string): Promise<{ prompt: string; usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number } }> {
  const answer = await send({ model, system: SYSTEM, content: [{ type: "text", text: promptBriefText(b) }], maxTokens: 800 });
  const prompt = answer.text.replace(/^```[a-z]*\n?|```$/g, "").trim().slice(0, 1800);
  return { prompt, usage: answer.usage };
}
