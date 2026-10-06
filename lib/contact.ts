import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const contactKinds = ["contact", "done_for_you"] as const;
export type ContactKind = (typeof contactKinds)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Please keep this under ${max} characters.`)
    .optional()
    .transform((v) => v || undefined);

export const contactSchema = z.object({
  kind: z.enum(contactKinds),
  name: z.string().trim().min(1, "Please tell us your name.").max(120, "That name is too long."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Please enter your email.")
    .max(200, "That email is too long.")
    .pipe(z.email("That email address does not look right.")),
  phone: optionalText(40),
  businessName: optionalText(160),
  industry: optionalText(80),
  message: z.string().trim().min(10, "Please write a few words so we can help.").max(4000, "Please keep your message under 4000 characters."),
});

export type ContactFields = "name" | "email" | "phone" | "businessName" | "industry" | "message";

export interface ContactFormState {
  status: "idle" | "success" | "error";
  errors?: Partial<Record<ContactFields | "form", string>>;
  values?: Partial<Record<ContactFields, string>>;
}

const DUPLICATE_WINDOW_MS = 60_000;

/** Validates and stores a contact or done-for-you request. Returns the state the form renders. */
export async function submitContactRequest(formData: FormData): Promise<ContactFormState> {
  const raw = Object.fromEntries(
    ["kind", "name", "email", "phone", "businessName", "industry", "message"].map((k) => [k, String(formData.get(k) ?? "")]),
  );

  // Honeypot: real people never see or fill this field. Pretend it worked.
  if (String(formData.get("website") ?? "").trim() !== "") return { status: "success" };

  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: NonNullable<ContactFormState["errors"]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]) as ContactFields | "form";
      errors[key] ??= issue.message;
    }
    return { status: "error", errors, values: raw as ContactFormState["values"] };
  }

  const data = parsed.data;
  try {
    // Naive rate limit: the same person sending the same kind of request within a minute is ignored.
    const recent = await prisma.contactRequest.findFirst({
      where: { email: data.email, kind: data.kind, createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      select: { id: true },
    });
    if (!recent) await prisma.contactRequest.create({ data });
  } catch (error) {
    console.error("contact request failed", error);
    return {
      status: "error",
      errors: { form: "Something went wrong on our side. Please try again, or email hello@bupulse.com." },
      values: raw as ContactFormState["values"],
    };
  }
  return { status: "success" };
}
