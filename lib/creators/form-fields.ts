// The application form a company builds for its campaign (docs/CREATOR_CAMPAIGN_WIZARD.md, "Form"). Pure, so the
// builder, the public form /c/<slug>, the server check and the tests read the same rules.
//
// Owner decisions (22 October 2026): every form starts with First name, Last name, Email, Phone number and Social media
// accounts (the creator picks the networks they have, then types the username and followers of each). The company
// adds its own fields from ready-made ones (presets) or by type: text, choices, numbers and dates, uploads and links.
// Campaigns made before the wizard have no form: their `questions` become short text fields of the default form.

import { z } from "zod";
import type { CampaignQuestion } from "./company-forms";
import { formatDay } from "./describe";
import { LANGUAGES, NICHES } from "./requirements";

export const FIELD_TYPES = ["SHORT_TEXT", "LONG_TEXT", "SINGLE_CHOICE", "MULTI_CHOICE", "DROPDOWN", "YES_NO", "NUMBER", "MONEY_RANGE", "SCALE", "DATE", "DATE_RANGE", "UPLOAD", "LINK", "LOCATION"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  SHORT_TEXT: "Short answer",
  LONG_TEXT: "Paragraph",
  SINGLE_CHOICE: "One choice",
  MULTI_CHOICE: "Several choices",
  DROPDOWN: "Dropdown",
  YES_NO: "Yes or no",
  NUMBER: "Number",
  MONEY_RANGE: "Money range",
  SCALE: "Scale",
  DATE: "Date",
  DATE_RANGE: "Dates (from - to)",
  UPLOAD: "Upload a photo or video",
  LINK: "Link",
  LOCATION: "Place (search)",
};

/** The groups the builder's "Add a field" menu shows (the owner's four kinds). */
export const FIELD_GROUPS: { title: string; types: FieldType[] }[] = [
  { title: "Text", types: ["SHORT_TEXT", "LONG_TEXT"] },
  { title: "Choices", types: ["SINGLE_CHOICE", "MULTI_CHOICE", "DROPDOWN", "YES_NO"] },
  { title: "Numbers and dates", types: ["NUMBER", "MONEY_RANGE", "SCALE", "DATE", "DATE_RANGE"] },
  { title: "Uploads and links", types: ["UPLOAD", "LINK", "LOCATION"] },
];

const CHOICE_TYPES: readonly FieldType[] = ["SINGLE_CHOICE", "MULTI_CHOICE", "DROPDOWN"];
export const hasOptions = (type: FieldType) => CHOICE_TYPES.includes(type);

export const MAX_FIELDS = 20;
export const MAX_OPTIONS = 30;

export const fieldSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
    type: z.enum(FIELD_TYPES),
    label: z.string().trim().min(2, "Write each question in a few words.").max(200),
    help: z.string().trim().max(300).nullish(),
    placeholder: z.string().trim().max(120).nullish(),
    required: z.boolean(),
    /** The answers to pick from (choices and dropdown). */
    options: z.array(z.string().trim().min(1).max(100)).max(MAX_OPTIONS).optional(),
    /** NUMBER: the smallest and largest answer. SCALE: its ends (1-5, 1-10). MONEY_RANGE: the bounds. */
    min: z.number().int().min(0).max(1_000_000_000).nullish(),
    max: z.number().int().min(1).max(1_000_000_000).nullish(),
    /** MONEY_RANGE: the currency (the campaign's when left out). */
    currency: z.string().regex(/^[A-Z]{3}$/).nullish(),
    /** UPLOAD: what can be sent. */
    accept: z.enum(["IMAGE", "VIDEO", "ANY"]).nullish(),
    /** The preset it was added from (PRESET_FIELDS), so matching can read its answer: "location", "languages", "niches"... */
    preset: z.string().max(40).nullish(),
  })
  .superRefine((f, ctx) => {
    if (hasOptions(f.type) && (f.options?.length ?? 0) < 2) ctx.addIssue({ code: "custom", path: ["options"], message: `"${f.label}": give at least 2 answers to pick from.` });
    if (f.options && new Set(f.options.map((o) => o.toLowerCase())).size !== f.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: `"${f.label}": two answers are the same.` });
    if (f.min != null && f.max != null && f.min >= f.max) ctx.addIssue({ code: "custom", path: ["max"], message: `"${f.label}": the largest must be above the smallest.` });
    if (f.type === "SCALE" && (f.max == null || f.max > 10)) ctx.addIssue({ code: "custom", path: ["max"], message: `"${f.label}": a scale goes up to 10 at most.` });
  });
