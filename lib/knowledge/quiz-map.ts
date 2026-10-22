// The Business info quiz's answers, and how each round's answers become the input of the same server action the full
// form uses (docs/QUIZ_MODE.md, "A. Business info quiz"). Pure: the quiz screen and the tests share it.
//
// Merge, never wipe: every function starts from what is stored and changes only what the owner answered. A skipped
// question (`given(id)` false), an empty text or an empty list keeps the stored value. Records that already exist
// (products, competitors, FAQs by their name or question) are never created twice.

import type { BrandValues, LocationValue } from "@/components/brand-profile/steps";
import type { KnowledgeInput } from "@/lib/brand/schemas";
import { isPhoneType } from "@/lib/business-info/contacts";
import { DAYS, type DayKey, type Schedule } from "@/lib/business-info/hours";
import { INDUSTRY_DESCRIPTION_MAX, INDUSTRY_DESCRIPTION_MIN } from "@/lib/industries/shared";
import { AGE_RANGES, type AgeRange, type Gender, type IncomeBand, type PersonaFormValues, type PersonaInput } from "./audience";
import type { PositioningInput } from "./competitors";
import type { VoiceSummary } from "./interview";
import { SUMMARY_LIMITS } from "./interview";
import type { Policies, PaymentMethod } from "./policies";
import { productInputSchema, type ProductInput, type ProductKindValue } from "./products";
import type { CompanySize, ProfileFormValues, ProfileInput } from "./profile";
import { POLICY_CHOICES, sameKey, type PersonaIdea, type PolicyKind, type ProductIdea, type QuizDraft, type VoiceOption } from "./quiz-draft";
import type { ReviewInput, ReviewSourceValue } from "./reviews";
import type { SectionKey } from "./sections";
import type { QuizRound, QuizStep } from "@/lib/quiz/flow";

/** True when the owner answered the question (it was not skipped). */
export type Given = (stepId: string) => boolean;

export const QUIZ_ROUND_IDS = ["you", "sell", "customers", "why", "rules", "find", "voice", "love"] as const;
export type QuizRoundId = (typeof QUIZ_ROUND_IDS)[number];

export function isQuizRound(value: unknown): value is QuizRoundId {
  return typeof value === "string" && (QUIZ_ROUND_IDS as readonly string[]).includes(value);
}

/** The rounds, in order. `section` is the Business info section the round fills (its full form and its %). */
export const QUIZ_ROUNDS: readonly (QuizRound & { id: QuizRoundId; section: SectionKey; href: string })[] = [
  { id: "you", title: "You", emoji: "🏠", blurb: "Who you are", section: "profile", href: "/dashboard/knowledge/profile" },
  { id: "sell", title: "What you sell", emoji: "🛍️", blurb: "Your products and services", section: "products", href: "/dashboard/knowledge/products" },
  { id: "customers", title: "Your customers", emoji: "👥", blurb: "Who buys from you", section: "audience", href: "/dashboard/knowledge/audience" },
  { id: "why", title: "Why you", emoji: "⭐", blurb: "Why people choose you", section: "competitors", href: "/dashboard/knowledge/competitors" },
  { id: "rules", title: "Rules", emoji: "📋", blurb: "Payment, delivery and questions", section: "faqs", href: "/dashboard/knowledge/faqs" },
  { id: "find", title: "Find us", emoji: "📍", blurb: "Hours, phone and address", section: "locations", href: "/dashboard/knowledge/locations" },
  { id: "voice", title: "Your voice", emoji: "🎙️", blurb: "How your posts sound", section: "interview", href: "/dashboard/knowledge/interview" },
  { id: "love", title: "Love notes", emoji: "💬", blurb: "What customers say", section: "reviews", href: "/dashboard/knowledge/reviews" },
];

export const quizRound = (id: QuizRoundId) => QUIZ_ROUNDS.find((r) => r.id === id)!;

export type HoursChoice = "weekdays" | "monSat" | "everyday" | "always" | "keep" | "custom";
/** A new product's answers. No price typed means "Ask for price" (`onRequest`), never a guessed price. */
export type ProductAnswer = { kind: ProductKindValue; price: string; onRequest: boolean; reason: string };

