// Company profile (Knowledge base): who the company is, in the owner's words. Pure, shared by the form, the action,
// the AI context and the tests.
//
// Storage: the name, website and sector stay in their Business columns (name, website, industryId / industryOther /
// industryDescription, written the same way as Settings and Brand -> Your industry). Everything else is one JSON column,
// Business.profile, read leniently with readProfile(). The service area is Business.knowledge.area, the same field
// as "Area you serve" in the business info card, so the chat and the writers keep one value.

import { z } from "zod";
import { websiteSchema } from "@/lib/auth/schemas";
import { checkIndustryOther, industryFields } from "@/lib/industries/shared";

export const COMPANY_SIZES = ["solo", "2-5", "6-20", "21-50", "51-200", "200+"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];
export const SIZE_LABEL: Record<CompanySize, string> = {
  solo: "Just me",
  "2-5": "2 to 5 people",
  "6-20": "6 to 20 people",
  "21-50": "21 to 50 people",
  "51-200": "51 to 200 people",
  "200+": "More than 200 people",
};

/** Offered as chips; the owner can add others. */
export const COMMON_LANGUAGES = ["Kinyarwanda", "English", "French", "Swahili"] as const;

export const PROFILE_LIMITS = {
  name: 120,
  tagline: 120,
  mission: 500,
  vision: 500,
  about: 3000,
  legalName: 160,
  registrationNumber: 40,
  serviceArea: 200,
  language: 40,
  value: 60,
  achievement: 200,
} as const;
export const MAX_LANGUAGES = 10;
export const MAX_VALUES = 8;
export const MAX_ACHIEVEMENTS = 10;

export const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .nullable()
    .transform((v) => v || null);

export const chips = (max: number, each: number, label: string) =>
  z
    .array(z.string().max(1000))
    .max(100)
    .default([])
    .transform((list) => {
      const seen = new Set<string>();
      return list.map((v) => v.trim().replace(/\s+/g, " ")).filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
    })
    .pipe(z.array(z.string().max(each, `Keep each one under ${each} characters.`)).max(max, `Add up to ${max} ${label}.`));

/** The JSON stored in Business.profile. */
export const profileSchema = z.object({
  tagline: optional(PROFILE_LIMITS.tagline),
  mission: optional(PROFILE_LIMITS.mission),
  vision: optional(PROFILE_LIMITS.vision),
  /** What the company does, at length. Required in the form. */
  about: optional(PROFILE_LIMITS.about),
  yearFounded: z.number().int().nullable().default(null),
  size: z.enum(COMPANY_SIZES).nullable().default(null),
  legalName: optional(PROFILE_LIMITS.legalName),
  /** Company registration number or TIN (RDB / RRA in Rwanda). */
  registrationNumber: optional(PROFILE_LIMITS.registrationNumber),
  languages: chips(MAX_LANGUAGES, PROFILE_LIMITS.language, "languages"),
  values: chips(MAX_VALUES, PROFILE_LIMITS.value, "values"),
  achievements: chips(MAX_ACHIEVEMENTS, PROFILE_LIMITS.achievement, "achievements"),
});
export type Profile = z.output<typeof profileSchema>;

export const EMPTY_PROFILE: Profile = {
  tagline: null,
  mission: null,
  vision: null,
  about: null,
  yearFounded: null,
  size: null,
  legalName: null,
  registrationNumber: null,
  languages: [],
  values: [],
  achievements: [],
};

/** Reads Business.profile field by field: a broken field is dropped on its own, never an error. */
export function readProfile(value: unknown): Profile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_PROFILE };
  const raw = value as Record<string, unknown>;
  const out: Profile = { ...EMPTY_PROFILE };
  for (const key of Object.keys(EMPTY_PROFILE) as (keyof Profile)[]) {
    const field = profileSchema.shape[key].safeParse(raw[key] ?? undefined);
    if (field.success) (out as Record<string, unknown>)[key] = field.data;
  }
  return out;
}

