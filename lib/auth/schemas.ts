import { z } from "zod";
import { countries } from "@/lib/content/countries";
import { industries } from "@/lib/content/site";

// Shared by the sign-up wizard (client-side step checks) and the server actions.

export const INDUSTRY_OTHER = "Other";
export const industryOptions: string[] = [...industries.map((i) => i.name), INDUSTRY_OTHER];

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
const websiteSchema = z
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

const phoneSchema = z
  .string()
  .trim()
  .max(30, "That phone number is too long.")
  .transform((v, ctx) => {
    if (!v) return undefined;
    const digits = v.replace(/\D/g, "").length;
    if (!/^[+\d\s().-]+$/.test(v) || digits < 6 || digits > 15) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number, like +1 555 123 4567." });
      return z.NEVER;
    }
    return v;
  });

export const organisationSchema = z.object({
  organisationName: z.string().trim().min(1, "Enter your organisation name.").max(120, "Use 120 characters or fewer."),
  ceoName: z.string().trim().min(1, "Enter the CEO's name.").max(100, "Use 100 characters or fewer."),
  industry: z
    .string()
    .min(1, "Choose your industry.")
    .refine((v) => industryOptions.includes(v), "Choose your industry from the list."),
  country: z
    .string()
    .min(1, "Choose your country.")
    .refine((v) => (countries as readonly string[]).includes(v), "Choose your country from the list."),
  phone: phoneSchema,
  website: websiteSchema,
});

// /welcome: Google sign-ups give the organisation details and accept the terms (no password).
export const welcomeSchema = organisationSchema.extend({
  terms: z.literal(true, { error: "Agree to the Terms and Privacy Policy to continue." }),
});

// Zod skips object-level checks when a field already failed; run the match check regardless
// so a mismatch is reported alongside other problems.
const always = { when: () => true } as const;

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

export const signUpSchema = z.object({
  ...emailStepSchema.shape,
  ...organisationSchema.shape,
  password: passwordSchema,
  confirmPassword: z.string().min(1, "Confirm your password."),
  terms: z.literal(true, { error: "Agree to the Terms and Privacy Policy to continue." }),
}).refine((v) => v.password === v.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
  ...always,
});

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