export type QuizAnswers = {
  you: { tagline: string; about: string; size: CompanySize | ""; yearFounded: string; languages: string[]; values: string[]; mission: string };
  sell: { picked: string[]; details: Record<string, ProductAnswer> };
  customers: { picked: string[]; ageRange: AgeRange | ""; gender: Gender | ""; channels: string[]; needs: string[]; pains: string[]; triggers: string[] };
  why: { competitors: string[]; differentiators: string[]; statement: string };
  rules: { payment: PaymentMethod[]; delivery: PolicyAnswer; returns: PolicyAnswer; booking: PolicyAnswer; faqs: { id: string; question: string; answer: string }[]; faqKept: string[] };
  find: { hours: HoursChoice | ""; custom: Schedule; phone: string; address: string };
  voice: { tone: "friendly" | "formal" | ""; emojis: "yes" | "no" | ""; length: "short" | "detailed" | ""; pick: string };
  love: { quote: string; customerName: string; source: ReviewSourceValue | ""; canPublish: boolean };
};

const kept = (given: boolean, answer: string, stored: string) => (given && answer.trim() ? answer.trim() : stored);
const keptList = <T>(given: boolean, answer: T[], stored: T[]) => (given && answer.length ? answer : stored);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The key a product, competitor or FAQ is matched on ("Juice " and "juice" are the same). */
export const itemKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

// ---- 🏠 You -> saveProfile ----------------------------------------------------------------------------------------

/**
 * The full profile input: everything stored, with the quiz's answers on top. A sign-up description that is too short
 * for the profile's check is filled from "what you do", so the save never fails on a field the quiz does not ask.
 */
export function profileInputFrom(stored: ProfileFormValues, a: QuizAnswers["you"], given: Given): ProfileInput {
  const about = kept(given("you.about"), a.about, stored.about);
  const description = stored.industryDescription.trim();
  return {
    ...stored,
    tagline: kept(given("you.tagline"), a.tagline, stored.tagline),
    about,
    industryDescription: description.length >= INDUSTRY_DESCRIPTION_MIN || about.trim().length < INDUSTRY_DESCRIPTION_MIN ? stored.industryDescription : about.trim().slice(0, INDUSTRY_DESCRIPTION_MAX),
    size: given("you.size") && a.size ? a.size : (stored.size as CompanySize | ""),
    yearFounded: kept(given("you.year"), a.yearFounded, stored.yearFounded),
    languages: keptList(given("you.languages"), a.languages, stored.languages),
    values: keptList(given("you.values"), a.values, stored.values),
    mission: kept(given("you.mission"), a.mission, stored.mission),
  };
}

// ---- 🛍️ What you sell -> createProduct -----------------------------------------------------------------------------

export const productStepId = (name: string) => `sell.item.${itemKey(name)}`;

/** The picked products that are not stored yet: each gets a detail question. */
export function newProductNames(storedNames: readonly string[], picked: readonly string[]): string[] {
  const have = new Set(storedNames.map(itemKey));
  const out: string[] = [];
  for (const name of picked) {
    const key = itemKey(name);
    if (!key || have.has(key)) continue;
    have.add(key);
    out.push(name.trim());
  }
  return out;
}

/**
 * One createProduct input per new product whose question was answered. They are saved as drafts: the quiz takes no
 * photos, and a product without one is not ready for posts yet (the Products page says what is missing).
 */
export function productInputsFrom(
  storedNames: readonly string[],
  a: QuizAnswers["sell"],
  ideas: readonly ProductIdea[],
  currency: string,
  given: Given,
): { name: string; input: ProductInput }[] {
  if (!given("sell.pick")) return [];
  return newProductNames(storedNames, a.picked).flatMap((name) => {
    if (!given(productStepId(name))) return [];
    const d = a.details[itemKey(name)];
    if (!d) return [];
    const idea = ideas.find((i) => same(i.name, name));
    const reason = d.reason.trim();
    const onRequest = d.onRequest || !d.price.trim();
    const input: ProductInput = {
      kind: d.kind,
      name,
      summary: idea?.summary || reason || name,
      priceModel: onRequest ? "ON_REQUEST" : "FIXED",
      price: onRequest ? "" : d.price.trim(),
      currency,
      usps: reason ? [reason] : [],
      features: [],
      status: "DRAFT",
    };
    return [{ name, input }];
  });
}

// ---- 👥 Your customers -> createPersona / updatePersona ----------------------------------------------------------

export type StoredPersona = PersonaFormValues & { id: string };
export const storedPersonaKey = (id: string) => `id:${id}`;
export const ideaPersonaKey = (i: number) => `idea:${i}`;