export type FormField = z.infer<typeof fieldSchema>;

/** How a built-in field shows: must be answered, may be skipped, or not asked. */
export const SHOW = ["REQUIRED", "OPTIONAL", "HIDDEN"] as const;
export type Show = (typeof SHOW)[number];

export const applicationFormSchema = z
  .object({
    /** A line at the top of the form, under the company's logo. */
    intro: z.string().trim().max(500).nullish(),
    /** First name, last name, email and social accounts are always asked (the invite goes to the email, views to the accounts). */
    phone: z.enum(SHOW),
    /** Links to their best posts (1-3). */
    samples: z.enum(SHOW),
    fields: z.array(fieldSchema).max(MAX_FIELDS, `Use at most ${MAX_FIELDS} extra fields.`),
  })
  .superRefine((form, ctx) => {
    if (new Set(form.fields.map((f) => f.id)).size !== form.fields.length) ctx.addIssue({ code: "custom", path: ["fields"], message: "Two fields have the same id." });
  });
export type ApplicationForm = z.infer<typeof applicationFormSchema>;

/** The built-in fields, in order, as the builder lists them (locked ones cannot be hidden). */
export const BUILT_IN_FIELDS = [
  { key: "firstName", label: "First name", locked: true },
  { key: "lastName", label: "Last name", locked: true },
  { key: "email", label: "Email", locked: true },
  { key: "phone", label: "Phone number (WhatsApp)", locked: false },
  { key: "socials", label: "Social media accounts: username and followers", locked: true },
  { key: "samples", label: "Links to their best posts", locked: false },
] as const;

/** The form every new campaign starts with. */
export function defaultForm(): ApplicationForm {
  return { intro: null, phone: "REQUIRED", samples: "OPTIONAL", fields: [] };
}

/** Ready-made fields the owner adds with one tap. `id` doubles as the field's preset key. */
export const PRESET_FIELDS: FormField[] = [
  { id: "location", preset: "location", type: "LOCATION", label: "Where do you live?", placeholder: "Search your district or city", required: true },
  { id: "languages", preset: "languages", type: "MULTI_CHOICE", label: "Which languages do you post in?", options: [...LANGUAGES], required: true },
  { id: "niches", preset: "niches", type: "MULTI_CHOICE", label: "What do you post about?", options: [...NICHES], required: true },
  { id: "adult", preset: "adult", type: "YES_NO", label: "Are you 18 or older?", required: true },
  { id: "momo", preset: "momo", type: "SHORT_TEXT", label: "Mobile Money number for your pay", placeholder: "078 123 4567", required: false },
  { id: "available", preset: "available", type: "DATE_RANGE", label: "When are you free to post?", required: false },
  { id: "expected_pay", preset: "expected_pay", type: "MONEY_RANGE", label: "What do you usually charge for a post?", min: 0, max: 1_000_000, required: false },
  { id: "camera", preset: "camera", type: "SCALE", label: "How comfortable are you on camera?", min: 1, max: 5, required: false },
  { id: "used_product", preset: "used_product", type: "YES_NO", label: "Have you used our products before?", required: false },
  { id: "why", preset: "why", type: "LONG_TEXT", label: "Why do you want to work with us?", placeholder: "A few lines", required: false },
  { id: "sample_video", preset: "sample_video", type: "UPLOAD", accept: "VIDEO", label: "Send a short video of you introducing yourself", required: false },
];

/** The form as stored, or the default form with the old `questions` as fields (campaigns made before the wizard). */
export function readApplicationForm(value: unknown, legacyQuestions: CampaignQuestion[] = []): ApplicationForm {
  const parsed = applicationFormSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Paragraphs: the old form took answers of up to 1,000 characters.
  return { ...defaultForm(), fields: legacyQuestions.map((q) => ({ id: q.id, type: "LONG_TEXT" as const, label: q.label, required: q.required })) };
}

/** A new field of a type, with a fresh id and starting options where it needs them. */
export function newField(type: FieldType, id: string): FormField {
  const base: FormField = { id, type, label: "", required: false };
  if (hasOptions(type)) return { ...base, options: ["", ""] };
  if (type === "SCALE") return { ...base, min: 1, max: 5 };
  if (type === "UPLOAD") return { ...base, accept: "ANY" };
  return base;
}

// ---- Answers ----

