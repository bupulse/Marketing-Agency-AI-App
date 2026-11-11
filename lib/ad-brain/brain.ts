// The Ad Brain's thinking steps (docs/AD_BRAIN.md, section 3): Understand -> brand brief, Concept, Script. The model
// sits behind one interface (BrainModel): Gemini 3.8 Flash now, Claude later when ANTHROPIC_API_KEY is set and
// AD_BRAIN_MODEL=claude (owner decision). Every call goes through the AI ledger as feature "adBrain".
import "server-only";
import { z } from "zod";
import { ClaudeTextProvider } from "@/lib/ai/claude-text";
import { GeminiTextProvider } from "@/lib/ai/gemini-text";
import { withLedger, type LedgerContext } from "@/lib/ai/ledger";
import { estimateCostUsd } from "@/lib/ai/pricing";
import type { TextProvider, TokenUsage } from "@/lib/ai/types";
import type { Cta } from "./ctas";
import { effectById } from "./effects";
import type { Concept, ProductPhoto, ScreenCapture } from "./plan";
import { CHARACTER_GUIDE } from "./realism";
import type { AdKind, Recipe } from "./recipes";
import type { Script } from "./script-rules";
import { LINE_MAX_WORDS } from "./script-rules";

export interface BrainModel {
  readonly provider: "gemini" | "claude";
  readonly model: string;
  readonly text: TextProvider;
}

/** The thinking model: AD_BRAIN_MODEL=claude (with ANTHROPIC_API_KEY) or Gemini (default, GEMINI_API_KEY). */
export function brainModel(env: Record<string, string | undefined> = process.env): BrainModel {
  if ((env.AD_BRAIN_MODEL ?? "gemini").toLowerCase() === "claude" && env.ANTHROPIC_API_KEY) {
    const model = env.AD_BRAIN_CLAUDE_MODEL || "claude-opus-5-5";
    return { provider: "claude", model, text: new ClaudeTextProvider(env.ANTHROPIC_API_KEY, model, "medium") };
  }
  if (!env.GEMINI_API_KEY) throw new Error("No Gemini key: add GEMINI_API_KEY in Admin -> Services (Google Gemini).");
  const model = env.AD_BRAIN_TEXT_MODEL || "gemini-3.8-flash";
  return { provider: "gemini", model, text: new GeminiTextProvider(env.GEMINI_API_KEY, model) };
}

export type Thought<T> = { value: T; costUsd: number };

/** A model's JSON answer: as it is, without a code fence, or the outermost {...} inside other text. Undefined if none parses. */
export function parseJsonAnswer(text: string): unknown {
  const tries = [text, text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) tries.push(text.slice(first, last + 1));
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
      // next
    }
  }
  return undefined;
}

/** A string the brain may write too long: kept, cut to `max` (the script rules then judge it). */
const trimmed = (max: number) => z.string().transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max));

/** One JSON answer from the brain, checked with `schema`. Recorded in the ledger whatever happens. */
export async function think<T>(ctx: LedgerContext, brain: BrainModel, req: { system: string; prompt: string; jsonSchema: Record<string, unknown>; maxOutputTokens?: number }, schema: z.ZodType<T>): Promise<Thought<T>> {
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let model = brain.model;
  const result = await withLedger(ctx, { provider: brain.provider, model: brain.model }, () => brain.text.generate({ ...req, maxOutputTokens: req.maxOutputTokens ?? 6000 }), (r) => {
    usage = r.usage;
    model = r.model;
    return { provider: r.provider, model: r.model, usage: r.usage };
  });
  const costUsd = estimateCostUsd(model, usage);
  const raw = parseJsonAnswer(result.text);
  if (raw === undefined) throw Object.assign(new Error("The brain's answer was not valid JSON."), { costUsd });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw Object.assign(new Error(`The brain's answer did not have the right shape (${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}).`), { costUsd });
  return { value: parsed.data, costUsd };
}

const SYSTEM = `You are the creative director of BuPulse's own short vertical videos for Instagram Reels, TikTok, YouTube Shorts and Facebook, made fully automatically: UGC-style ads, and normal content videos (tips, behind the scenes, a day in the life) that must not feel like ads. BuPulse is an AI marketing app for small businesses, launching in Rwanda. You write for scrolling viewers: hook in the first 2 seconds, one idea, plain words, humour welcome. People must look and sound real: ordinary Rwandan adults in real Kigali places, never models, never "cinematic".
Hard rules you never break:
1. Never show AI-drawn screens: phones, laptops and app screens in AI scenes face away or are out of shot. Product screens come only from the real captures listed.
2. The video always ends with the actor SAYING the planned call to action, in a natural, content-like way.
3. AI voices speak English only (never Kinyarwanda).
4. No fake claims, results, testimonials or prices: claim only what is in the facts. Never invent numbers.
5. Never write "AI-generated" or a watermark in titles.
6. Copy the mechanics of a format, never another ad's content, characters or wording.
Answer with JSON only.`;