function personaInput(v: PersonaFormValues): PersonaInput {
  return { ...v, ageRange: v.ageRange as AgeRange, gender: v.gender as Gender | "", incomeBand: v.incomeBand as IncomeBand | "" };
}

/**
 * The personas to save. The questions after the cards describe the first card picked (the main customer); a second
 * new card is saved as BuPulse guessed it; a stored persona that is not the main one is left alone. Nothing is
 * deleted.
 */
export function personaSavesFrom(stored: readonly StoredPersona[], ideas: readonly PersonaIdea[], a: QuizAnswers["customers"], given: Given): { id?: string; input: PersonaInput }[] {
  const picked = given("customers.pick") ? a.picked : stored[0] ? [storedPersonaKey(stored[0].id)] : [];
  const out: { id?: string; input: PersonaInput }[] = [];
  picked.forEach((key, i) => {
    const main = i === 0;
    const own = stored.find((p) => storedPersonaKey(p.id) === key);
    const idea = ideas[Number(key.replace(/^idea:/, ""))];
    if (!own && !(key.startsWith("idea:") && idea)) return;
    if (own && !main) return;
    const base: PersonaFormValues = own ?? {
      name: idea!.name,
      ageRange: idea!.ageRange,
      gender: idea!.gender,
      location: idea!.location,
      occupation: idea!.occupation,
      incomeBand: "",
      needs: idea!.needs,
      pains: idea!.pains,
      objections: [],
      channels: idea!.channels,
      triggers: idea!.triggers,
      language: "",
    };
    const values: PersonaFormValues = main
      ? {
          ...base,
          ageRange: given("customers.age") && a.ageRange ? a.ageRange : base.ageRange,
          gender: given("customers.gender") && a.gender ? a.gender : base.gender,
          channels: keptList(given("customers.online"), a.channels, base.channels),
          needs: keptList(given("customers.needs"), a.needs, base.needs),
          pains: keptList(given("customers.pains"), a.pains, base.pains),
          triggers: keptList(given("customers.triggers"), a.triggers, base.triggers),
        }
      : base;
    out.push(own ? { id: own.id, input: personaInput(values) } : { input: personaInput(values) });
  });
  return out;
}

// ---- ⭐ Why you -> createCompetitor, savePositioning ---------------------------------------------------------------

export function newCompetitorNames(storedNames: readonly string[], a: QuizAnswers["why"], given: Given): string[] {
  return given("why.competitors") ? newProductNames(storedNames, a.competitors) : [];
}

export function positioningFrom(stored: { differentiators: string[]; statement: string | null }, a: QuizAnswers["why"], given: Given): PositioningInput | null {
  const differentiators = keptList(given("why.differentiators"), a.differentiators, stored.differentiators);
  const statement = kept(given("why.statement"), a.statement, stored.statement ?? "");
  const changed = differentiators.join("\n") !== stored.differentiators.join("\n") || statement !== (stored.statement ?? "");
  return changed ? { differentiators, statement } : null;
}

// ---- 📋 Rules -> savePolicies, createFaq --------------------------------------------------------------------------

/** A policy question's answer: a common answer's tile (`choice`), "other" with the owner's words, or "" (none yet). */
export type PolicyAnswer = { choice: string; text: string };
/** Where the business is, for "We deliver in Kigali" (the area served, else nothing) and "across Rwanda". */
export type Places = { city: string; country: string };

const CHOICE_TEXT: Record<PolicyKind, Record<string, (p: Places) => { label: string; sentence: string; emoji: string }>> = {
  delivery: {
    pickup: () => ({ label: "No delivery, pick-up only", sentence: "We do not deliver: pick-up only, at our place.", emoji: "🏪" }),
    city: (p) => ({ label: `We deliver in ${p.city || "town"}`, sentence: `We deliver in ${p.city || "town"}. Message us with your address.`, emoji: "🛵" }),
    country: (p) => ({ label: `We deliver across ${p.country || "the country"}`, sentence: `We deliver across ${p.country || "the country"}. Message us with your address.`, emoji: "🚚" }),
    app: () => ({ label: "Through a delivery app", sentence: "We deliver through delivery apps.", emoji: "📱" }),
  },
  returns: {
    noFood: () => ({ label: "No returns on food and drinks", sentence: "We do not take returns on food and drinks.", emoji: "🍽️" }),
    exchange: () => ({ label: "Exchange within 7 days with the receipt", sentence: "Items can be exchanged within 7 days with the receipt.", emoji: "🔁" }),
    refund: () => ({ label: "Refund within 7 days", sentence: "Items can be refunded within 7 days with the receipt.", emoji: "💸" }),
  },
  booking: {
    walkIn: () => ({ label: "No booking, just walk in", sentence: "No booking needed: just walk in.", emoji: "🚶" }),
    whatsapp: () => ({ label: "Book by WhatsApp or a call", sentence: "Book by WhatsApp or a call.", emoji: "💬" }),
    online: () => ({ label: "Book online", sentence: "Book online.", emoji: "🌐" }),
  },
};

