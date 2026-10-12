// Customers & audience (Knowledge base): personas and the overall audience notes. Pure, shared by the form, the action,
// the AI context and the tests.
//
// Storage: one Persona row per persona (ordered by `position`), the notes in Business.audienceNotes. The one-line
// "who your customers are" of onboarding (Business.audience) stays where it is; the writers get both.

import { z } from "zod";
import { chips, optional } from "./profile";

export const AGE_RANGES = ["any", "under-18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"] as const;
export type AgeRange = (typeof AGE_RANGES)[number];
export const AGE_LABEL: Record<AgeRange, string> = {
  any: "All ages",
  "under-18": "Under 18",
  "18-24": "18 to 24",
  "25-34": "25 to 34",
  "35-44": "35 to 44",
  "45-54": "45 to 54",
  "55-64": "55 to 64",
  "65+": "65 and over",
};

export const GENDERS = ["female", "male", "any"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABEL: Record<Gender, string> = { female: "Mostly women", male: "Mostly men", any: "Any gender" };

export const INCOME_BANDS = ["low", "middle", "high"] as const;
export type IncomeBand = (typeof INCOME_BANDS)[number];
export const INCOME_LABEL: Record<IncomeBand, string> = { low: "Lower income", middle: "Middle income", high: "Higher income" };

/** Offered as chips for "where they spend time online"; the owner can add others. */
export const ONLINE_PLACES = ["WhatsApp", "Instagram", "Facebook", "TikTok", "YouTube", "X (Twitter)", "LinkedIn", "Google search"] as const;
export const PERSONA_LANGUAGES = ["Kinyarwanda", "English", "French", "Swahili"] as const;

export const PERSONA_LIMITS = { name: 80, location: 120, occupation: 120, language: 40, line: 160, notes: 2000 } as const;
export const PERSONA_LIST_MAX = 8;
export const MAX_PERSONAS = 12;

export const personaInputSchema = z.object({
  name: z.string().trim().min(1, "Give this persona a name, e.g. “Busy office worker”.").max(PERSONA_LIMITS.name, `Use ${PERSONA_LIMITS.name} characters or fewer.`),
  ageRange: z.enum(AGE_RANGES, "Choose an age range."),
  gender: z.union([z.enum(GENDERS), z.literal("")]).optional().default("").transform((v) => v || null),
  location: z.string().trim().min(1, "Say where they live or work.").max(PERSONA_LIMITS.location, `Use ${PERSONA_LIMITS.location} characters or fewer.`),
  occupation: optional(PERSONA_LIMITS.occupation),
  incomeBand: z.union([z.enum(INCOME_BANDS), z.literal("")]).optional().default("").transform((v) => v || null),
  needs: chips(PERSONA_LIST_MAX, PERSONA_LIMITS.line, "needs"),
  pains: chips(PERSONA_LIST_MAX, PERSONA_LIMITS.line, "pains"),
  objections: chips(PERSONA_LIST_MAX, PERSONA_LIMITS.line, "objections"),
  channels: chips(PERSONA_LIST_MAX, PERSONA_LIMITS.line, "places"),
  triggers: chips(PERSONA_LIST_MAX, PERSONA_LIMITS.line, "buying triggers"),
  language: optional(PERSONA_LIMITS.language),
});
export type PersonaInput = z.input<typeof personaInputSchema>;
export type PersonaData = z.output<typeof personaInputSchema>;

export const audienceNotesSchema = z.object({ notes: optional(PERSONA_LIMITS.notes) });

export type PersonaFormValues = {
  name: string;
  ageRange: string;
  gender: string;
  location: string;
  occupation: string;
  incomeBand: string;
  needs: string[];
  pains: string[];
  objections: string[];
  channels: string[];
  triggers: string[];
  language: string;
};

export const EMPTY_PERSONA: PersonaFormValues = {
  name: "",
  ageRange: "",
  gender: "",
  location: "",
  occupation: "",
  incomeBand: "",
  needs: [],
  pains: [],
  objections: [],
  channels: [],
  triggers: [],
  language: "",
};

export type PersonaRow = {
  name: string;
  ageRange: string;
  gender: string | null;
  location: string;
  occupation: string | null;
  incomeBand: string | null;
  needs: string[];
  pains: string[];
  objections: string[];
  channels: string[];
  triggers: string[];
  language: string | null;
};

export function personaFormValues(p: PersonaRow): PersonaFormValues {
  return { ...p, gender: p.gender ?? "", occupation: p.occupation ?? "", incomeBand: p.incomeBand ?? "", language: p.language ?? "" };
}

const isAge = (v: string): v is AgeRange => (AGE_RANGES as readonly string[]).includes(v);
const isGender = (v: string | null): v is Gender => !!v && (GENDERS as readonly string[]).includes(v);
const isIncome = (v: string | null): v is IncomeBand => !!v && (INCOME_BANDS as readonly string[]).includes(v);

/** "25 to 34 · Mostly women · Kigali · Nurse" for a card or the AI. */
export function personaLine(p: PersonaRow): string {
  return [isAge(p.ageRange) ? AGE_LABEL[p.ageRange] : null, isGender(p.gender) && p.gender !== "any" ? GENDER_LABEL[p.gender] : null, p.location, p.occupation, isIncome(p.incomeBand) ? INCOME_LABEL[p.incomeBand] : null]
    .filter(Boolean)
    .join(" · ");
}

/** What a persona still lacks to be useful to the writers (the needs and pains matter most). */
export function personaGaps(p: Pick<PersonaRow, "needs" | "pains" | "triggers" | "channels">): string[] {
  return [!p.needs.length && "needs", !p.pains.length && "pains", !p.triggers.length && "buying triggers", !p.channels.length && "where they are online"].filter((x): x is string => !!x);
}

/**
 * Completeness, 0 to 100. One persona is enough for "complete" when it has its needs, pains, triggers and channels;
 * with none it is 0. The notes add nothing on their own (they help, but a persona is the point).
 */
export function audienceCompleteness(personas: Pick<PersonaRow, "needs" | "pains" | "triggers" | "channels">[]): { percent: number; summary: string } {
  if (!personas.length) return { percent: 0, summary: "Describe your first customer persona" };
  const best = Math.min(...personas.map((p) => personaGaps(p).length));
  const percent = Math.round(50 + ((4 - best) / 4) * 50);
  const first = personas.map(personaGaps).find((g) => g.length === best) ?? [];
  return {
    percent,
    summary: percent >= 100 ? `${personas.length} persona${personas.length === 1 ? "" : "s"}` : `Add their ${first.slice(0, 2).join(" and ")}`,
  };
}