// ---- Understand -----------------------------------------------------------------------------------------------------

export const brandBriefSchema = z.object({
  oneLiner: z.string().min(5).max(200),
  audience: z.string().min(3).max(300),
  problem: z.string().min(3).max(300),
  goal: z.enum(["awareness", "free_quote", "feature"]),
  feature: z.string().max(80).nullable().optional(),
  claims: z.array(z.object({ claim: z.string().min(3).max(160), source: z.string().min(2).max(200) })).min(2).max(3),
  tone: z.string().max(120),
});
export type BrandBrief = z.infer<typeof brandBriefSchema>;

const BRIEF_JSON = {
  type: "object",
  properties: {
    oneLiner: { type: "string" },
    audience: { type: "string" },
    problem: { type: "string" },
    goal: { type: "string", enum: ["awareness", "free_quote", "feature"] },
    feature: { type: "string" },
    claims: { type: "array", items: { type: "object", properties: { claim: { type: "string" }, source: { type: "string" } }, required: ["claim", "source"] } },
    tone: { type: "string" },
  },
  required: ["oneLiner", "audience", "problem", "goal", "claims", "tone"],
};

export function briefPrompt(input: { facts: string; recentPosts: string[]; notes: string; recentGoals: string[] }): string {
  return [
    "Read BuPulse's real facts below and write the brand brief for ONE new ad.",
    "Pick the goal (awareness, free_quote, or one feature such as Autopilot, posts in Kinyarwanda, branded designs, the website chat). Rotate: avoid the goals of the last ads unless the owner's notes ask for one.",
    "Give 2 or 3 claims that are provable from the facts (each with the fact it comes from).",
    input.notes ? `OWNER'S NOTES FOR THIS AD: ${input.notes.slice(0, 600)}` : "",
    input.recentGoals.length ? `LAST ADS' GOALS: ${input.recentGoals.join(", ")}` : "",
    `FACTS:\n${input.facts}`,
    input.recentPosts.length ? `RECENT POSTS (voice reference only):\n${input.recentPosts.map((p) => `- ${p}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const briefRequest = (input: Parameters<typeof briefPrompt>[0]) => ({ system: SYSTEM, prompt: briefPrompt(input), jsonSchema: BRIEF_JSON });

// ---- Concept --------------------------------------------------------------------------------------------------------

export const conceptAnswerSchema = z.object({ line: z.string().min(10).max(300), musicMood: z.string().min(3).max(120), captionStyle: z.string().max(20), titleStyle: z.string().max(20) });

/** What the kind means for the writing: an ad sells; content helps or entertains and mentions the brand lightly. */
export const KIND_BRIEF: Record<AdKind, string> = {
  ad: "KIND: a UGC ad. It should still feel like organic content in the first seconds (scenario first, no ring-light testimonial), then show BuPulse working on real screens.",
  content: "KIND: a normal content video, NOT an ad. It must be genuinely useful or fun on its own (a tip, a behind-the-scenes moment, a day in the life). BuPulse appears once, honestly, as part of the story; no sales pitch, no 'buy now'.",
};

export function conceptRequest(input: { brief: BrandBrief; recipe: Recipe; effects: string[]; kind?: AdKind; cta?: Cta }) {
  const fx = input.effects.map((id) => `- ${id}: ${effectById(id)?.describe ?? id}`).join("\n");
  return {
    system: SYSTEM,
    prompt: [
      KIND_BRIEF[input.kind ?? "ad"],
      `FORMAT: ${input.recipe.name}. ${input.recipe.mechanics}`,
      `SIGNATURE EFFECTS (already chosen so this video looks different from the last ones):\n${fx}`,
      input.cta ? `PLANNED CALL TO ACTION (said at the end): "${input.cta.text}"` : "",
      `BRAND BRIEF: ${JSON.stringify(input.brief)}`,
      `Write the one-line concept of this video (what happens and why it is funny, useful or surprising), pick the music mood (instrumental, e.g. one of: ${input.recipe.musicMoods.join("; ")}), the caption style (one of ${input.recipe.captionStyles.join(", ")}) and the title style (one of ${input.recipe.titleStyles.join(", ")}).`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    jsonSchema: { type: "object", properties: { line: { type: "string" }, musicMood: { type: "string" }, captionStyle: { type: "string" }, titleStyle: { type: "string" } }, required: ["line", "musicMood", "captionStyle", "titleStyle"] },
  };
}

/** The brain's concept answer kept inside the recipe's choices, with the kind and the planned CTA. */
export function conceptFrom(answer: z.infer<typeof conceptAnswerSchema>, recipe: Recipe, effects: string[], plan: { kind?: AdKind; ctaId?: string } = {}): Concept {
  return {
    recipe: recipe.id,
    effects,
    kind: plan.kind ?? "ad",
    ...(plan.ctaId ? { ctaId: plan.ctaId } : {}),
    line: answer.line,
    musicMood: answer.musicMood,
    captionStyle: recipe.captionStyles.includes(answer.captionStyle) ? answer.captionStyle : recipe.captionStyles[0],
    titleStyle: recipe.titleStyles.includes(answer.titleStyle) ? answer.titleStyle : recipe.titleStyles[0],
  };
}

// ---- Script ---------------------------------------------------------------------------------------------------------

// Lengths are trimmed rather than refused (a refusal costs a whole new script); the script rules judge what is left.
const lineSchema = z.object({ speaker: trimmed(40).pipe(z.string().min(1)), text: trimmed(400).pipe(z.string().min(1)), source: z.enum(["omni", "tts"]) });
export const scriptSchema: z.ZodType<Script> = z.object({
  characters: z.array(z.object({ id: trimmed(40).pipe(z.string().min(1)), gender: z.enum(["man", "woman", "other"]), look: trimmed(600).pipe(z.string().min(10)), variantOf: trimmed(40).nullable().optional(), change: trimmed(600).nullable().optional() })).min(1).max(4),
  beats: z.array(z.object({ beat: trimmed(40).pipe(z.string().min(1)), line: lineSchema.nullable().optional(), scene: trimmed(600).nullable().optional(), action: trimmed(600).nullable().optional(), title: trimmed(60).nullable().optional(), screens: z.array(z.object({ id: trimmed(80), title: trimmed(40) })).max(10).optional(), product: trimmed(80).nullable().optional() })).min(2).max(12),
  cta: lineSchema,
  caption: trimmed(2200).pipe(z.string().min(10)),
  hashtags: z.array(trimmed(40)).max(12),
  endCard: z.object({ headline: trimmed(60).pipe(z.string().min(2)), button: trimmed(40).pipe(z.string().min(2)), sub: trimmed(80).default("") }),
}) as unknown as z.ZodType<Script>;

const LINE_JSON = { type: "object", properties: { speaker: { type: "string" }, text: { type: "string" }, source: { type: "string", enum: ["omni", "tts"] } }, required: ["speaker", "text", "source"] };
const SCRIPT_JSON = {
  type: "object",
  properties: {
    characters: { type: "array", items: { type: "object", properties: { id: { type: "string" }, gender: { type: "string", enum: ["man", "woman", "other"] }, look: { type: "string" }, variantOf: { type: "string" }, change: { type: "string" } }, required: ["id", "gender", "look"] } },
    beats: { type: "array", items: { type: "object", properties: { beat: { type: "string" }, line: LINE_JSON, scene: { type: "string" }, action: { type: "string" }, title: { type: "string" }, screens: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } }, required: ["id", "title"] } }, product: { type: "string" } }, required: ["beat"] } },
    cta: LINE_JSON,
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    endCard: { type: "object", properties: { headline: { type: "string" }, button: { type: "string" }, sub: { type: "string" } }, required: ["headline", "button", "sub"] },
  },
  required: ["characters", "beats", "cta", "caption", "hashtags", "endCard"],
};