/** The tiles of a policy question, in order, then "Something else". */
export function policyOptions(kind: PolicyKind, places: Places): { value: string; label: string; emoji: string; sentence: string }[] {
  return [...POLICY_CHOICES[kind].map((c) => ({ value: c as string, ...CHOICE_TEXT[kind][c](places) })), { value: "other", label: "Something else", emoji: "✏️", sentence: "" }];
}

/** The policy text a tile stands for ("" for none; the owner's words for "Something else"). */
export function policyText(kind: PolicyKind, a: PolicyAnswer, places: Places): string {
  if (a.choice === "other") return a.text.trim();
  return CHOICE_TEXT[kind][a.choice]?.(places).sentence ?? "";
}

/** A stored policy as the question shows it: its tile when it is one of the sentences, else "Something else" with it. */
export function policyAnswerOf(kind: PolicyKind, stored: string | null | undefined, places: Places): PolicyAnswer {
  const text = stored?.trim() ?? "";
  if (!text) return { choice: "", text: "" };
  const tile = policyOptions(kind, places).find((o) => o.sentence && sameKey(o.sentence) === sameKey(text));
  return tile ? { choice: tile.value, text: "" } : { choice: "other", text };
}

export function policiesFrom(stored: Policies, a: QuizAnswers["rules"], given: Given, places: Places): Policies | null {
  const next: Policies = {
    ...stored,
    paymentMethods: keptList(given("rules.payment"), a.payment, stored.paymentMethods),
    delivery: kept(given("rules.delivery"), policyText("delivery", a.delivery, places), stored.delivery ?? "") || null,
    returns: kept(given("rules.returns"), policyText("returns", a.returns, places), stored.returns ?? "") || null,
    booking: kept(given("rules.booking"), policyText("booking", a.booking, places), stored.booking ?? "") || null,
  };
  const changed = next.paymentMethods.join() !== stored.paymentMethods.join() || next.delivery !== stored.delivery || next.returns !== stored.returns || next.booking !== stored.booking;
  return changed ? next : null;
}

export function newFaqsFrom(storedQuestions: readonly string[], a: QuizAnswers["rules"], given: Given): { question: string; answer: string }[] {
  if (!given("rules.faqs")) return [];
  const have = new Set(storedQuestions.map(itemKey));
  return a.faqs.flatMap((f) => {
    const key = itemKey(f.question);
    if (!a.faqKept.includes(f.id) || !key || have.has(key)) return [];
    have.add(key);
    return [{ question: f.question.trim(), answer: f.answer.trim() }];
  });
}

// ---- 📍 Find us -> saveKnowledge (the Locations page's save) ------------------------------------------------------

const WEEK: DayKey[] = [...DAYS];
export const HOURS_PRESETS: Record<Exclude<HoursChoice, "keep" | "custom">, Schedule[]> = {
  weekdays: [{ days: ["mon", "tue", "wed", "thu", "fri"], open: "08:00", close: "18:00" }],
  monSat: [{ days: ["mon", "tue", "wed", "thu", "fri", "sat"], open: "08:00", close: "20:00" }],
  everyday: [{ days: WEEK, open: "08:00", close: "20:00" }],
  always: [{ days: WEEK, open: "00:00", close: "23:59", allDay: true }],
};

const scheduleKey = (list: readonly Schedule[]) => JSON.stringify(list.map((s) => (s.allDay ? { days: s.days, allDay: true } : { days: s.days, open: s.open, close: s.close, overnight: !!s.overnight })));

