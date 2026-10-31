import { z } from "zod";
import { countries } from "@/lib/content/countries";
import { industries } from "@/lib/content/site";
import { checkIndustryOther, industryFields } from "@/lib/industries/shared";
import { phoneCountry, phoneErrorFor, phoneErrorMessage, pickerCountry, toE164 } from "@/lib/phone";

// Shared by the sign-up wizard (client-side step checks) and the server actions.

/** Legacy: the sector names of the marketing list plus "Other", as Business.industry stored them before industries became data. */
export const industryOptions: string[] = [...industries.map((i) => i.name), "Other"];

export const PASSWORD_MIN = 8;

export const passwordRules = [
  { id: "length", label: `At least ${PASSWORD_MIN} characters`, test: (v: string) => v.length >= PASSWORD_MIN },
  { id: "letter", label: "At least one letter", test: (v: string) => /[A-Za-z]/.test(v) },
  { id: "number", label: "At least one number", test: (v: string) => /\d/.test(v) },
] as const;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter a valid email address."));

export const passwordSchema = z
  .string()
  .min(1, "Enter a password.")
  .max(72, "Use 72 characters or fewer.")
  .refine((v) => passwordRules.every((r) => r.test(v)), {
    message: `Use at least ${PASSWORD_MIN} characters with a letter and a number.`,
  });

// Accepts "example.com" as well as full URLs; stores a normalised https URL.
export const websiteSchema = z
  .string()
  .trim()
  .max(200, "That website address is too long.")
  .transform((v, ctx) => {
    if (!v) return undefined;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const url = new URL(withScheme);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) throw new Error();
      return url.toString().replace(/\/$/, "");
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid website, like yourbusiness.com." });
      return z.NEVER;
    }
  });

// The phone is checked against the chosen country (see withOrganisationChecks): here only the shape and length.
const phoneSchema = z.string().trim().max(30, "That phone number is too long.");

// The country picked on the phone field itself (an ISO code, "KE"). Missing on older forms and in the tests: then the
// business country decides, as before. Picking it is deliberate (the flag shows), so a Kenyan number with Kenya picked
// is fine on a Rwandan company; "+254..." typed with Rwanda still showing stays a typo.
const phoneCountrySchema = z.string().trim().max(3).optional();

/** The ISO code the phone is checked against: the picked one, else the business country's. */
function phoneCheckCountry(picked: string | undefined, countryName: string | null | undefined) {
  return pickerCountry(picked) ?? phoneCountry(countryName);
}

/** The business country's message ("Enter a valid Rwandan number..."), or the picked country's when it differs. */
function phoneMessage(picked: string | undefined, countryName: string | null | undefined) {
  const code = pickerCountry(picked);
  return code && code !== phoneCountry(countryName) ? phoneErrorFor(code) : phoneErrorMessage(countryName);
}

export const countrySchema = z
  .string()
  .min(1, "Choose your country.")
  .refine((v) => (countries as readonly string[]).includes(v), "Choose your country from the list.");

/** Name, CEO, sector and contact details. The country is part of sign-up only: afterwards only an admin changes it. */
const organisationShape = {
  organisationName: z.string().trim().min(1, "Enter your organisation name.").max(120, "Use 120 characters or fewer."),
  ceoName: z.string().trim().min(1, "Enter the CEO's name.").max(100, "Use 100 characters or fewer."),
  ...industryFields,
  country: countrySchema,
  phone: phoneSchema,
  phoneCountry: phoneCountrySchema,
  website: websiteSchema,
};

type OrganisationIn = { industry: string; industryOther: string; country: string; phone: string; phoneCountry?: string };

// Zod skips object-level checks when a field already failed; run them regardless so every problem shows at once.
const always = { when: () => true } as const;

/**
 * The cross-field checks every organisation form shares: "Other" needs the industry text, and the phone (optional)
 * must be a valid number for the chosen country; it is stored as E.164 ("+250791954277").
 */
function organisationChecks(v: OrganisationIn, ctx: z.RefinementCtx) {
  checkIndustryOther({ industry: String(v.industry ?? ""), industryOther: String(v.industryOther ?? "") }, ctx);
  if (typeof v.phone === "string" && v.phone && !toE164(v.phone, phoneCheckCountry(v.phoneCountry, v.country))) {
    ctx.addIssue({ code: "custom", path: ["phone"], message: phoneMessage(v.phoneCountry, v.country) });
  }
}

function withPhoneE164<T extends OrganisationIn>(v: T): Omit<T, "phone"> & { phone: string | undefined } {
  return { ...v, phone: v.phone ? (toE164(v.phone, phoneCheckCountry(v.phoneCountry, v.country)) ?? undefined) : undefined };
}

export const organisationSchema = z.object(organisationShape).superRefine(organisationChecks, always).transform(withPhoneE164);

// /welcome: Google sign-ups give the organisation details and accept the terms (no password).
export const welcomeSchema = z
  .object({ ...organisationShape, terms: z.literal(true, { error: "Agree to the Terms and Privacy Policy to continue." }) })
  .superRefine(organisationChecks, always)
  .transform(withPhoneE164);

/**
 * Settings -> Business: everything but the sector and the country. The phone is checked against the company's saved
 * country, which the action passes in (the owner cannot change the country or the region: docs/REGIONS.md).
 */
export function businessDetailsSchema(country: string | null | undefined) {
  return z
    .object({ organisationName: organisationShape.organisationName, ceoName: organisationShape.ceoName, phone: phoneSchema, phoneCountry: phoneCountrySchema, website: websiteSchema })
    .superRefine((v, ctx) => {
      if (typeof v.phone === "string" && v.phone && !toE164(v.phone, phoneCheckCountry(v.phoneCountry, country))) ctx.addIssue({ code: "custom", path: ["phone"], message: phoneMessage(v.phoneCountry, country) });
    }, always)
    .transform((v) => ({ ...v, phone: v.phone ? (toE164(v.phone, phoneCheckCountry(v.phoneCountry, country)) ?? undefined) : undefined }));
}

/** Brand -> Industry: the sector, the "Other" text and the description, editable by the owner at any time. */
export const industrySchema = z.object(industryFields).superRefine((v, ctx) => checkIndustryOther({ industry: String(v.industry ?? ""), industryOther: String(v.industryOther ?? "") }, ctx), always);

export const emailStepSchema = z.object({ email: emailSchema });

export const passwordStepSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
    terms: z.literal(true, { error: "Agree to the Terms and Privacy Policy to continue." }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
    ...always,
  });

export const signUpSchema = z
  .object({
    ...emailStepSchema.shape,
    ...organisationShape,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
    terms: z.literal(true, { error: "Agree to the Terms and Privacy Policy to continue." }),
  })
  .superRefine((v, ctx) => {
    organisationChecks(v, ctx);
    if (v.password !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match." });
  }, always)
  .transform(withPhoneE164);

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string().min(1, "Confirm your password.") })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match.", ...always });

export type SignUpInput = z.input<typeof signUpSchema>;
export type FieldErrors = Record<string, string>;

/** First message per field, for showing under inputs. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