export function scriptRequest(input: { brief: BrandBrief; recipe: Recipe; concept: Concept; screens: ScreenCapture[]; facts: string; problems?: string[]; cta?: Cta; products?: readonly ProductPhoto[] }) {
  const r = input.recipe;
  const kind = input.concept.kind ?? "ad";
  const beats = r.beats
    .filter((b) => b.speech !== "cta" && !(b.picture === "end_card" && b.speech === "none"))
    .map((b) => `- "${b.id}" (${b.picture}${b.speech === "line" ? (b.voiceOver ? ", ONE spoken line heard as a voice-over" : ", ONE spoken line") : ", no speech"}${b.titleWords ? `, ${b.titleStyle === "list" ? "a numbered title such as \"1. POST EVERY WEEK\" per screen" : "optional title"} up to ${b.titleWords} words` : ""}${b.screens ? `, ${b.screens.min} to ${b.screens.max} real screens${b.picture === "split" ? " (the first is shown below her)" : ""}` : ""}${b.robot ? ", spoken by the android variant" : ""}${b.ownCharacter ? ", spoken by its OWN sample person (another character); its title is the sample business type, e.g. \"bakery\"" : ""}${b.samePictureAs ? `, same picture as "${b.samePictureAs}"` : ""}): ${b.purpose}`)
    .join("\n");
  const ctaBeat = r.beats.find((b) => b.speech === "cta");
  const screens = input.screens.map((s) => `- id "${s.id}": ${s.page}, ${s.label}`).join("\n");
  const products = (input.products ?? []).map((p) => `- id "${p.id}": ${p.name}`).join("\n");
  return {
    system: SYSTEM,
    prompt: [
      KIND_BRIEF[kind],
      `FORMAT: ${r.name}. ${r.mechanics}`,
      `CONCEPT: ${input.concept.line}`,
      `BRAND BRIEF: ${JSON.stringify(input.brief)}`,
      `FACTS (the only things you may claim):\n${input.facts.slice(0, 5000)}`,
      `CHARACTERS: ${r.characters.count} person${r.characters.count > 1 ? "s" : ""}${r.characters.variants ? ` plus ${r.characters.variants} variant(s) made by editing the SAME photo (set variantOf to the person's id and "change" to what is replaced, e.g. "Replace only his face, head, neck and hands with a sleek chrome android with glowing blue eyes")` : ""}. Write each person's "look" as a plain photo description: ${CHARACTER_GUIDE.join("; ")}. Never write "cinematic", "professional", "perfect skin", "flawless", "studio" or "ring light". No famous people.`,
      `BEATS, in order (fill every one; "scene" describes a NEW picture of the person when the character portrait is not enough; "action" is the movement for clips; when a real product from the list below is in the picture, set "product" to its id):\n${beats}`,
      `REAL SCREENS you may use (ids; the number after a page is how much real data it shows):\n${screens || "(none)"}`,
      products ? `REAL PRODUCT PHOTOS (use their ids in "product"):\n${products}` : "",
      `SPOKEN LINES: one per speaking beat, at most ${LINE_MAX_WORDS} words (about 2.5 words a second; most lines 6 to 15 words), said like a real person talks (contractions, a small pause, starting mid-thought is fine). The first line is the hook: a scenario, confession, question or pattern break, never the brand name first. source "omni" = said on camera (lip-sync); source "tts" = a voice-over (only when nobody is on camera).`,
      input.cta
        ? `CALL TO ACTION ("cta"): the last line, said by the main person${ctaBeat?.picture === "clip" ? " on camera" : " over the end card"}, relaxed, like content and not like an ad. It must carry this planned CTA: "${input.cta.spoken}" (you may add a few words around it, e.g. "If you want one, ...").`
        : `CALL TO ACTION ("cta"): the last line, spoken by the main person, names bupulse dot com, e.g. "Go to BuPulse dot com and ask for a quote."`,
      `Also: the post caption (brand voice, 1 to 3 short lines, no invented numbers), 4 to 8 hashtags, and the end card (headline up to 6 words, button text, one small line).`,
      input.problems?.length ? `YOUR LAST SCRIPT BROKE THESE RULES, fix every one:\n${input.problems.map((p) => `- ${p}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    jsonSchema: SCRIPT_JSON,
    maxOutputTokens: 12000,
  };
}

// ---- Variants -------------------------------------------------------------------------------------------------------

export const hooksSchema = z.object({ hooks: z.array(trimmed(200).pipe(z.string().min(3))).min(1).max(4) });

/** Other opening lines for the same video (variants.ts): same speaker, same body, a different way to stop the scroll. */
export function hooksRequest(input: { script: Script; hookBeat: string; count: number; kind?: AdKind }) {
  const own = input.script.beats.find((b) => b.beat === input.hookBeat)?.line?.text ?? "";
  return {
    system: SYSTEM,
    prompt: [
      KIND_BRIEF[input.kind ?? "ad"],
      `This video's opening line is: "${own}". The rest of the script stays the same: ${JSON.stringify(input.script.beats.slice(1).map((b) => b.line?.text).filter(Boolean))}`,
      `Write ${input.count} OTHER opening lines for the same person, each a different hook type (a scenario, a confession, a question, a pattern break), at most 15 words, natural spoken English, never starting with the brand name, never inventing numbers or results.`,
    ].join("\n\n"),
    jsonSchema: { type: "object", properties: { hooks: { type: "array", items: { type: "string" } } }, required: ["hooks"] },
  };
}