/** The preset the stored hours are, "keep" for other stored hours, "" for none. */
export function hoursChoiceOf(stored: readonly Schedule[]): HoursChoice | "" {
  if (!stored.length) return "";
  const key = scheduleKey(stored);
  const preset = (Object.keys(HOURS_PRESETS) as (keyof typeof HOURS_PRESETS)[]).find((p) => scheduleKey(HOURS_PRESETS[p]) === key);
  return preset ?? "keep";
}

/** The head office address as the quiz shows it. */
export function headAddress(locations: readonly LocationValue[]): string {
  const head = locations.find((l) => l.kind === "head");
  if (!head) return "";
  return head.manual ? [head.street, head.area, head.city].map((s) => s.trim()).filter(Boolean).join(", ") : head.address;
}

/** The first phone or WhatsApp number as the quiz shows it. */
export function mainPhone(contacts: BrandValues["contacts"]): string {
  return contacts.find((c) => isPhoneType(c.type) && c.value.trim())?.value ?? "";
}

/**
 * The whole business info card (every stored field: the save replaces the card) with the quiz's hours, phone and
 * address on top. Null when none of them changed, so a skipped round saves nothing.
 */
export function knowledgeInputFrom(stored: BrandValues, a: QuizAnswers["find"], given: Given, country: string): KnowledgeInput | null {
  let openingHours = stored.openingHours;
  if (given("find.hours") && a.hours && a.hours !== "keep") openingHours = a.hours === "custom" ? [a.custom] : HOURS_PRESETS[a.hours];
  const hoursChanged = scheduleKey(openingHours) !== scheduleKey(stored.openingHours);

  const contacts = stored.contacts.map((c) => ({ ...c }));
  const phone = a.phone.trim();
  let phoneChanged = false;
  if (given("find.phone") && phone && phone !== mainPhone(stored.contacts)) {
    const i = contacts.findIndex((c) => isPhoneType(c.type));
    if (i >= 0) contacts[i] = { ...contacts[i], value: phone };
    else contacts.unshift({ type: "whatsapp_call", value: phone, country, primary: !contacts.some((c) => c.value.trim()) });
    phoneChanged = true;
  }

  let locations = stored.locations;
  const address = a.address.trim().replace(/\s+/g, " ");
  const addressChanged = given("find.address") && !!address && address !== headAddress(stored.locations);
  if (addressChanged) {
    const head = stored.locations.find((l) => l.kind === "head");
    const next: LocationValue = { ...(head ?? { kind: "head", label: "", inBuilding: false, building: { name: "", floor: "", block: "", unit: "" }, street: "", area: "", city: "" }), address, manual: false, placeId: undefined, lat: undefined, lng: undefined };
    locations = [next, ...stored.locations.filter((l) => l.kind !== "head")];
  }

  if (!hoursChanged && !phoneChanged && !addressChanged) return null;
  return { hours: stored.hours, area: stored.area, contact: stored.contact, faqs: stored.faqs, openingHours, locations, contacts };
}

// ---- 🎙️ Your voice -> approveVoice ("quiz") -------------------------------------------------------------------------

/** The rules the three this-or-that questions add (and replace when the quiz is played again). */
export const VOICE_RULES = {
  friendly: "Write like you talk to a friend",
  formal: "Stay polite and a little formal",
  emojisYes: "Use one or two emojis per post",
  emojisNo: "Use emojis",
  short: "Keep posts short: two or three lines",
  detailed: "Give the details: what it is, where, and how to order",
} as const;
const QUIZ_RULES = new Set<string>(Object.values(VOICE_RULES));

export type VoiceAnswer = { topic: "formality" | "emojis" | "followup"; answer: string };

/**
 * The brand voice to approve: the post the owner picked (or the stored voice for "keep"), with the this-or-that
 * answers as rules. Null when the owner skipped the pick and there is no stored voice to add the rules to.
 */