export type Answer = string | string[] | number | { min: number; max: number } | { from: string; to: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (v: string) => YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const wholeNumber = (v: string) => {
  const t = v.replace(/[,\s]/g, "");
  return /^\d+$/.test(t) ? Number(t) : null;
};
const isHttpLink = (v: string) => {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
};

/**
 * Reads one field's answer from the form's raw values (`values` holds every value sent under the field's name; ranges
 * send `<id>.min`/`<id>.max` or `<id>.from`/`<id>.to`, read by the caller into `range`). Empty and not required: null.
 * UPLOAD answers are the storage path the upload returned; the caller checks it belongs to this application.
 */
export function readAnswer(field: FormField, values: string[], range?: { a: string; b: string }): { ok: true; value: Answer | null } | { ok: false; error: string } {
  const one = (values[0] ?? "").trim();
  const empty = field.type === "MULTI_CHOICE" ? values.every((v) => !v.trim()) : field.type === "MONEY_RANGE" || field.type === "DATE_RANGE" ? !range || (!range.a.trim() && !range.b.trim()) : !one;
  if (empty) return field.required ? { ok: false, error: "Please answer this." } : { ok: true, value: null };

  switch (field.type) {
    case "SHORT_TEXT":
    case "LOCATION":
      return one.length > 200 ? { ok: false, error: "Keep it under 200 characters." } : { ok: true, value: one };
    case "LONG_TEXT":
      return one.length > 2000 ? { ok: false, error: "Keep it under 2,000 characters." } : { ok: true, value: one };
    case "SINGLE_CHOICE":
    case "DROPDOWN":
      return field.options?.includes(one) ? { ok: true, value: one } : { ok: false, error: "Pick one of the answers." };
    case "MULTI_CHOICE": {
      const picked = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
      return picked.every((p) => field.options?.includes(p)) ? { ok: true, value: picked } : { ok: false, error: "Pick from the answers." };
    }
    case "YES_NO":
      return one === "yes" || one === "no" ? { ok: true, value: one } : { ok: false, error: "Pick yes or no." };
    case "NUMBER":
    case "SCALE": {
      const n = wholeNumber(one);
      const min = field.min ?? (field.type === "SCALE" ? 1 : 0);
      const max = field.max ?? (field.type === "SCALE" ? 5 : 1_000_000_000);
      if (n === null || n < min || n > max) return { ok: false, error: field.type === "SCALE" ? `Pick from ${min} to ${max}.` : `Type a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.` };
      return { ok: true, value: n };
    }
    case "MONEY_RANGE": {
      const lo = wholeNumber(range!.a);
      const hi = wholeNumber(range!.b);
      if (lo === null || hi === null) return { ok: false, error: "Type both amounts as whole numbers." };
      if (lo > hi) return { ok: false, error: "The first amount must be the smaller one." };
      if (field.max != null && hi > field.max) return { ok: false, error: `At most ${field.max.toLocaleString("en-US")}.` };
      return { ok: true, value: { min: lo, max: hi } };
    }
    case "DATE":
      return realDay(one) ? { ok: true, value: one } : { ok: false, error: "Pick a date." };
    case "DATE_RANGE": {
      const from = range!.a.trim();
      const to = range!.b.trim();
      if (!realDay(from) || !realDay(to)) return { ok: false, error: "Pick both dates." };
      return from > to ? { ok: false, error: "The first date must come first." } : { ok: true, value: { from, to } };
    }
    case "LINK":
      return isHttpLink(one) && one.length <= 500 ? { ok: true, value: one } : { ok: false, error: "Paste a full link, starting with https://" };
    case "UPLOAD":
      return one.length <= 300 ? { ok: true, value: one } : { ok: false, error: "Upload the file again." };
  }
}

/** An answer in words for the company's applicant list (uploads show as their own link, so "File sent"). */
export function answerInWords(field: FormField, value: Answer | null | undefined, currency = "RWF"): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return field.type === "SCALE" ? `${value} out of ${field.max ?? 5}` : value.toLocaleString("en-US");
  if (typeof value === "object") {
    if ("min" in value) return `${value.min.toLocaleString("en-US")} - ${value.max.toLocaleString("en-US")} ${field.currency ?? currency}`;
    return `${formatDay(value.from)} to ${formatDay(value.to)}`;
  }
  if (field.type === "YES_NO") return value === "yes" ? "Yes" : "No";
  if (field.type === "DATE") return formatDay(value);
  if (field.type === "UPLOAD") return "File sent";
  return value;
}
