import { z } from "zod";
import { CONTACT_TYPES, MAX_CONTACTS, isNormalised, normaliseContact, type Contact, type ContactType } from "@/lib/business-info/contacts";
import { DAYS, LAST_MINUTE, MAX_SCHEDULES, fromMinutes, scheduleErrors, sortDays, type Schedule } from "@/lib/business-info/hours";
import { LOCATION_LIMITS, MAX_BRANCHES, PLACE_ID, manualAddressText, mapsUrl, type Building, type Location, type LocationKind, type ManualAddress } from "@/lib/business-info/locations";
import { phoneCountry } from "@/lib/phone";
import { voices, type VoiceId } from "./voices";

// Brand profile, used by /onboarding (one schema per step) and the Brand page.

const optionalText = (max: number, tooLong = `Use ${max} characters or fewer.`) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((v) => v || undefined);

/** Step 1: what you sell and who to. */
export const offerSchema = z.object({
  description: z
    .string()
    .trim()
    .min(10, "Tell us a little more about what you sell (at least 10 characters).")
    .max(500, "Use 500 characters or fewer."),
  audience: z
    .string()
    .trim()
    .min(3, "Tell us who your customers are.")
    .max(300, "Use 300 characters or fewer."),
});

/** Step 2: brand voice preset. */
export const voiceSchema = z.object({
  tone: z
    .string()
    .refine((v): v is VoiceId => voices.some((voice) => voice.id === v), "Choose a brand voice."),
});

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a colour like #2F6BFF.").transform((v) => v.toUpperCase());

/** Step 3: logo and colours. Both may be added later. */
export const lookSchema = z.object({
  logoPath: z.string().max(300).optional(),
  brandColors: z.array(hexColor).max(3, "Choose up to 3 colours."),
});

export const faqSchema = z.object({
  question: z.string().trim().min(1, "Write the question.").max(200, "Use 200 characters or fewer."),
  answer: z.string().trim().min(1, "Write the answer.").max(600, "Use 600 characters or fewer."),
});

const timeText = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time.");

/** One set of opening hours (lib/business-info/hours.ts). */
export const scheduleSchema = z.object({
  days: z.array(z.enum(DAYS)).max(7),
  open: timeText,
  close: timeText,
  allDay: z.boolean().optional(),
  overnight: z.boolean().optional(),
});

/** The head office or a branch (lib/business-info/locations.ts). */
export const locationSchema = z.object({
  kind: z.enum(["head", "branch"]),
  label: z.string().trim().max(80).optional(),
  address: z.string().trim().min(1).max(300),
  placeId: z.string().regex(PLACE_ID).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  building: z
    .object({
      name: z.string().trim().min(1).max(LOCATION_LIMITS.buildingName),
      floor: z.string().trim().max(LOCATION_LIMITS.floor).optional(),
      block: z.string().trim().max(LOCATION_LIMITS.block).optional(),
      unit: z.string().trim().max(LOCATION_LIMITS.unit).optional(),
    })
    .optional(),
  manual: z
    .object({
      street: z.string().trim().max(LOCATION_LIMITS.street).optional(),
      area: z.string().trim().max(LOCATION_LIMITS.area).optional(),
      city: z.string().trim().max(LOCATION_LIMITS.city).optional(),
    })
    .optional(),
  mapsUrl: z.string().max(800).optional(),
});

/** A stored, normalised contact (lib/business-info/contacts.ts). */
export const contactSchema = z.object({
  type: z.enum(CONTACT_TYPES),
  value: z.string().trim().min(1).max(300),
  primary: z.boolean().optional(),
});

/**
 * Step 4: what the chat widget may answer from. Everything optional. `hours` and `contact` are the free text of
 * the first version: kept as notes ("closed on public holidays") next to the structured openingHours and contacts.
 */
export const knowledgeSchema = z.object({
  hours: optionalText(200),
  area: optionalText(200),
  contact: optionalText(200),
  faqs: z.array(faqSchema).max(10, "Add up to 10 questions."),
  openingHours: z.array(scheduleSchema).max(MAX_SCHEDULES).optional(),
  locations: z.array(locationSchema).max(MAX_BRANCHES + 1).optional(),
  contacts: z.array(contactSchema).max(MAX_CONTACTS).optional(),
});