export function voiceSaveFrom(stored: VoiceSummary | null, options: readonly VoiceOption[], a: QuizAnswers["voice"], given: Given): { summary: VoiceSummary; answers: VoiceAnswer[] } | null {
  const picked = given("voice.pick") ? (a.pick === "keep" ? stored : (options.find((o) => o.id === a.pick)?.summary ?? null)) : stored;
  if (!picked) return null;
  const tone = given("voice.tone") ? a.tone : "";
  const emojis = given("voice.emojis") ? a.emojis : "";
  const length = given("voice.length") ? a.length : "";
  if (!given("voice.pick") && !tone && !emojis && !length) return null;

  const doLines = picked.do.filter((l) => !QUIZ_RULES.has(l));
  const dontLines = picked.dont.filter((l) => !QUIZ_RULES.has(l));
  const extraDo = ([tone === "friendly" && VOICE_RULES.friendly, tone === "formal" && VOICE_RULES.formal, emojis === "yes" && VOICE_RULES.emojisYes, length === "short" && VOICE_RULES.short, length === "detailed" && VOICE_RULES.detailed] as (string | false)[]).filter((l): l is string => !!l);
  const extraDont = emojis === "no" ? [VOICE_RULES.emojisNo] : [];
  const summary: VoiceSummary = {
    voice: picked.voice,
    do: [...extraDo, ...doLines].slice(0, SUMMARY_LIMITS.lines),
    dont: [...extraDont, ...dontLines].slice(0, SUMMARY_LIMITS.lines),
    samples: picked.samples.slice(0, SUMMARY_LIMITS.samples),
  };
  const answers: VoiceAnswer[] = [
    ...(tone ? [{ topic: "formality" as const, answer: tone === "friendly" ? "Friendly" : "Formal" }] : []),
    ...(emojis ? [{ topic: "emojis" as const, answer: emojis === "yes" ? "Some emojis" : "No emojis" }] : []),
    ...(length ? [{ topic: "followup" as const, answer: length === "short" ? "Post length: short" : "Post length: detailed" }] : []),
  ];
  return { summary, answers };
}

// ---- 💬 Love notes -> createReview --------------------------------------------------------------------------------

export function reviewInputFrom(a: QuizAnswers["love"], given: Given): ReviewInput | null {
  if (!given("love.quote") || !a.quote.trim()) return null;
  return {
    quote: a.quote.trim(),
    customerName: a.customerName.trim(),
    source: given("love.source") && a.source ? a.source : "OTHER",
    rating: null,
    receivedOn: "",
    productId: "",
    canPublish: given("love.consent") && a.canPublish,
  };
}

// ---- Errors on the question ---------------------------------------------------------------------------------------

const FIELD_STEPS: Record<QuizRoundId, [RegExp, string][]> = {
  you: [[/^tagline/, "you.tagline"], [/^about/, "you.about"], [/^size/, "you.size"], [/^yearFounded/, "you.year"], [/^languages/, "you.languages"], [/^values/, "you.values"], [/^mission/, "you.mission"]],
  sell: [],
  customers: [[/^ageRange/, "customers.age"], [/^gender/, "customers.gender"], [/^channels/, "customers.online"], [/^needs/, "customers.needs"], [/^pains/, "customers.pains"], [/^triggers/, "customers.triggers"]],
  why: [[/^(name|link)/, "why.competitors"], [/^differentiators/, "why.differentiators"], [/^statement/, "why.statement"]],
  rules: [[/^paymentMethods/, "rules.payment"], [/^delivery/, "rules.delivery"], [/^returns/, "rules.returns"], [/^booking/, "rules.booking"], [/^(question|answer)/, "rules.faqs"]],
  find: [[/^openingHours/, "find.hours"], [/^contacts/, "find.phone"], [/^locations/, "find.address"]],
  voice: [],
  love: [[/^(quote|customerName|receivedOn)/, "love.quote"], [/^source/, "love.source"], [/^canPublish/, "love.consent"]],
};

/**
 * Which question a field error belongs on. Fields the quiz does not ask (the sector, the website…) go on `fallback`,
 * the round's first question, which links to the full form.
 */
export function stepForField(round: QuizRoundId, field: string, fallback: string): string {
  return FIELD_STEPS[round].find(([re]) => re.test(field))?.[1] ?? fallback;
}

// ---- The questions and their first answers ------------------------------------------------------------------------

/** What is stored, in the shape the quiz reads (the page loads it; each round updates it after saving). */
export type QuizStored = {
  /** Null when the owner's role cannot edit the profile. */
  profile: ProfileFormValues | null;
  products: string[];
  personas: StoredPersona[];
  competitors: string[];
  positioning: { differentiators: string[]; statement: string | null };
  policies: Policies;
  faqs: string[];
  brand: BrandValues | null;
  voice: VoiceSummary | null;
  voiceAnswers: { topic: string; answer: string }[];
};

/** New products asked about in one quiz (more can be added on the Products page). */
export const MAX_QUIZ_PRODUCTS = 6;

