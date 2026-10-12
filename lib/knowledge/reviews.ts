// Reviews & testimonials (Knowledge base). Pure, shared by the form, the action, the AI context and the tests.
//
// The AI may quote a review only when the owner ticked "The customer agreed to be quoted" (Testimonial.canPublish).
// Every writer gets the permitted ones only (lib/knowledge/writer-context.ts); the page shows them all.

import { z } from "zod";
import { isDay } from "./campaigns";

export const REVIEW_SOURCES = ["GOOGLE", "WHATSAPP", "IN_PERSON", "FACEBOOK", "INSTAGRAM", "EMAIL", "OTHER"] as const;
export type ReviewSourceValue = (typeof REVIEW_SOURCES)[number];
export const SOURCE_LABEL: Record<ReviewSourceValue, string> = {
  GOOGLE: "Google",
  WHATSAPP: "WhatsApp",
  IN_PERSON: "In person",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  EMAIL: "Email",
  OTHER: "Other",
};

export const REVIEW_LIMITS = { quote: 1000, customerName: 80 } as const;
export const MAX_REVIEWS = 300;

export function reviewInputSchema(today: string) {
  return z.object({
    quote: z.string().trim().min(1, "Paste or type what the customer said.").max(REVIEW_LIMITS.quote, `Use ${REVIEW_LIMITS.quote} characters or fewer.`),
    customerName: z.string().trim().min(1, "Add the customer's name or initials.").max(REVIEW_LIMITS.customerName, `Use ${REVIEW_LIMITS.customerName} characters or fewer.`),
    source: z.enum(REVIEW_SOURCES, "Choose where the review came from."),
    rating: z
      .union([z.number().int().min(1).max(5), z.literal(""), z.null()])
      .optional()
      .transform((v) => (typeof v === "number" ? v : null)),
    receivedOn: z
      .string()
      .trim()
      .optional()
      .default("")
      .transform((v, ctx) => {
        if (!v) return null;
        if (!isDay(v) || v > today) {
          ctx.addIssue({ code: "custom", message: "Enter the date the review was given (not in the future)." });
          return z.NEVER;
        }
        return v;
      }),
    productId: z.string().trim().max(60).optional().default("").transform((v) => v || null),
    canPublish: z.boolean().default(false),
  });
}
export type ReviewInput = z.input<ReturnType<typeof reviewInputSchema>>;
export type ReviewData = z.output<ReturnType<typeof reviewInputSchema>>;

export type ReviewFormValues = { quote: string; customerName: string; source: string; rating: number | ""; receivedOn: string; productId: string; canPublish: boolean };

export function emptyReview(today: string): ReviewFormValues {
  return { quote: "", customerName: "", source: "", rating: "", receivedOn: today, productId: "", canPublish: false };
}

export type ReviewRow = { quote: string; customerName: string; source: ReviewSourceValue; rating: number | null; receivedOn: Date | null; productId: string | null; canPublish: boolean };

export function reviewFormValues(r: ReviewRow): ReviewFormValues {
  return { quote: r.quote, customerName: r.customerName, source: r.source, rating: r.rating ?? "", receivedOn: r.receivedOn?.toISOString().slice(0, 10) ?? "", productId: r.productId ?? "", canPublish: r.canPublish };
}

/** Completeness: three reviews the AI may quote make 100; reviews without permission count a little (they still guide the owner). */
export function reviewsCompleteness(total: number, permitted: number): { percent: number; summary: string } {
  const percent = Math.min(100, Math.round(Math.min(permitted, 3) * (100 / 3) + Math.min(total - permitted, 3) * 5));
  if (!total) return { percent: 0, summary: "Add what customers say about you" };
  return {
    percent: Math.min(percent, permitted >= 3 ? 100 : 95),
    summary: `${total} review${total === 1 ? "" : "s"} · ${permitted} may be quoted`,
  };
}
