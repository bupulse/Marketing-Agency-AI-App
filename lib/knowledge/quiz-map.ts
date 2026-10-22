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
import { PAYMENT_LABEL, type Policies, type PaymentMethod } from "./policies";
import { productInputSchema, type ProductInput, type ProductKindValue } from "./products";
import type { CompanySize, ProfileFormValues, ProfileInput } from "./profile";
import { POLICY_TILES, sameKey, type BusinessType, type PersonaIdea, type PolicyKind, type ProductIdea, type QuizDraft, type VoiceOption } from "./quiz-draft";
import type { ReviewInput, ReviewSourceValue } from "./reviews";
import type { SectionKey } from "./sections";
import type { QuizRound, QuizStep } from "@/lib/quiz/flow";

/** True when the owner answered the question (it was not skipped). */
export type Given = (stepId: string) => boolean;

export const QUIZ_ROUND_IDS = ["you", "sell", "photos", "customers", "why", "rules", "find", "look", "voice", "love", "golive"] as const;
export type QuizRoundId = (typeof QUIZ_ROUND_IDS)[number];

export function isQuizRound(value: unknown): value is QuizRoundId {
  return typeof value === "string" && (QUIZ_ROUND_IDS as readonly string[]).includes(value);
}

/** The rounds, in order. `section` is the Business info section the round fills (its full form and its %). */
export const QUIZ_ROUNDS: readonly (QuizRound & { id: QuizRoundId; section: SectionKey; href: string })[] = [
  { id: "you", title: "You", emoji: "🏠", blurb: "Who you are", section: "profile", href: "/dashboard/knowledge/profile" },
  { id: "sell", title: "What you sell", emoji: "🛍️", blurb: "Your products and services", section: "products", href: "/dashboard/knowledge/products" },
  { id: "photos", title: "Photos", emoji: "📸", blurb: "A photo or video of each product", section: "products", href: "/dashboard/knowledge/products" },
  { id: "customers", title: "Your customers", emoji: "👥", blurb: "Who buys from you", section: "audience", href: "/dashboard/knowledge/audience" },
  { id: "why", title: "Why you", emoji: "⭐", blurb: "Why people choose you", section: "competitors", href: "/dashboard/knowledge/competitors" },
  { id: "rules", title: "Rules", emoji: "📋", blurb: "Payment, delivery and questions", section: "faqs", href: "/dashboard/knowledge/faqs" },
  { id: "find", title: "Find us", emoji: "📍", blurb: "Hours, phone and address", section: "locations", href: "/dashboard/knowledge/locations" },
  { id: "look", title: "Your look", emoji: "🎨", blurb: "Your logo and colours", section: "brand", href: "/dashboard/brand#brand-look" },
  { id: "voice", title: "Your voice", emoji: "🎙️", blurb: "How your posts sound", section: "interview", href: "/dashboard/knowledge/interview" },
  { id: "love", title: "Love notes", emoji: "💬", blurb: "What customers say", section: "reviews", href: "/dashboard/knowledge/reviews" },
  { id: "golive", title: "Go live", emoji: "🚀", blurb: "Connect your social accounts", section: "channels", href: "/dashboard/connections" },
];

export const quizRound = (id: QuizRoundId) => QUIZ_ROUNDS.find((r) => r.id === id)!;

/**
 * The quiz round that raises a section, among the rounds the person can play: Products has two (What you sell, and
 * Photos once there are products: its to-do then says "Add photos…"). Null when no round fills it.
 */
export function roundForSection(key: SectionKey, progress: { next?: string; summary?: string } | undefined, available: readonly QuizRoundId[]): QuizRoundId | null {
  const line = progress?.next ?? progress?.summary ?? "";
  // The service area is asked in Find us: a profile that lacks only it opens there.
  if (key === "profile" && /^Add your service area$/.test(line) && available.includes("find")) return "find";
  const rounds = QUIZ_ROUNDS.filter((r) => r.section === key && available.includes(r.id)).map((r) => r.id);
  if (key === "products" && rounds.length > 1) return /^Add photos/.test(line) ? "photos" : "sell";
  return rounds[0] ?? null;
}