export type Offer = z.infer<typeof offerSchema>;
export type Look = z.infer<typeof lookSchema>;
export type Knowledge = z.infer<typeof knowledgeSchema>;
/** Knowledge as read from the database: the lists are always there (empty when not set). */
export type StoredKnowledge = Knowledge & { openingHours: Schedule[]; locations: Location[]; contacts: Contact[] };

/** Keeps the items of a stored list that are still valid, so one bad item never hides the rest. */
function validItems<T>(item: z.ZodType<T>, max: number, keep: (v: T) => boolean = () => true) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) => items.flatMap((i) => {
      const r = item.safeParse(i);
      return r.success && keep(r.data) ? [r.data] : [];
    }).slice(0, max))
    .optional()
    .transform((v) => v ?? []);
}

/** Reads Business.knowledge safely (it is stored as JSON). */
// Empty fields are dropped when saved, so stored knowledge may lack any of them; a broken field is read as missing.
const storedKnowledgeSchema = z.object({
  hours: optionalText(200).optional().catch(undefined),
  area: optionalText(200).optional().catch(undefined),
  contact: optionalText(200).optional().catch(undefined),
  faqs: validItems(faqSchema, 10),
  openingHours: validItems(scheduleSchema, MAX_SCHEDULES),
  locations: validItems(locationSchema, MAX_BRANCHES + 1),
  contacts: validItems(contactSchema, MAX_CONTACTS, (c) => isNormalised(c as Contact)),
});

export function readKnowledge(value: unknown): StoredKnowledge {
  const parsed = storedKnowledgeSchema.safeParse(value && typeof value === "object" ? value : {});
  if (!parsed.success) return { hours: undefined, area: undefined, contact: undefined, faqs: [], openingHours: [], locations: [], contacts: [] };
  const { hours, area, contact, faqs, openingHours, locations, contacts } = parsed.data;
  return {
    hours,
    area,
    contact,
    faqs,
    openingHours: Object.keys(scheduleErrors(openingHours)).length ? [] : openingHours,
    // The map link is rebuilt from the address, so a stored value can never point elsewhere.
    locations: locations.map((l) => ({ ...l, mapsUrl: mapsUrl(l) })),
    contacts,
  };
}

// No SVG: an SVG can carry scripts, and logos may later be shown inline (widget, designs, emails).
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_COLORS = 3;
export const MAX_ONBOARDING_FAQS = 3;

/** Like fieldErrors, but keeps nested paths ("faqs.0.question") so list rows can show their own errors. */
export function flatErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Drops question/answer pairs that are completely blank, so an empty row is not an error. */
export function prepareFaqs<T extends { question: string; answer: string }>(faqs: T[]): T[] {
  return faqs.filter((f) => f.question.trim() || f.answer.trim());
}

/** Whether a stored logo path belongs to this user's logo folder in the brand bucket. */
export function isOwnLogoPath(userId: string, path: string): boolean {
  return path.startsWith(`${userId}/logo/`) && !path.includes("..");
}

/** What the step 4 form sends. Contacts carry the phone country the person chose (a sign-up country name). */
export type KnowledgeInput = {
  hours?: string;
  area?: string;
  contact?: string;
  faqs?: { question: string; answer: string }[];
  openingHours?: Schedule[];
  /** `manual`: typed as street / area / city instead of searched. `inBuilding`: the building fields count. */
  locations?: {
    kind: LocationKind;
    label?: string;
    address: string;
    placeId?: string;
    lat?: number;
    lng?: number;
    inBuilding?: boolean;
    building?: { name?: string; floor?: string; block?: string; unit?: string };
    manual?: boolean;
    street?: string;
    area?: string;
    city?: string;
  }[];
  contacts?: { type: ContactType; value: string; country?: string | null; primary?: boolean }[];
};

