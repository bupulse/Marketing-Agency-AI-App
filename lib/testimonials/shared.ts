// Real testimonials on the marketing site (docs/guide/features/34-testimonials.md): the limits and the form's rules.
// Pure and client-safe: the admin form, the service and the tests all read them from here.
import { z } from "zod";
import { AdminError } from "@/lib/admin/types";

export const LIMITS = { clientName: 80, business: 80, sector: 60, quoteMin: 20, quote: 400, result: 120 } as const;

/** The browser crops the photo to a square of this side before sending it (components/admin/testimonial-form.tsx). */
export const PHOTO_SIDE = 160;
/** What the server accepts: a real JPEG, at most this many bytes and pixels a side (room above what the browser makes). */
export const PHOTO_MAX_BYTES = 60 * 1024;
export const PHOTO_MAX_PIXELS = 400;

export const NO_CONSENT =
  "Tick “The client agreed to be shown” before publishing. Only publish words the client agreed to.";

const required = (max: number, field: string) =>
  z.string().trim().min(1, `${field} is required.`).max(max, `${field} must be ${max} characters or fewer.`);
const optional = (max: number, field: string) => z.string().trim().max(max, `${field} must be ${max} characters or fewer.`);

export const testimonialInputSchema = z.object({
  clientName: required(LIMITS.clientName, "The client's name"),
  business: required(LIMITS.business, "The business name"),
  sector: optional(LIMITS.sector, "The sector").default(""),
  quote: z
    .string()
    .trim()
    .min(1, "The quote is required.")
    .min(LIMITS.quoteMin, `The quote needs at least ${LIMITS.quoteMin} characters.`)
    .max(LIMITS.quote, `The quote must be ${LIMITS.quote} characters or fewer.`),
  result: optional(LIMITS.result, "The result").default(""),
  consent: z.boolean().default(false),
  published: z.boolean().default(false),
});

export type TestimonialInput = z.input<typeof testimonialInputSchema>;
export type TestimonialFields = { clientName: string; business: string; sector: string | null; quote: string; result: string | null; consent: boolean; published: boolean };

/** The form, checked: plain-English AdminError on the first problem. Empty optional fields become null. */
export function validateTestimonial(input: TestimonialInput): TestimonialFields {
  const parsed = testimonialInputSchema.safeParse(input);
  if (!parsed.success) throw new AdminError("invalid", parsed.error.issues[0]?.message ?? "Check the form.");
  const v = parsed.data;
  // The database refuses it too (a CHECK), but this says why.
  if (v.published && !v.consent) throw new AdminError("invalid", NO_CONSENT);
  return { ...v, sector: v.sector || null, result: v.result || null };
}

/** "Published", "Hidden" or "No consent": what the admin list shows for a row. */
export function testimonialState(t: { consent: boolean; published: boolean }): "published" | "hidden" | "no_consent" {
  if (!t.consent) return "no_consent";
  return t.published ? "published" : "hidden";
}

/** The badge for each state in Admin (its tone is a components/ui Badge tone). */
export const STATE_BADGE = {
  published: { label: "Published", tone: "success" },
  hidden: { label: "Hidden", tone: "neutral" },
  no_consent: { label: "No consent", tone: "danger" },
} as const;
