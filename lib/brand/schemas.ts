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
