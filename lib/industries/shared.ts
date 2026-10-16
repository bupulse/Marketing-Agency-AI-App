// Industries as the forms see them: pure types and the "Other" value, shared by the sign-up / welcome / brand forms
// (client) and their server actions. The rows themselves come from lib/industries/server.ts.
import { z } from "zod";

/** The select value that means "none of the listed sectors": the owner types their own industry. */
export const INDUSTRY_OTHER = "other";

export type IndustryOption = { slug: string; name: string };

export const INDUSTRY_OTHER_MAX = 80;
export const INDUSTRY_DESCRIPTION_MIN = 20;
export const INDUSTRY_DESCRIPTION_MAX = 500;

export const INDUSTRY_DESCRIPTION_EXAMPLE = "We sell kitenge dresses and accessories to young women in Kigali";

/** Sector + "Other" text + description, as typed. The sector itself is checked against the live list by the server. */
export const industryFields = {
  industry: z.string().trim().min(1, "Choose your business sector.").max(60, "Choose your business sector from the list."),
  industryOther: z.string().trim().max(INDUSTRY_OTHER_MAX, `Use ${INDUSTRY_OTHER_MAX} characters or fewer.`),
  industryDescription: z
    .string()
    .trim()
    .min(1, "Describe your business in a sentence or two.")
    .min(INDUSTRY_DESCRIPTION_MIN, `Tell us a little more (at least ${INDUSTRY_DESCRIPTION_MIN} characters).`)
    .max(INDUSTRY_DESCRIPTION_MAX, `Use ${INDUSTRY_DESCRIPTION_MAX} characters or fewer.`),
};

export type IndustryFieldValues = { industry: string; industryOther: string; industryDescription: string };

/** "Other" needs the owner's own industry text; a listed sector ignores it. Add to the object schema's superRefine. */
export function checkIndustryOther(v: { industry: string; industryOther: string }, ctx: z.RefinementCtx) {
  if (v.industry === INDUSTRY_OTHER && !v.industryOther.trim()) {
    ctx.addIssue({ code: "custom", path: ["industryOther"], message: "Tell us your industry." });
  }
}

/** The normalised key of an "Other" text, for grouping suggestions and matching dismissals. */
export function industryKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The sector of a saved business as the form shows it: the slug, or "other" with the owner's text. */
export function industryFormValues(b: { industryRef?: { slug: string } | null; industryId?: string | null; industryOther?: string | null; industryDescription?: string | null }): IndustryFieldValues {
  return {
    industry: b.industryRef?.slug ?? (b.industryOther ? INDUSTRY_OTHER : ""),
    industryOther: b.industryOther ?? "",
    industryDescription: b.industryDescription ?? "",
  };
}
