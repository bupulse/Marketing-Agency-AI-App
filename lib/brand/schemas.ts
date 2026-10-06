import { z } from "zod";
import { voices, type VoiceId } from "./voices";

// Brand profile, used by /onboarding (one schema per step) and the Brand page.

const optionalText = (max: number, tooLong = `Use ${max} characters or fewer.`) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((v) => v || undefined);

/** Step 1: what you sell and who to. */
export const offerSchema = z.object({
  description: z
    .string()
    .trim()
    .min(10, "Tell us a little more about what you sell (at least 10 characters).")
    .max(500, "Use 500 characters or fewer."),
  audience: z
    .string()
    .trim()
    .min(3, "Tell us who your customers are.")
    .max(300, "Use 300 characters or fewer."),
});

/** Step 2: brand voice preset. */
export const voiceSchema = z.object({
  tone: z
    .string()
    .refine((v): v is VoiceId => voices.some((voice) => voice.id === v), "Choose a brand voice."),
});

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a colour like #2F6BFF.").transform((v) => v.toUpperCase());

/** Step 3: logo and colours. Both may be added later. */
export const lookSchema = z.object({
  logoPath: z.string().max(300).optional(),
  brandColors: z.array(hexColor).max(3, "Choose up to 3 colours."),
});

export const faqSchema = z.object({
  question: z.string().trim().min(1, "Write the question.").max(200, "Use 200 characters or fewer."),
  answer: z.string().trim().min(1, "Write the answer.").max(600, "Use 600 characters or fewer."),
});

/** Step 4: what the chat widget may answer from. Everything optional. */
export const knowledgeSchema = z.object({
  hours: optionalText(200),
  area: optionalText(200),
  contact: optionalText(200),
  faqs: z.array(faqSchema).max(10, "Add up to 10 questions."),
});

export type Offer = z.infer<typeof offerSchema>;
export type Look = z.infer<typeof lookSchema>;
export type Knowledge = z.infer<typeof knowledgeSchema>;

/** Reads Business.knowledge safely (it is stored as JSON). */
export function readKnowledge(value: unknown): Knowledge {
  const parsed = knowledgeSchema.safeParse(value);
  return parsed.success ? parsed.data : { hours: undefined, area: undefined, contact: undefined, faqs: [] };
}

// No SVG: an SVG can carry scripts, and logos may later be shown inline (widget, designs, emails).
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_COLORS = 3;
export const MAX_ONBOARDING_FAQS = 3;

/** Like fieldErrors, but keeps nested paths ("faqs.0.question") so list rows can show their own errors. */
export function flatErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Drops question/answer pairs that are completely blank, so an empty row is not an error. */
export function prepareFaqs<T extends { question: string; answer: string }>(faqs: T[]): T[] {
  return faqs.filter((f) => f.question.trim() || f.answer.trim());
}

/** Whether a stored logo path belongs to this user's logo folder in the brand bucket. */
export function isOwnLogoPath(userId: string, path: string): boolean {
  return path.startsWith(`${userId}/logo/`) && !path.includes("..");
}

/**
 * Validates step 4. Completely blank FAQ rows are ignored, and errors keep the row's
 * position in the form ("faqs.1.answer") so they show under the right inputs.
 */
export function validateKnowledge(input: {
  hours?: string;
  area?: string;
  contact?: string;
  faqs?: { question: string; answer: string }[];
}): { ok: true; data: Knowledge } | { ok: false; errors: Record<string, string> } {
  const rows = (input.faqs ?? []).map((faq, index) => ({ faq, index })).filter(({ faq }) => faq.question.trim() || faq.answer.trim());
  const parsed = knowledgeSchema.safeParse({
    hours: input.hours ?? "",
    area: input.area ?? "",
    contact: input.contact ?? "",
    faqs: rows.map((r) => r.faq),
  });
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = [...issue.path];
    if (path[0] === "faqs" && typeof path[1] === "number") path[1] = rows[path[1]]?.index ?? path[1];
    const key = path.length ? path.join(".") : "form";
    if (!(key in errors)) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