/** The questions of the rounds the owner can edit, in order. Some depend on earlier answers (each new product, a review). */
export function quizSteps(rounds: readonly QuizRoundId[], a: QuizAnswers, stored: QuizStored, opts: { canGrant: boolean }): QuizStep[] {
  const on = new Set(rounds);
  const out: QuizStep[] = [];
  const add = (round: QuizRoundId, ...ids: string[]) => {
    if (on.has(round)) for (const id of ids) out.push({ id, round });
  };
  add("you", "you.tagline", "you.about", "you.size", "you.year", "you.languages", "you.values", "you.mission");
  add("sell", "sell.pick", ...newProductNames(stored.products, a.sell.picked).slice(0, MAX_QUIZ_PRODUCTS).map(productStepId));
  add("customers", "customers.pick", "customers.age", "customers.gender", "customers.online", "customers.needs", "customers.pains", "customers.triggers");
  add("why", "why.competitors", "why.differentiators", "why.statement");
  add("rules", "rules.payment", "rules.delivery", "rules.returns", "rules.booking", "rules.faqs");
  add("find", "find.hours", "find.phone", "find.address");
  add("voice", "voice.tone", "voice.emojis", "voice.length", "voice.pick");
  add("love", "love.quote", ...(a.love.quote.trim() ? ["love.source", ...(opts.canGrant ? ["love.consent"] : [])] : []));
  return out;
}

/**
 * The first answers of a new product, as every other question starts: the AI's idea when there is one, else the
 * business's likely kind and the first reason idea of its industry; no price ("Ask for price") until one is typed.
 */
export function productDefaults(name: string, ideas: readonly ProductIdea[], likely: ProductKindValue, reasonIdeas: readonly string[] = []): ProductAnswer {
  const idea = ideas.find((i) => same(i.name, name));
  return { kind: idea?.kind ?? likely, price: "", onRequest: true, reason: idea?.reasons[0] ?? reasonIdeas[0] ?? "" };
}

/**
 * What is wrong with a question's answer, checked in the browser on Next with the action's own schema, so the problem
 * shows on that question at once instead of after the round's save. Null when it is fine (or not checked here).
 */
export function stepProblem(stepId: string, a: QuizAnswers, ideas: readonly ProductIdea[], currency: string): string | null {
  if (stepId.startsWith("sell.item.")) {
    const name = a.sell.picked.find((n) => productStepId(n) === stepId);
    if (!name) return null;
    const [item] = productInputsFrom([], { picked: [name], details: a.sell.details }, ideas, currency, () => true);
    if (!item) return null;
    const parsed = productInputSchema.safeParse(item.input);
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check this product.");
  }
  if (stepId === "love.quote" && a.love.quote.trim() && !a.love.customerName.trim()) return "Add the customer's name or initials.";
  return null;
}

/** The persona a card stands for, as the questions after the cards start from. */
export function personaOfKey(key: string, stored: readonly StoredPersona[], ideas: readonly PersonaIdea[]): Pick<PersonaFormValues, "ageRange" | "gender" | "channels" | "needs" | "pains" | "triggers"> | null {
  const own = stored.find((p) => storedPersonaKey(p.id) === key);
  if (own) return own;
  const idea = key.startsWith("idea:") ? ideas[Number(key.slice(5))] : undefined;
  return idea ?? null;
}

const asAge = (v: string): AgeRange | "" => ((AGE_RANGES as readonly string[]).includes(v) ? (v as AgeRange) : "");
const asGender = (v: string | null | undefined): Gender | "" => (v === "female" || v === "male" || v === "any" ? v : "");

/**
 * Every question's first answer: what is stored, or BuPulse's guess when nothing is. `guessed` lists the questions
 * whose answer is a guess (they show "Our guess").
 */
