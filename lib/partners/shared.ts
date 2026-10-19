// Partner programme: the parts with no I/O, safe for client components (docs/guide/features/21-partner-programme.md).
import { z } from "zod";
import { REF_ALPHABET } from "@/lib/staff/permissions";

export const PARTNER_KINDS = ["agency", "coworking", "momo_agent", "client", "consultant", "other"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = {
  agency: "Marketing or design agency",
  coworking: "Co-working space or business hub",
  momo_agent: "MoMo agent or merchant",
  client: "BuPulse client",
  consultant: "Business consultant or trainer",
  other: "Something else",
};

export const PARTNER_STATUSES = ["applied", "approved", "rejected", "paused"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = { applied: "New application", approved: "Active", rejected: "Not accepted", paused: "Paused" };

/** Partner codes are 7 characters; staff codes are 5 (6 after collisions), so a code is never both. */
export const PARTNER_CODE_LENGTH = 7;
export const isPartnerCodeShape = (code: string) => code.length === PARTNER_CODE_LENGTH && [...code].every((c) => REF_ALPHABET.includes(c));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Please keep this under ${max} characters.`)
    .optional()
    .transform((v) => v || undefined);

export const partnerApplicationSchema = z.object({
  kind: z.enum(PARTNER_KINDS, { message: "Choose what kind of partner you are." }),
  name: z.string().trim().min(2, "Please tell us your name.").max(120, "That name is too long."),
  organisation: optionalText(160),
  email: z.string().trim().toLowerCase().min(1, "Please enter your email.").max(200, "That email is too long.").pipe(z.email("That email address does not look right.")),
  phone: z
    .string()
    .trim()
    .min(7, "Please enter the phone number we can pay your commission to.")
    .max(30, "That phone number is too long.")
    .regex(/^[+\d][\d\s-]+$/, "Use digits only, for example +250 788 123 456."),
  city: optionalText(80),
  message: optionalText(1000),
  agree: z.literal("yes", { message: "Please accept the partner terms." }),
});
export type PartnerApplication = z.infer<typeof partnerApplicationSchema>;
export type PartnerFields = "kind" | "name" | "organisation" | "email" | "phone" | "city" | "message" | "agree";

export interface PartnerFormState {
  status: "idle" | "success" | "error";
  errors?: Partial<Record<PartnerFields | "form", string>>;
  values?: Partial<Record<PartnerFields, string>>;
}

/** Payout reference (the Mobile Money transaction id of the payout): letters and digits, upper case. */
export const PAYOUT_REFERENCE = /^[A-Z0-9][A-Z0-9-]{3,39}$/;
export const normalizePayoutReference = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "");