// The shape of what the form sends, checked before anything else so a crafted request (a number where text belongs,
// an object for a list) gets a validation error instead of crashing the action. Limits are generous: the real ones
// are checked below with messages for the person.
const text = z.string().max(5000);
const knowledgeInputSchema = z.object({
  hours: text.optional(),
  area: text.optional(),
  contact: text.optional(),
  faqs: z.array(z.object({ question: text, answer: text })).max(50).optional(),
  openingHours: z
    .array(z.object({ days: z.array(z.enum(DAYS)).max(7), open: z.string().max(10), close: z.string().max(10), allDay: z.boolean().optional(), overnight: z.boolean().optional() }))
    .max(20)
    .optional(),
  locations: z
    .array(
      z.object({
        kind: z.enum(["head", "branch"]),
        label: text.optional(),
        address: text,
        placeId: z.string().max(400).optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        inBuilding: z.boolean().optional(),
        building: z.object({ name: text.optional(), floor: text.optional(), block: text.optional(), unit: text.optional() }).optional(),
        manual: z.boolean().optional(),
        street: text.optional(),
        area: text.optional(),
        city: text.optional(),
      }),
    )
    .max(30)
    .optional(),
  contacts: z
    .array(z.object({ type: z.string().max(40), value: text, country: z.string().max(100).nullable().optional(), primary: z.boolean().optional() }))
    .max(30)
    .optional(),
});

const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

/**
 * Validates step 4. Completely blank FAQ, contact and branch rows are ignored, and errors keep the row's position
 * in the form ("faqs.1.answer", "contacts.2.value") so they show under the right inputs. The same function runs in
 * the browser and in the server action. `country` is the business's sign-up country, the default for phone numbers.
 */