export function initialAnswers(stored: QuizStored, draft: QuizDraft, opts: { likelyKind: ProductKindValue; reasonIdeas?: readonly string[]; places: Places }): { answers: QuizAnswers; guessed: string[] } {
  const guessed: string[] = [];
  const pick = (id: string, have: string | null | undefined, guess: string | undefined): string => {
    if (have?.trim()) return have;
    if (guess) guessed.push(id);
    return guess ?? "";
  };
  const pickList = <T>(id: string, have: T[], guess: T[]): T[] => {
    if (have.length) return have;
    if (guess.length) guessed.push(id);
    return guess;
  };
  const p = stored.profile;

  const newIdeas = draft.products.filter((i) => !stored.products.some((n) => same(n, i.name)));
  const pickedProducts = stored.products.length ? [] : newIdeas.slice(0, 2).map((i) => i.name);
  if (pickedProducts.length) guessed.push("sell.pick");

  const firstPersona = stored.personas[0] ? storedPersonaKey(stored.personas[0].id) : draft.personas[0] ? ideaPersonaKey(0) : "";
  if (!stored.personas.length && firstPersona) guessed.push("customers.pick");
  const focus = firstPersona ? personaOfKey(firstPersona, stored.personas, draft.personas) : null;

  const brand = stored.brand;
  const hours = brand ? hoursChoiceOf(brand.openingHours) : "";
  if (!hours) guessed.push("find.hours");

  const answer = (topic: string) => stored.voiceAnswers.find((x) => x.topic === topic)?.answer ?? "";
  const formality = answer("formality");
  const emojis = answer("emojis");
  const length = stored.voiceAnswers.find((x) => x.answer.startsWith("Post length:"))?.answer ?? "";
  const tone = formality === "Formal" ? "formal" : formality === "Friendly" ? "friendly" : "";
  if (!tone) guessed.push("voice.tone");
  if (!emojis) guessed.push("voice.emojis");
  if (!length) guessed.push("voice.length");
  if (!stored.voice) guessed.push("voice.pick");

  if (!stored.competitors.length && draft.competitors.length) guessed.push("why.competitors");

  const policy = (kind: PolicyKind, id: string): PolicyAnswer => {
    const have = policyAnswerOf(kind, stored.policies[kind], opts.places);
    if (have.choice) return have;
    const guess = draft.policies[kind];
    if (guess) guessed.push(id);
    return { choice: guess, text: "" };
  };

  const faqs = draft.faqs.filter((f) => !stored.faqs.some((q) => same(q, f.question))).map((f, i) => ({ id: `idea-${i}`, question: f.question, answer: f.answer }));
  if (faqs.length) guessed.push("rules.faqs");

  return {
    guessed,
    answers: {
      you: {
        tagline: pick("you.tagline", p?.tagline, draft.taglines[0]),
        about: pick("you.about", p?.about, draft.about || undefined),
        size: (p?.size as CompanySize | "") ?? "",
        yearFounded: p?.yearFounded ?? "",
        languages: pickList("you.languages", p?.languages ?? [], draft.languages),
        values: pickList("you.values", p?.values ?? [], draft.values.slice(0, 3)),
        mission: pick("you.mission", p?.mission, draft.missions[0]),
      },
      sell: { picked: pickedProducts, details: Object.fromEntries(pickedProducts.map((n) => [itemKey(n), productDefaults(n, draft.products, opts.likelyKind, opts.reasonIdeas)])) },
      customers: {
        picked: firstPersona ? [firstPersona] : [],
        ageRange: asAge(focus?.ageRange ?? ""),
        gender: asGender(focus?.gender),
        channels: focus?.channels ?? [],
        needs: focus?.needs ?? [],
        pains: focus?.pains ?? [],
        triggers: focus?.triggers ?? [],
      },
      why: {
        competitors: stored.competitors.length ? [] : draft.competitors.slice(0, 2),
        differentiators: pickList("why.differentiators", stored.positioning.differentiators, draft.differentiators.slice(0, 3)),
        statement: pick("why.statement", stored.positioning.statement, draft.positioning[0]),
      },
      rules: {
        payment: pickList("rules.payment", stored.policies.paymentMethods, draft.policies.payment),
        delivery: policy("delivery", "rules.delivery"),
        returns: policy("returns", "rules.returns"),
        booking: policy("booking", "rules.booking"),
        faqs,
        faqKept: faqs.slice(0, 3).map((f) => f.id),
      },
      find: {
        hours: hours || "monSat",
        custom: brand?.openingHours[0] ?? HOURS_PRESETS.weekdays[0],
        phone: brand ? mainPhone(brand.contacts) : "",
        address: brand ? headAddress(brand.locations) : "",
      },
      voice: {
        tone: tone || "friendly",
        emojis: emojis === "No emojis" ? "no" : "yes",
        length: length === "Post length: detailed" ? "detailed" : "short",
        pick: stored.voice ? "keep" : (tone === "formal" ? draft.voices[1]?.id : draft.voices[0]?.id) ?? "",
      },
      love: { quote: "", customerName: "", source: "WHATSAPP", canPublish: false },
    },
  };
}
