// FAQs & policies (Knowledge base). Pure, shared by the forms, the actions, the AI context and the tests.
//
// Storage: one KnowledgeFaq row per question, in `position` order (they used to be Business.knowledge.faqs, at most
// 10; the migration copied them). The policies are Business.policies (JSON, read leniently with readPolicies).

import { z } from "zod";
import { optional } from "./profile";

export const FAQ_LIMITS = { question: 200, answer: 1000 } as const;
/** "Unlimited" for an owner; a ceiling so one company cannot fill the table. */
export const MAX_FAQS = 200;

export const faqInputSchema = z.object({
  question: z.string().trim().min(1, "Write the question.").max(FAQ_LIMITS.question, `Use ${FAQ_LIMITS.question} characters or fewer.`),
  answer: z.string().trim().min(1, "Write the answer.").max(FAQ_LIMITS.answer, `Use ${FAQ_LIMITS.answer} characters or fewer.`),
});
export type FaqInput = z.input<typeof faqInputSchema>;

export const PAYMENT_METHODS = ["mtn_momo", "airtel_money", "cash", "card", "bank"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  mtn_momo: "MTN Mobile Money",
  airtel_money: "Airtel Money",
  cash: "Cash",
  card: "Card",
  bank: "Bank transfer",
};

export const POLICY_LIMITS = { text: 1000, paymentNotes: 300 } as const;

/** The policy texts, in the order the page and the AI show them. */
export const POLICY_FIELDS = [
  { key: "delivery", label: "Delivery", hint: "Where you deliver, how long it takes and what it costs.", placeholder: "Free delivery in Kigali for orders over 20,000 RWF, same day if you order before 2 pm. Elsewhere in Rwanda by bus, 2 to 3 days." },
  { key: "returns", label: "Returns and refunds", hint: "What can be returned, within how long, and how refunds are paid.", placeholder: "Unused items can be returned within 7 days with the receipt. We refund by Mobile Money within 2 days." },
  { key: "warranty", label: "Warranties and guarantees", hint: "What you guarantee and for how long.", placeholder: "Phones have a 12-month warranty. Repairs are guaranteed for 3 months." },
  { key: "booking", label: "Booking and cancellation", hint: "How to book, and what happens if a customer cancels or is late.", placeholder: "Book by WhatsApp. Cancel at least 24 hours before for free; later cancellations pay 50%." },
] as const;
export type PolicyTextKey = (typeof POLICY_FIELDS)[number]["key"];

export const policiesSchema = z.object({
  delivery: optional(POLICY_LIMITS.text),
  returns: optional(POLICY_LIMITS.text),
  warranty: optional(POLICY_LIMITS.text),
  booking: optional(POLICY_LIMITS.text),
  paymentMethods: z
    .array(z.enum(PAYMENT_METHODS))
    .max(PAYMENT_METHODS.length)
    .default([])
    .transform((list) => PAYMENT_METHODS.filter((m) => list.includes(m))),
  paymentNotes: optional(POLICY_LIMITS.paymentNotes),
});
export type Policies = z.output<typeof policiesSchema>;
export type PoliciesInput = z.input<typeof policiesSchema>;

export const EMPTY_POLICIES: Policies = { delivery: null, returns: null, warranty: null, booking: null, paymentMethods: [], paymentNotes: null };

/** Reads Business.policies field by field: a broken field is dropped on its own, never an error. */
export function readPolicies(value: unknown): Policies {
  const out: Policies = { ...EMPTY_POLICIES, paymentMethods: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(EMPTY_POLICIES) as (keyof Policies)[]) {
    const field = policiesSchema.shape[key].safeParse(raw[key] ?? undefined);
    if (field.success) (out as Record<string, unknown>)[key] = field.data;
  }
  return out;
}

export function hasPolicies(p: Policies): boolean {
  return !!(p.delivery || p.returns || p.warranty || p.booking || p.paymentMethods.length || p.paymentNotes);
}

/** "MTN Mobile Money, Cash. Pay on delivery in Kigali" */
export function paymentLine(p: Policies): string {
  return [p.paymentMethods.map((m) => PAYMENT_LABEL[m]).join(", "), p.paymentNotes].filter(Boolean).join(". ");
}

/**
 * Completeness, 0 to 100: three FAQs make 40 (a share for one or two), payment methods 20, and the four policy texts
 * 10 each. A business that does not deliver or book can say so in the text ("We do not deliver."), which counts.
 */
export function faqsCompleteness(faqCount: number, p: Policies): { percent: number; summary: string } {
  const texts = POLICY_FIELDS.filter((f) => !!p[f.key]).length;
  const percent = Math.round(Math.min(faqCount, 3) * (40 / 3) + (p.paymentMethods.length ? 20 : 0) + texts * 10);
  const missing = [faqCount < 3 && (faqCount ? "more questions" : "your common questions"), !p.paymentMethods.length && "payment methods", texts < POLICY_FIELDS.length && "your policies"].filter(Boolean);
  return { percent, summary: missing.length ? `Add ${missing.slice(0, 2).join(" and ")}` : `${faqCount} questions · policies set` };
}