export function validateKnowledge(raw: KnowledgeInput, opts: { country?: string | null } = {}): { ok: true; data: Knowledge } | { ok: false; errors: Record<string, string> } {
  const shaped = knowledgeInputSchema.safeParse(raw);
  if (!shaped.success) return { ok: false, errors: { form: "Some details could not be read. Please check the form and try again." } };
  const input = shaped.data as KnowledgeInput;
  const errors: Record<string, string> = {};
  const add = (key: string, message: string) => {
    if (!(key in errors)) errors[key] = message;
  };

  const rows = (input.faqs ?? []).map((faq, index) => ({ faq, index })).filter(({ faq }) => faq.question.trim() || faq.answer.trim());
  const parsed = knowledgeSchema.safeParse({
    hours: input.hours ?? "",
    area: input.area ?? "",
    contact: input.contact ?? "",
    faqs: rows.map((r) => r.faq),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = [...issue.path];
      if (path[0] === "faqs" && typeof path[1] === "number") path[1] = rows[path[1]]?.index ?? path[1];
      add(path.length ? path.join(".") : "form", issue.message);
    }
  }

  // Opening hours: every set the person added counts (an empty one is an error, not ignored).
  const schedules = input.openingHours ?? [];
  const shape = z.array(scheduleSchema).safeParse(schedules);
  if (!shape.success) add("openingHours.form", "Check the opening hours.");
  for (const [key, message] of Object.entries(scheduleErrors(schedules))) add(`openingHours.${key}`, message);
  const openingHours: Schedule[] = schedules.map((s) => ({
    days: sortDays(s.days),
    open: s.allDay ? "00:00" : s.open,
    close: s.allDay ? fromMinutes(LAST_MINUTE) : s.close,
    ...(s.allDay ? { allDay: true } : {}),
    ...(!s.allDay && s.overnight ? { overnight: true } : {}),
  }));

  // Locations: the head office first; branches only once it is filled. A hand-entered address is its street, area
  // and city joined, without a place id or coordinates.
  const one = (v: string | undefined) => v?.replace(/\s+/g, " ").trim() || undefined;
  const places = (input.locations ?? []).map((l, index) => {
    const manual: ManualAddress | undefined = l.manual ? { street: one(l.street), area: one(l.area), city: one(l.city) } : undefined;
    const address = manual ? manualAddressText(manual) : (one(l.address) ?? "");
    const buildingName = l.inBuilding ? one(l.building?.name) : undefined;
    return { l, index, manual, address, buildingName, filled: !!(address || buildingName) };
  });
  const filled = places.filter((p) => p.filled);
  const head = places.find(({ l }) => l.kind === "head");
  if (filled.some(({ l }) => l.kind === "branch") && !head?.filled) add(`locations.${head?.index ?? 0}.${head?.manual ? "street" : "address"}`, "Add the head office address first, or remove the branches.");
  if (filled.filter(({ l }) => l.kind === "branch").length > MAX_BRANCHES) add("locations.form", `Add up to ${MAX_BRANCHES} branches.`);
  const locations: Location[] = [];
  for (const { l, index, manual, address, buildingName } of [...filled].sort((a, b) => Number(a.l.kind === "branch") - Number(b.l.kind === "branch"))) {
    const at = (field: string) => `locations.${index}.${field}`;
    const label = l.label?.trim() || undefined;
    const tooLong = (value: string | undefined, max: number, field: string) => {
      if (value && value.length > max) add(at(field), `Use ${max} characters or fewer.`);
    };
    if (!address) add(at(manual ? "street" : "address"), manual ? "Add the street, the area or the city." : "Add the address, or enter it yourself.");
    tooLong(address, 300, manual ? "street" : "address");
    tooLong(label, 80, "label");
    if (manual) {
      tooLong(manual.street, LOCATION_LIMITS.street, "street");
      tooLong(manual.area, LOCATION_LIMITS.area, "area");
      tooLong(manual.city, LOCATION_LIMITS.city, "city");
    }
    let building: Building | undefined;
    if (l.inBuilding) {
      const floor = one(l.building?.floor);
      const block = one(l.building?.block);
      const unit = one(l.building?.unit);
      if (!buildingName) add(at("buildingName"), "Add the building or mall name, or untick “Inside a building or mall”.");
      tooLong(buildingName, LOCATION_LIMITS.buildingName, "buildingName");
      tooLong(floor, LOCATION_LIMITS.floor, "floor");
      tooLong(block, LOCATION_LIMITS.block, "block");
      tooLong(unit, LOCATION_LIMITS.unit, "unit");
      if (buildingName) building = { name: buildingName, ...(floor ? { floor } : {}), ...(block ? { block } : {}), ...(unit ? { unit } : {}) };
    }
    const placeId = !manual && l.placeId && PLACE_ID.test(l.placeId) ? l.placeId : undefined;
    const lat = placeId ? num(l.lat, -90, 90) : undefined;
    const lng = placeId ? num(l.lng, -180, 180) : undefined;
    const manualParts = manual && Object.fromEntries(Object.entries(manual).filter(([, v]) => v));
    const loc: Location = {
      kind: l.kind === "head" ? "head" : "branch",
      address,
      ...(label ? { label } : {}),
      ...(placeId ? { placeId } : {}),
      ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
      ...(building ? { building } : {}),
      ...(manualParts ? { manual: manualParts } : {}),
    };
    locations.push({ ...loc, mapsUrl: mapsUrl(loc) });
  }

  // Contacts: blank rows are ignored; one is the main contact (the first, when none is marked).
  const people = (input.contacts ?? []).map((c, index) => ({ c, index })).filter(({ c }) => c.value.trim());
  if (people.length > MAX_CONTACTS) add("contacts.form", `Add up to ${MAX_CONTACTS} contacts.`);
  const contacts: Contact[] = [];
  for (const { c, index } of people) {
    if (!(CONTACT_TYPES as readonly string[]).includes(c.type)) {
      add(`contacts.${index}.type`, "Choose a contact type.");
      continue;
    }
    const countryName = c.country || opts.country || null;
    const result = normaliseContact(c.type, c.value, phoneCountry(countryName), countryName);
    if (!result.ok) add(`contacts.${index}.value`, result.error);
    else contacts.push({ type: c.type, value: result.value, ...(c.primary ? { primary: true } : {}) });
  }
  const main = Math.max(0, contacts.findIndex((c) => c.primary));
  contacts.forEach((c, i) => {
    if (i === main) c.primary = true;
    else delete c.primary;
  });

  if (Object.keys(errors).length || !parsed.success) return { ok: false, errors };
  return {
    ok: true,
    data: {
      ...parsed.data,
      ...(openingHours.length ? { openingHours } : {}),
      ...(locations.length ? { locations } : {}),
      ...(contacts.length ? { contacts } : {}),
    },
  };
}