/** What the profile form sends. */
export function profileInputSchema(now = new Date()) {
  const thisYear = now.getUTCFullYear();
  return z
    .object({
      name: z.string().trim().min(1, "Enter your company name.").max(PROFILE_LIMITS.name, `Use ${PROFILE_LIMITS.name} characters or fewer.`),
      ...industryFields,
      tagline: profileSchema.shape.tagline,
      mission: profileSchema.shape.mission,
      vision: profileSchema.shape.vision,
      about: z.string().trim().min(1, "Say what your company does.").max(PROFILE_LIMITS.about, `Use ${PROFILE_LIMITS.about} characters or fewer.`),
      yearFounded: z
        .string()
        .trim()
        .max(4)
        .optional()
        .default("")
        .transform((v, ctx) => {
          if (!v) return null;
          const year = Number(v);
          if (!/^\d{4}$/.test(v) || year < 1800 || year > thisYear) {
            ctx.addIssue({ code: "custom", message: `Enter a year between 1800 and ${thisYear}.` });
            return z.NEVER;
          }
          return year;
        }),
      size: z.union([z.enum(COMPANY_SIZES), z.literal("")]).optional().default("").transform((v) => v || null),
      legalName: profileSchema.shape.legalName,
      registrationNumber: optional(PROFILE_LIMITS.registrationNumber).refine((v) => v === null || /^[A-Za-z0-9 ./-]+$/.test(v), "Use letters, numbers, spaces, dots, slashes and dashes only."),
      website: websiteSchema.optional().transform((v) => v ?? null),
      serviceArea: optional(PROFILE_LIMITS.serviceArea),
      languages: profileSchema.shape.languages,
      values: profileSchema.shape.values,
      achievements: profileSchema.shape.achievements,
    })
    .superRefine((v, ctx) => checkIndustryOther({ industry: String(v.industry ?? ""), industryOther: String(v.industryOther ?? "") }, ctx), { when: () => true });
}

export type ProfileInput = z.input<ReturnType<typeof profileInputSchema>>;
export type ProfileData = z.output<ReturnType<typeof profileInputSchema>>;

export type ProfileFormValues = {
  name: string;
  industry: string;
  industryOther: string;
  industryDescription: string;
  tagline: string;
  mission: string;
  vision: string;
  about: string;
  yearFounded: string;
  size: string;
  legalName: string;
  registrationNumber: string;
  website: string;
  serviceArea: string;
  languages: string[];
  values: string[];
  achievements: string[];
};

/** The stored profile in the form's shape. `about` starts from the onboarding description when it is still empty. */
export function profileFormValues(
  b: { name: string; website: string | null; description: string | null; profile: unknown; knowledgeArea: string | null | undefined },
  sector: { industry: string; industryOther: string; industryDescription: string },
): ProfileFormValues {
  const p = readProfile(b.profile);
  return {
    name: b.name,
    ...sector,
    tagline: p.tagline ?? "",
    mission: p.mission ?? "",
    vision: p.vision ?? "",
    about: p.about ?? b.description ?? "",
    yearFounded: p.yearFounded ? String(p.yearFounded) : "",
    size: p.size ?? "",
    legalName: p.legalName ?? "",
    registrationNumber: p.registrationNumber ?? "",
    website: b.website ?? "",
    serviceArea: b.knowledgeArea ?? "",
    languages: p.languages,
    values: p.values,
    achievements: p.achievements,
  };
}

/** Business.profile JSON from the parsed form. */
export function profileJson(data: ProfileData): Profile {
  return {
    tagline: data.tagline,
    mission: data.mission,
    vision: data.vision,
    about: data.about,
    yearFounded: data.yearFounded,
    size: data.size,
    legalName: data.legalName,
    registrationNumber: data.registrationNumber,
    languages: data.languages,
    values: data.values,
    achievements: data.achievements,
  };
}

/**
 * How complete the profile is, 0 to 100. The required three (name, what it does, sector) weigh most; the rest add up
 * to the remaining share. Legal name and registration number are optional extras and do not count.
 */
export function profileCompleteness(b: { name: string; website: string | null; hasSector: boolean; profile: unknown; serviceArea: string | null | undefined }): { percent: number; missing: string[] } {
  const p = readProfile(b.profile);
  const checks: [string, boolean, number][] = [
    ["company name", !!b.name.trim(), 15],
    ["what your company does", !!p.about, 20],
    ["sector", b.hasSector, 15],
    ["tagline", !!p.tagline, 8],
    ["mission", !!p.mission, 7],
    ["vision", !!p.vision, 5],
    ["year founded", !!p.yearFounded, 5],
    ["company size", !!p.size, 5],
    ["website", !!b.website, 5],
    ["languages", p.languages.length > 0, 5],
    ["service area", !!b.serviceArea, 5],
    ["values", p.values.length > 0, 5],
  ];
  const total = checks.reduce((s, [, , w]) => s + w, 0);
  const got = checks.reduce((s, [, ok, w]) => s + (ok ? w : 0), 0);
  return { percent: Math.round((got / total) * 100), missing: checks.filter(([, ok]) => !ok).map(([label]) => label) };
}
