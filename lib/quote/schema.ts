import { z } from "zod";
import { normaliseQuotePhone } from "./phone";
import { cleanPagePath, cleanQuoteSource } from "./source";

// "Get a free quote" (the owner's decision of 31 Oct 2026): Rwanda visitors ask for a quote instead of starting a
// free trial, from a pop-up on any marketing page or from /quote (the link in the Instagram and Facebook bios). A
// request is a ContactRequest of kind "quote" with where the person came from and the page it was sent from. Pure, so
// the form and the server share the rules.

export { QUOTE_KIND, POPUP_SOURCE, QUOTE_PAGE_SOURCE, cleanQuoteSource, cleanPagePath } from "./source";

const text = (field: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Please enter your ${field}.`)
    .max(max, `That ${field} is too long.`);

export const quoteSchema = z.object({
  name: text("full name", 120),
  phone: z
    .string()
    .trim()
    .min(1, "Please enter your phone number.")
    .transform((v, ctx) => {
      const e164 = normaliseQuotePhone(v);
      if (!e164) {
        ctx.addIssue({ code: "custom", message: "That phone number does not look right. Try 0788 123 456, or +250 788 123 456." });
        return z.NEVER;
      }
      return e164;
    }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Please enter your email.")
    .max(200, "That email is too long.")
    .pipe(z.email("That email address does not look right.")),
  businessName: text("company or business name", 160),
  note: z
    .string()
    .trim()
    .max(2000, "Please keep this under 2000 characters.")
    .optional()
    .transform((v) => v || undefined),
  source: z.string().optional().transform((v) => cleanQuoteSource(v)),
  pageUrl: z.string().optional().transform((v) => cleanPagePath(v)),
});

export type QuoteInput = z.input<typeof quoteSchema>;
export type QuoteRequest = z.output<typeof quoteSchema>;

export type QuoteFields = "name" | "phone" | "email" | "businessName" | "note";
export const QUOTE_FIELDS: readonly QuoteFields[] = ["name", "phone", "email", "businessName", "note"];

export interface QuoteFormState {
  status: "idle" | "success" | "error";
  errors?: Partial<Record<QuoteFields | "form", string>>;
  values?: Partial<Record<QuoteFields, string>>;
  /** The first name, for the thank-you ("Thank you, Aline"). */
  firstName?: string;
}