export type HoursChoice = "weekdays" | "monSat" | "everyday" | "always" | "keep" | "custom";
/** A new product's answers. No price typed means "Ask for price" (`onRequest`), never a guessed price. */
export type ProductAnswer = { kind: ProductKindValue; price: string; onRequest: boolean; reason: string };

/** A photo or video added in the quiz, shown on its question (uploads and imports are in the album at once). */
export type QuizPhoto = { id: string; url: string; kind: string; posterUrl?: string | null };
/** One customer review (Love notes takes up to MAX_QUIZ_REVIEWS). */
export type LoveNote = { quote: string; customerName: string; source: ReviewSourceValue | ""; canPublish: boolean };
/** Reviews asked for in one quiz: three the AI may quote make the section complete. */
export const MAX_QUIZ_REVIEWS = 3;

export type QuizAnswers = {
  you: { tagline: string; about: string; size: CompanySize | ""; yearFounded: string; languages: string[]; values: string[]; mission: string; vision: string; website: string };
  sell: { picked: string[]; details: Record<string, ProductAnswer> };
  customers: { picked: string[]; ageRange: AgeRange | ""; gender: Gender | ""; channels: string[]; needs: string[]; pains: string[]; triggers: string[] };
  why: { competitors: string[]; differentiators: string[]; statement: string };
  rules: { payment: PaymentMethod[]; delivery: PolicyAnswer; returns: PolicyAnswer; warranty: PolicyAnswer; booking: PolicyAnswer; faqs: { id: string; question: string; answer: string }[]; faqKept: string[]; faqEdited?: string[] };
  find: { hours: HoursChoice | ""; custom: Schedule; phone: string; address: string; area: PolicyAnswer };
  voice: { tone: "friendly" | "formal" | ""; emojis: "yes" | "no" | ""; length: "short" | "detailed" | ""; pick: string };
  love: LoveNote[];
  /** Per photo question (its target's key): what was uploaded or imported (already in the album) and gallery picks (linked when the round saves). */
  photos: { added: Record<string, QuizPhoto[]>; picked: Record<string, QuizPhoto[]> };
  /** The logo (a path in the brand bucket, and a link to show it), the colours picked, and the colours found in a logo uploaded now. */
  look: { logoPath: string | null; logoUrl: string | null; colors: string[]; palette: string; logoColors: string[] };
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
    vision: kept(given("you.vision"), a.vision, stored.vision),
    website: kept(given("you.website"), a.website, stored.website),
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

// ---- 📸 Photos -> the products' albums -----------------------------------------------------------------------------

/**
 * A product that gets a photo question: a stored one without a photo (`productId` known), or one picked in What you
 * sell, whose id is known once that round saved (`QuizStored.productIds`). Keyed so the question exists before the
 * product does: the round keeps its length when the products are saved.
 */
export type PhotoTarget = { key: string; name: string; productId: string | null; isNew: boolean };
export const photoStepId = (key: string) => `photos.${key}`;
/** Photo questions in one quiz. */
export const MAX_QUIZ_PHOTO_STEPS = 8;

export function photoTargets(stored: Pick<QuizStored, "photoless" | "productIds" | "products">, a: Pick<QuizAnswers, "sell">): PhotoTarget[] {
  const out: PhotoTarget[] = stored.photoless.map((p) => ({ key: `p-${p.id}`, name: p.name, productId: p.id, isNew: false }));
  for (const name of newProductNames(stored.products, a.sell.picked).slice(0, MAX_QUIZ_PRODUCTS)) {
    const key = itemKey(name);
    out.push({ key: `n-${key.replace(/[^\p{L}\p{N}]+/gu, "-")}`, name, productId: stored.productIds[key] ?? null, isNew: true });
  }
  return out.slice(0, MAX_QUIZ_PHOTO_STEPS);
}

/**
 * The Photos round's save: the gallery photos picked for each product (uploads and imports are in the album already),
 * and the products the quiz made as drafts that now have a photo, made active (a product needs a photo to be ready).
 */
export function photosSaveFrom(targets: readonly PhotoTarget[], a: QuizAnswers["photos"], given: Given): { links: { productId: string; assetIds: string[] }[]; activate: string[] } {
  const links: { productId: string; assetIds: string[] }[] = [];
  const activate: string[] = [];
  for (const t of targets) {
    if (!t.productId) continue;
    const picked = given(photoStepId(t.key)) ? (a.picked[t.key] ?? []).map((p) => p.id) : [];
    if (picked.length) links.push({ productId: t.productId, assetIds: [...new Set(picked)] });
    // Every draft the quiz made: the server makes active the ones that have a photo, wherever it was added.
    if (t.isNew) activate.push(t.productId);
  }
  return { links, activate };
}

// ---- 🎨 Your look -> saveLook --------------------------------------------------------------------------------------

export type StoredLook = { logoPath: string | null; logoUrl: string | null; colors: string[] };

/** The logo and colours to save, the stored ones where a question was skipped. Null when nothing changed. */
export function lookSaveFrom(stored: StoredLook, a: QuizAnswers["look"], given: Given): { logoPath: string | null; brandColors: string[] } | null {
  const logoPath = given("look.logo") && a.logoPath ? a.logoPath : stored.logoPath;
  const brandColors = given("look.colors") && a.colors.length ? a.colors.map((c) => c.toUpperCase()) : stored.colors;
  if (logoPath === stored.logoPath && brandColors.join() === stored.colors.join()) return null;
  return { logoPath, brandColors };
}

/** The colour sets offered: from the logo just uploaded, the stored ones, then the industry's. Each `id` is a tile. */
export function paletteOptions(look: Pick<QuizAnswers["look"], "logoColors">, stored: StoredLook, industry: readonly string[][]): { id: string; label: string; colors: string[] }[] {
  return [
    ...(look.logoColors.length ? [{ id: "logo", label: "From your logo", colors: look.logoColors }] : []),
    ...(stored.colors.length ? [{ id: "keep", label: "Keep my colours", colors: stored.colors }] : []),
    ...industry.map((colors, i) => ({ id: `p${i}`, label: `Idea ${i + 1}`, colors })),
  ];
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
/**
 * Where the business is, for "We deliver in Kigali" (the area served, else nothing) and "across Rwanda", and the head
 * office address for "You can pick up at …" (empty when not stored).
 */
export type Places = { city: string; country: string; address?: string; /** Which policy tiles fit (POLICY_TILES); a shop when not given. */ type?: BusinessType };

const CHOICE_TEXT: Record<PolicyKind, Record<string, (p: Places) => { label: string; sentence: string; emoji: string }>> = {
  delivery: {
    pickup: () => ({ label: "No delivery, pick-up only", sentence: "We do not deliver: pick-up only, at our place.", emoji: "🏪" }),
    city: (p) => ({ label: `We deliver in ${p.city || "town"}`, sentence: `We deliver in ${p.city || "town"}. Message us with your address.`, emoji: "🛵" }),
    country: (p) => ({ label: `We deliver across ${p.country || "the country"}`, sentence: `We deliver across ${p.country || "the country"}. Message us with your address.`, emoji: "🚚" }),
    app: () => ({ label: "Through a delivery app", sentence: "We deliver through delivery apps.", emoji: "📱" }),
    atPlace: () => ({ label: "Customers come to us", sentence: "Customers come to our place; we do not do home visits.", emoji: "🏠" }),
    homeVisit: (p) => ({ label: "We come to you", sentence: `We come to you${p.city ? ` in ${p.city}` : ""}. Message us to book a visit.`, emoji: "🚗" }),
    both: () => ({ label: "Both: our place or yours", sentence: "Come to our place, or we come to you. Message us to arrange it.", emoji: "🔄" }),
    online: () => ({ label: "Online", sentence: "We serve our customers online.", emoji: "💻" }),
  },
  returns: {
    noFood: () => ({ label: "No returns on food and drinks", sentence: "We do not take returns on food and drinks.", emoji: "🍽️" }),
    exchange: () => ({ label: "Exchange within 7 days with the receipt", sentence: "Items can be exchanged within 7 days with the receipt.", emoji: "🔁" }),
    refund: () => ({ label: "Refund within 7 days", sentence: "Items can be refunded within 7 days with the receipt.", emoji: "💸" }),
    noReturns: () => ({ label: "No returns once sold", sentence: "Items cannot be returned once sold.", emoji: "🚫" }),
    replaceOrder: () => ({ label: "We replace a wrong order", sentence: "If your order is wrong, we replace it.", emoji: "🔁" }),
    redo: () => ({ label: "Free redo within 7 days if you're not happy", sentence: "Not happy? We redo it for free within 7 days.", emoji: "💅" }),
    noRefund: () => ({ label: "No refunds after the service", sentence: "We do not refund a service once it is done.", emoji: "🚫" }),
  },
  warranty: {
    w12: () => ({ label: "12-month warranty on new items", sentence: "New items come with a 12-month warranty.", emoji: "🛡️" }),
    w3: () => ({ label: "3-month warranty", sentence: "Items come with a 3-month warranty.", emoji: "🛡️" }),
    checked: () => ({ label: "Checked before you buy", sentence: "Every item is checked before it is sold.", emoji: "✅" }),
    fresh: () => ({ label: "Fresh, or we replace it", sentence: "Everything is fresh; if it is not, we replace it.", emoji: "🥗" }),
    work30: () => ({ label: "Our work is guaranteed for 30 days", sentence: "Our work is guaranteed for 30 days.", emoji: "🛡️" }),
    satisfaction: () => ({ label: "Happy, or we fix it", sentence: "If you are not happy with our work, we fix it.", emoji: "😊" }),
    none: () => ({ label: "No guarantee", sentence: "We do not offer a guarantee.", emoji: "➖" }),
  },
  booking: {
    walkIn: () => ({ label: "No booking, just walk in", sentence: "No booking needed: just walk in.", emoji: "🚶" }),
    whatsapp: () => ({ label: "Book by WhatsApp or a call", sentence: "Book by WhatsApp or a call.", emoji: "💬" }),
    online: () => ({ label: "Book online", sentence: "Book online.", emoji: "🌐" }),
  },
};

/** The tiles of a policy question that fit the business (POLICY_TILES), in order, then "Something else". */
export function policyOptions(kind: PolicyKind, places: Places): { value: string; label: string; emoji: string; sentence: string }[] {
  const tiles = POLICY_TILES[places.type ?? "goods"][kind] as readonly string[];
  return [...tiles.map((c) => ({ value: c, ...CHOICE_TEXT[kind][c](places) })), { value: "other", label: "Something else", emoji: "✏️", sentence: "" }];
}

/** The question each policy asks, worded for the business ("Do you deliver?" or, for a salon, "Where do you serve customers?"). */
export function policyTitle(kind: PolicyKind, type: BusinessType = "goods"): string {
  const titles: Record<PolicyKind, Record<BusinessType, string>> = {
    delivery: { goods: "Do you deliver?", food: "Do you deliver?", service: "Where do you serve customers?" },
    returns: { goods: "Can people return things?", food: "What if an order is wrong?", service: "What if a customer isn't happy?" },
    warranty: { goods: "Do you give a warranty?", food: "Do you guarantee freshness?", service: "Do you guarantee your work?" },
    booking: { goods: "How do people book?", food: "How do people book?", service: "How do people book?" },
  };
  return titles[kind][type];
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
    warranty: kept(given("rules.warranty"), policyText("warranty", a.warranty, places), stored.warranty ?? "") || null,
    booking: kept(given("rules.booking"), policyText("booking", a.booking, places), stored.booking ?? "") || null,
  };
  const changed = next.paymentMethods.join() !== stored.paymentMethods.join() || next.delivery !== stored.delivery || next.returns !== stored.returns || next.warranty !== stored.warranty || next.booking !== stored.booking;
  return changed ? next : null;
}

/** The policy a common question is about ("Do you deliver?" -> delivery), or null. */
export function faqTopic(question: string): PolicyKind | "payment" | null {
  if (/\bdeliver/i.test(question)) return "delivery";
  if (/\b(return|refund|exchange)/i.test(question)) return "returns";
  if (/\b(warrant|guarantee)/i.test(question)) return "warranty";
  if (/\b(book|booking|appointment|reserv)/i.test(question)) return "booking";
  if (/\b(pay|payment|mobile money|momo)\b/i.test(question)) return "payment";
  return null;
}

/** The answer the round's own picks give to a question on that topic; null when nothing was picked for it. */
export function tileAnswer(topic: PolicyKind | "payment", a: QuizAnswers["rules"], places: Places): string | null {
  if (topic === "payment") {
    const labels = a.payment.map((m) => PAYMENT_LABEL[m]);
    return labels.length ? `You can pay by ${labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}` : labels[0]}.` : null;
  }
  const answer = a[topic];
  if (topic === "delivery" && answer.choice === "pickup") return `No, we don't deliver. You can pick up at ${places.address?.trim() || "our place"}.`;
  if (topic === "delivery" && answer.choice === "atPlace") return `No, customers come to us${places.address?.trim() ? `, at ${places.address.trim()}` : ""}.`;
  const text = policyText(topic, answer, places);
  if (!text) return null;
  return topic === "delivery" && ["city", "country", "app", "homeVisit"].includes(answer.choice) ? `Yes. ${text}` : text;
}

/**
 * The common questions as the round's picks answer them: a question about delivery, returns, booking or payment gets
 * its answer from the tiles picked in the same round, so an idea never contradicts them ("No delivery, pick-up only"
 * makes "Do you deliver?" answer "No, we don't deliver…"). A question the owner wrote or changed stays as it is.
 */
export function alignFaqs(a: QuizAnswers["rules"], places: Places): QuizAnswers["rules"]["faqs"] {
  const edited = new Set(a.faqEdited ?? []);
  return a.faqs.map((f) => {
    const topic = edited.has(f.id) ? null : faqTopic(f.question);
    const answer = topic ? tileAnswer(topic, a, places) : null;
    return answer ? { ...f, answer } : f;
  });
}

export function newFaqsFrom(storedQuestions: readonly string[], a: QuizAnswers["rules"], given: Given, places?: Places): { question: string; answer: string }[] {
  if (!given("rules.faqs")) return [];
  const have = new Set(storedQuestions.map(itemKey));
  return (places ? alignFaqs(a, places) : a.faqs).flatMap((f) => {
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
 * "Where do your customers come from?": tiles made from the address and the country ("Remera and nearby", "All of
 * Kigali", "All of Rwanda", "Online, anywhere"), each saved as its label in Business.knowledge.area (the service area,
 * the same field as the Locations form and the profile's "Area you serve"), plus "Something else".
 */
export function areaOptions(address: string, country: string): { value: string; label: string; emoji: string }[] {
  const land = country.trim();
  const parts = address.split(",").map((p) => p.trim()).filter((p) => p && !/^\d/.test(p) && (!land || p.toLowerCase() !== land.toLowerCase()));
  const city = parts.length >= 2 ? parts[parts.length - 1] : "";
  const near = parts.length >= 3 ? parts[parts.length - 2] : parts.length === 1 ? parts[0] : "";
  const tiles = [
    near && near !== city ? { value: "near", label: `${near} and nearby`, emoji: "📍" } : null,
    city ? { value: "city", label: `All of ${city}`, emoji: "🏙️" } : null,
    land ? { value: "country", label: `All of ${land}`, emoji: "🗺️" } : null,
    { value: "online", label: "Online, anywhere", emoji: "🌍" },
  ].filter((t): t is { value: string; label: string; emoji: string } => !!t);
  return [...tiles.filter((t) => t.label.length <= 200), { value: "other", label: "Something else", emoji: "✏️" }];
}

/** The area text an answer stands for ("" for none). */
export function areaText(a: PolicyAnswer, options: readonly { value: string; label: string }[]): string {
  if (a.choice === "other") return a.text.trim().slice(0, 200);
  return options.find((o) => o.value === a.choice && o.value !== "other")?.label ?? "";
}

/** A stored area as the question shows it: its tile when it is one, else "Something else" with it; else a guess. */
export function areaAnswerOf(stored: string, options: readonly { value: string; label: string }[]): { answer: PolicyAnswer; guessed: boolean } {
  const text = stored.trim();
  if (text) {
    const tile = options.find((o) => o.value !== "other" && sameKey(o.label) === sameKey(text));
    return { answer: tile ? { choice: tile.value, text: "" } : { choice: "other", text }, guessed: false };
  }
  const guess = options.find((o) => o.value === "near") ?? options.find((o) => o.value === "city");
  return { answer: { choice: guess?.value ?? "", text: "" }, guessed: !!guess };
}

/**
 * The whole business info card (every stored field: the save replaces the card) with the quiz's hours, phone,
 * address and service area on top. Null when none of them changed, so a skipped round saves nothing.
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

  const area = given("find.area") ? areaText(a.area, areaOptions(address || headAddress(stored.locations), country)) || stored.area : stored.area;
  const areaChanged = area !== stored.area;

  if (!hoursChanged && !phoneChanged && !addressChanged && !areaChanged) return null;
  return { hours: stored.hours, area, contact: stored.contact, faqs: stored.faqs, openingHours, locations, contacts };
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

export const loveStepId = (part: "quote" | "source" | "consent", i: number) => `love.${part}.${i}`;

/** Review slots in Love notes: the shared reviews still missing of the three, at least one. */
export function reviewSlots(stored: Pick<QuizStored, "sharedReviews">): number {
  return Math.max(1, MAX_QUIZ_REVIEWS - (stored.sharedReviews ?? 0));
}

/** One review from its slot `i` (its quote, where it came from, consent); null without a quote. */
export function reviewInputFrom(a: LoveNote, given: Given, i = 0): ReviewInput | null {
  if (!given(loveStepId("quote", i)) || !a.quote.trim()) return null;
  return {
    quote: a.quote.trim(),
    customerName: a.customerName.trim(),
    source: given(loveStepId("source", i)) && a.source ? a.source : "OTHER",
    rating: null,
    receivedOn: "",
    productId: "",
    canPublish: given(loveStepId("consent", i)) && a.canPublish,
  };
}

/** The reviews of every slot that has one, with the slot each came from (for an error on its question). */
export function reviewInputsFrom(love: readonly LoveNote[], given: Given): { slot: number; input: ReviewInput }[] {
  return love.flatMap((note, slot) => {
    const input = reviewInputFrom(note, given, slot);
    return input ? [{ slot, input }] : [];
  });
}

// ---- Errors on the question ---------------------------------------------------------------------------------------

const FIELD_STEPS: Record<QuizRoundId, [RegExp, string][]> = {
  you: [[/^tagline/, "you.tagline"], [/^about/, "you.about"], [/^size/, "you.size"], [/^yearFounded/, "you.year"], [/^languages/, "you.languages"], [/^values/, "you.values"], [/^mission/, "you.mission"], [/^vision/, "you.vision"], [/^website/, "you.website"]],
  sell: [],
  photos: [],
  look: [[/^logo/, "look.logo"], [/^brandColors/, "look.colors"]],
  golive: [],
  customers: [[/^ageRange/, "customers.age"], [/^gender/, "customers.gender"], [/^channels/, "customers.online"], [/^needs/, "customers.needs"], [/^pains/, "customers.pains"], [/^triggers/, "customers.triggers"]],
  why: [[/^(name|link)/, "why.competitors"], [/^differentiators/, "why.differentiators"], [/^statement/, "why.statement"]],
  rules: [[/^paymentMethods/, "rules.payment"], [/^delivery/, "rules.delivery"], [/^returns/, "rules.returns"], [/^warranty/, "rules.warranty"], [/^booking/, "rules.booking"], [/^(question|answer)/, "rules.faqs"]],
  find: [[/^openingHours/, "find.hours"], [/^contacts/, "find.phone"], [/^locations/, "find.address"], [/^area/, "find.area"]],
  voice: [],
  love: [[/^(quote|customerName|receivedOn)/, "love.quote.0"], [/^source/, "love.source.0"], [/^canPublish/, "love.consent.0"]],
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
  /** Stored products with no photo yet (each gets a photo question), at the start. */
  photoless: { id: string; name: string }[];
  /** The ids of the products the quiz saved, by itemKey(name). */
  productIds: Record<string, string>;
  /** Null when the owner's role cannot edit the brand. */
  look: StoredLook | null;
  /** A social account is connected (Go live). */
  connected: boolean;
  /** Stored reviews the customer agreed to share: Love notes asks only for the rest of the three. */
  sharedReviews?: number;
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
  add("you", "you.tagline", "you.about", "you.size", "you.year", "you.languages", "you.values", "you.mission", "you.vision", "you.website");
  add("sell", "sell.pick", ...newProductNames(stored.products, a.sell.picked).slice(0, MAX_QUIZ_PRODUCTS).map(productStepId));
  add("photos", ...photoTargets(stored, a).map((t) => photoStepId(t.key)));
  add("customers", "customers.pick", "customers.age", "customers.gender", "customers.online", "customers.needs", "customers.pains", "customers.triggers");
  add("why", "why.competitors", "why.differentiators", "why.statement");
  add("rules", "rules.payment", "rules.delivery", "rules.returns", "rules.warranty", "rules.booking", "rules.faqs");
  add("find", "find.hours", "find.phone", "find.address", "find.area");
  add("look", "look.logo", "look.colors");
  add("voice", "voice.tone", "voice.emojis", "voice.length", "voice.pick");
  // A review slot opens once the one before it has a quote; each review asks where it came from and (Owners and Admins)
  // consent. The slots are what is missing of the three shared reviews (at least one, to add more).
  for (let i = 0; i < reviewSlots(stored); i++) {
    if (i > 0 && !a.love[i - 1]?.quote.trim()) break;
    add("love", loveStepId("quote", i), ...(a.love[i]?.quote.trim() ? [loveStepId("source", i), ...(opts.canGrant ? [loveStepId("consent", i)] : [])] : []));
  }
  add("golive", "golive.connect");
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
  const slot = /^love\.quote\.(\d)$/.exec(stepId);
  const note = slot ? a.love[Number(slot[1])] : undefined;
  if (note?.quote.trim() && !note.customerName.trim()) return "Add the customer's name or initials.";
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
/** An empty review slot. */
export const EMPTY_NOTE: LoveNote = { quote: "", customerName: "", source: "WHATSAPP", canPublish: false };

export function initialAnswers(stored: QuizStored, draft: QuizDraft, opts: { likelyKind: ProductKindValue; reasonIdeas?: readonly string[]; places: Places; country?: string }): { answers: QuizAnswers; guessed: string[] } {
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
  const area = areaAnswerOf(brand?.area ?? "", areaOptions(brand ? headAddress(brand.locations) : "", opts.country ?? opts.places.country));
  if (area.guessed) guessed.push("find.area");

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
  if (!stored.look?.colors.length && draft.palettes.length) guessed.push("look.colors");

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
        vision: pick("you.vision", p?.vision, draft.visions[0]),
        website: p?.website ?? "",
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
        warranty: policy("warranty", "rules.warranty"),
        booking: policy("booking", "rules.booking"),
        faqs,
        faqKept: faqs.slice(0, 3).map((f) => f.id),
        faqEdited: [],
      },
      find: {
        hours: hours || "monSat",
        custom: brand?.openingHours[0] ?? HOURS_PRESETS.weekdays[0],
        phone: brand ? mainPhone(brand.contacts) : "",
        address: brand ? headAddress(brand.locations) : "",
        area: area.answer,
      },
      voice: {
        tone: tone || "friendly",
        emojis: emojis === "No emojis" ? "no" : "yes",
        length: length === "Post length: detailed" ? "detailed" : "short",
        pick: stored.voice ? "keep" : (tone === "formal" ? draft.voices[1]?.id : draft.voices[0]?.id) ?? "",
      },
      love: Array.from({ length: MAX_QUIZ_REVIEWS }, () => ({ ...EMPTY_NOTE })),
      photos: { added: {}, picked: {} },
      look: {
        logoPath: stored.look?.logoPath ?? null,
        logoUrl: stored.look?.logoUrl ?? null,
        colors: stored.look?.colors.length ? stored.look.colors : (draft.palettes[0] ?? []),
        palette: stored.look?.colors.length ? "keep" : draft.palettes.length ? "p0" : "",
        logoColors: [],
      },
    },
  };
}
