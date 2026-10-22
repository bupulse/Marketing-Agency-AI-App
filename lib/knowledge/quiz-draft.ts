// The Business info quiz's guesses (docs/QUIZ_MODE.md, "A. Business info quiz"): what the one AI call at the start of
// the quiz returns, how it is checked, and the template that answers when the AI cannot. Pure: the AI call is in
// lib/knowledge/quiz-ai.ts; the quiz page, the server and the tests share this.
//
// The AI never decides a fact. Every line it writes is clipped, de-duplicated, and dropped when it carries a number
// (a price, a year, a delivery time) or a promise ("free", "discount", "guarantee") that the business data does not
// already hold. Whatever is missing or unusable is topped up from the template, so every round always has its ideas.

import { z } from "zod";
import { AGE_RANGES, GENDERS, ONLINE_PLACES, PERSONA_LIMITS, type AgeRange, type Gender } from "./audience";
import { COMPETITOR_LIMITS } from "./competitors";
import { FAQ_LIMITS, PAYMENT_METHODS, type PaymentMethod } from "./policies";
import { LIMITS as PRODUCT_LIMITS, PRODUCT_KINDS, type ProductKindValue } from "./products";
import { COMMON_LANGUAGES, PROFILE_LIMITS } from "./profile";
import { SUMMARY_LIMITS, summarySchema, type VoiceSummary } from "./interview";
import { clean } from "./text";

/** What BuPulse knows before the quiz: Business info, read on the server (lib/knowledge/quiz-ai.ts). */
export type QuizContext = {
  businessName: string;
  industry: string | null;
  country: string | null;
  /** The area served (Business.knowledge.area). */
  area: string | null;
  /** The profile's "what you do", else the onboarding description. */
  about: string | null;
  /** The one-line audience from onboarding. */
  audience: string | null;
  website: string | null;
  contentLanguage: string | null;
  products: { name: string; kind: ProductKindValue; summary: string; price: string }[];
  personas: string[];
  competitors: string[];
  faqs: string[];
};

export type VoiceOption = { id: string; label: string; emoji: string; summary: VoiceSummary; sample: string };
export type ProductIdea = { name: string; kind: ProductKindValue; summary: string; reasons: string[] };
export type PersonaIdea = {
  name: string;
  ageRange: AgeRange;
  gender: Gender;
  location: string;
  occupation: string;
  needs: string[];
  pains: string[];
  triggers: string[];
  channels: string[];
};

export type QuizDraft = {
  taglines: string[];
  about: string;
  missions: string[];
  values: string[];
  languages: string[];
  products: ProductIdea[];
  personas: PersonaIdea[];
  competitors: string[];
  differentiators: string[];
  positioning: string[];
  faqs: { question: string; answer: string }[];
  /** The likeliest common answer of each policy (a tile; "" when no guess), and the payment methods. */
  policies: { delivery: PolicyChoice<"delivery"> | ""; returns: PolicyChoice<"returns"> | ""; booking: PolicyChoice<"booking"> | ""; payment: PaymentMethod[] };
  voices: VoiceOption[];
  source: "ai" | "template";
};

/**
 * The common answers of each policy, shown as tiles (each one a policy sentence, lib/knowledge/quiz-map.ts
 * policySentence), plus "Something else" for the owner's own words. The AI only says which tile is likeliest.
 */
export const POLICY_CHOICES = {
  delivery: ["pickup", "city", "country", "app"],
  returns: ["noFood", "exchange", "refund"],
  booking: ["walkIn", "whatsapp", "online"],
} as const;
export type PolicyKind = keyof typeof POLICY_CHOICES;
export type PolicyChoice<K extends PolicyKind> = (typeof POLICY_CHOICES)[K][number];

/** The key two lines are compared on: case, punctuation and spacing do not count ("Just walk in." = "just walk in"). */
export function sameKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export const DRAFT_COUNTS = {
  taglines: 3,
  missions: 3,
  values: 6,
  languages: 4,
  products: 6,
  reasons: 3,
  personas: 3,
  personaLines: 4,
  competitors: 5,
  differentiators: 6,
  positioning: 3,
  faqs: 5,
  voices: 3,
} as const;

// ---- What the AI returns -----------------------------------------------------------------------------------------

const lines = (what: string) => z.array(z.string()).describe(what);

export const aiDraftSchema = z.object({
  taglines: lines("3 short taglines, each under 80 characters, different from each other"),
  about: z.string().describe("What the business does, 2 or 3 plain sentences, only from the data"),
  missions: lines("3 one-sentence mission ideas"),
  values: lines("Up to 6 values, 1 to 3 words each (e.g. Honesty, Fast service)"),
  languages: lines("Languages the business most likely talks to customers in"),
  products: z
    .array(
      z.object({
        name: z.string().describe("A product or service the data says or clearly implies they sell, not one already listed"),
        kind: z.enum(PRODUCT_KINDS),
        summary: z.string().describe("One sentence describing it, no price"),
        reasons: lines("2 or 3 short reasons to buy it, no prices or numbers"),
      }),
    )
    .describe("Up to 6 product or service ideas"),
  personas: z
    .array(
      z.object({
        name: z.string().describe('A short persona name, e.g. "Busy office worker"'),
        ageRange: z.enum(AGE_RANGES),
        gender: z.enum(GENDERS),
        location: z.string().describe("Where they live or work, from the data (the area or country)"),
        occupation: z.string(),
        needs: lines("2 to 4 short needs"),
        pains: lines("2 to 4 short frustrations"),
        triggers: lines("2 to 4 short things that make them buy"),
        channels: lines(`Where they are online, from: ${ONLINE_PLACES.join(", ")}`),
      }),
    )
    .describe("3 different customer personas"),
  competitors: lines("Up to 5 kinds of competitor customers also consider (e.g. \"Supermarket bakeries\"), never invented business names"),
  differentiators: lines("Up to 6 short reasons customers choose this business, only from the data"),
  positioning: lines("3 one-sentence positioning statements: for whom, what, why different"),
  faqs: z.array(z.object({ question: z.string(), answer: z.string().describe("An answer using only the data; when the data does not say, invite the customer to ask") })).describe("5 questions customers often ask"),
  policies: z.object({
    delivery: z.enum([...POLICY_CHOICES.delivery, "unsure"]).describe("The likeliest: pickup (no delivery), city (deliver in their city), country (across the country), app (through a delivery app), or unsure"),
    returns: z.enum([...POLICY_CHOICES.returns, "unsure"]).describe("The likeliest: noFood (no returns on food and drinks), exchange (exchange with the receipt), refund (refund with the receipt), or unsure"),
    booking: z.enum([...POLICY_CHOICES.booking, "unsure"]).describe("The likeliest: walkIn (no booking), whatsapp (book by WhatsApp or a call), online (book online), or unsure"),
    payment: z.array(z.enum(PAYMENT_METHODS)).describe("Payment methods they most likely take"),
  }),
  voices: z
    .array(
      z.object({
        name: z.string().describe('A 2-3 word name, e.g. "Warm and friendly"'),
        voice: z.string().describe("The voice in 2 or 3 sentences, written to a copywriter"),
        do: lines("3 to 5 short rules: what to do"),
        dont: lines("2 to 4 short rules: what never to do"),
        sample: z.string().describe("A sample social media post in this voice, without hashtags, about the business in general (no prices, offers or numbers)"),
      }),
    )
    .describe("3 clearly different brand voices: one warm and friendly, one professional, one bold and fun"),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;

export const aiDraftJsonSchema = (() => {
  const s = z.toJSONSchema(aiDraftSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
})();

// ---- Never invent ------------------------------------------------------------------------------------------------

const PROMISES = /\b(free|discount|discounts|guarantee|guaranteed|cheapest|lowest price|best price|award|awarded|certified|refund within)\b|%/gi;

/** The numbers in a text, separators removed ("15,000 RWF" -> "15000"). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.\s']*\d|\d/g) ?? []).map((n) => n.replace(/[,.\s']/g, ""));
}

/** The facts a line may repeat: every number and promise word in the business data. */
export function factsOf(ctx: QuizContext): { numbers: Set<string>; promises: Set<string> } {
  const all = JSON.stringify(ctx);
  return { numbers: new Set(numbersIn(all)), promises: new Set((all.match(PROMISES) ?? []).map((w) => w.toLowerCase())) };
}

/** True when the line holds a number or a promise the data does not: the AI made it up. */
export function invents(line: string, facts: ReturnType<typeof factsOf>): boolean {
  if (numbersIn(line).some((n) => !facts.numbers.has(n))) return true;
  return (line.match(PROMISES) ?? []).some((w) => !facts.promises.has(w.toLowerCase()));
}

type Facts = ReturnType<typeof factsOf>;

function text(value: unknown, max: number, facts: Facts): string {
  if (typeof value !== "string") return "";
  const t = clean(value, max);
  return t && !invents(t, facts) ? t : "";
}

/** Clean lines: clipped, fact-checked, without duplicates (ignoring case) or any in `skip`, at most `max`. */
function list(value: unknown, max: number, each: number, facts: Facts, skip: readonly string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set(skip.map(sameKey));
  const out: string[] = [];
  for (const item of value) {
    const t = text(item, each, facts);
    if (!t || seen.has(sameKey(t))) continue;
    seen.add(sameKey(t));
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** `ai` first, then `template` until there are `n`, without repeats. */
function topUp(ai: string[], template: readonly string[], n: number): string[] {
  const out = [...ai];
  for (const t of template) {
    if (out.length >= n) break;
    if (!out.some((o) => sameKey(o) === sameKey(t))) out.push(t);
  }
  return out.slice(0, n);
}

/** One voice as a complete summarySchema value, or null. */
function voiceFrom(raw: unknown, facts: Facts, id: string, emoji: string): VoiceOption | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const label = text(v.name, 40, facts);
  const sample = text(v.sample, SUMMARY_LIMITS.sample, facts);
  const summary = summarySchema.safeParse({
    voice: text(v.voice, SUMMARY_LIMITS.voice, facts),
    do: list(v.do, 5, SUMMARY_LIMITS.line, facts),
    dont: list(v.dont, 4, SUMMARY_LIMITS.line, facts),
    samples: sample ? [sample] : [],
  });
  if (!label || !sample || !summary.success) return null;
  return { id, label, emoji, summary: summary.data, sample };
}

const VOICE_EMOJI = ["😊", "💼", "⚡"];

/**
 * The AI's draft made safe: the strict schema first (anything off-shape is the template), then every line cleaned,
 * fact-checked and clipped to the limits the actions check, and each list topped up from `template`.
 */
export function sanitizeDraft(raw: unknown, ctx: QuizContext, template: QuizDraft): QuizDraft {
  const parsed = aiDraftSchema.safeParse(raw);
  if (!parsed.success) return template;
  const a = parsed.data;
  const facts = factsOf(ctx);
  const known = ctx.products.map((p) => p.name);

  const products: ProductIdea[] = [];
  for (const p of a.products) {
    const name = text(p.name, 80, facts);
    if (!name || [...known, ...products.map((x) => x.name)].some((n) => sameKey(n) === sameKey(name))) continue;
    const summary = text(p.summary, PRODUCT_LIMITS.summary, facts);
    products.push({ name, kind: p.kind, summary, reasons: topUp(list(p.reasons, DRAFT_COUNTS.reasons, PRODUCT_LIMITS.item, facts), template.products[0]?.reasons ?? [], DRAFT_COUNTS.reasons) });
    if (products.length >= DRAFT_COUNTS.products) break;
  }

  const personas: PersonaIdea[] = [];
  for (const p of a.personas) {
    const name = text(p.name, PERSONA_LIMITS.name, facts);
    if (!name || personas.some((x) => sameKey(x.name) === sameKey(name))) continue;
    const t = template.personas[personas.length % template.personas.length];
    const places = new Set<string>(ONLINE_PLACES);
    personas.push({
      name,
      ageRange: p.ageRange,
      gender: p.gender,
      location: text(p.location, PERSONA_LIMITS.location, facts) || t.location,
      occupation: text(p.occupation, PERSONA_LIMITS.occupation, facts),
      needs: topUp(list(p.needs, DRAFT_COUNTS.personaLines, PERSONA_LIMITS.line, facts), t.needs, 2),
      pains: topUp(list(p.pains, DRAFT_COUNTS.personaLines, PERSONA_LIMITS.line, facts), t.pains, 2),
      triggers: topUp(list(p.triggers, DRAFT_COUNTS.personaLines, PERSONA_LIMITS.line, facts), t.triggers, 2),
      channels: topUp(
        p.channels.filter((c) => places.has(c)),
        t.channels,
        2,
      ),
    });
    if (personas.length >= DRAFT_COUNTS.personas) break;
  }

  const faqs: QuizDraft["faqs"] = [];
  for (const f of a.faqs) {
    const question = text(f.question, FAQ_LIMITS.question, facts);
    const answer = text(f.answer, FAQ_LIMITS.answer, facts);
    if (!question || !answer || [...ctx.faqs, ...faqs.map((x) => x.question)].some((q) => sameKey(q) === sameKey(question))) continue;
    faqs.push({ question, answer });
    if (faqs.length >= DRAFT_COUNTS.faqs) break;
  }
  for (const f of template.faqs) {
    if (faqs.length >= DRAFT_COUNTS.faqs) break;
    if (!faqs.some((x) => sameKey(x.question) === sameKey(f.question))) faqs.push(f);
  }

  const voices: VoiceOption[] = [];
  for (const v of a.voices) {
    const option = voiceFrom(v, facts, `v${voices.length + 1}`, VOICE_EMOJI[voices.length] ?? "✨");
    if (option) voices.push(option);
    if (voices.length >= DRAFT_COUNTS.voices) break;
  }
  for (const t of template.voices) {
    if (voices.length >= DRAFT_COUNTS.voices) break;
    voices.push({ ...t, id: `v${voices.length + 1}` });
  }

  const languages = list(a.languages, DRAFT_COUNTS.languages, PROFILE_LIMITS.language, facts);

  return {
    taglines: topUp(list(a.taglines, DRAFT_COUNTS.taglines, PROFILE_LIMITS.tagline, facts), template.taglines, DRAFT_COUNTS.taglines),
    about: text(a.about, 600, facts) || template.about,
    missions: topUp(list(a.missions, DRAFT_COUNTS.missions, PROFILE_LIMITS.mission, facts), template.missions, DRAFT_COUNTS.missions),
    values: topUp(list(a.values, DRAFT_COUNTS.values, PROFILE_LIMITS.value, facts), template.values, DRAFT_COUNTS.values),
    languages: languages.length ? languages : template.languages,
    products: products.length ? products : template.products,
    personas: [...personas, ...template.personas.filter((t) => !personas.some((p) => sameKey(p.name) === sameKey(t.name)))].slice(0, DRAFT_COUNTS.personas),
    competitors: topUp(list(a.competitors, DRAFT_COUNTS.competitors, COMPETITOR_LIMITS.name, facts, ctx.competitors), template.competitors, DRAFT_COUNTS.competitors),
    differentiators: topUp(list(a.differentiators, DRAFT_COUNTS.differentiators, COMPETITOR_LIMITS.differentiator, facts), template.differentiators, DRAFT_COUNTS.differentiators),
    positioning: topUp(list(a.positioning, DRAFT_COUNTS.positioning, COMPETITOR_LIMITS.statement, facts), template.positioning, DRAFT_COUNTS.positioning),
    faqs,
    policies: {
      delivery: a.policies.delivery === "unsure" ? template.policies.delivery : a.policies.delivery,
      returns: a.policies.returns === "unsure" ? template.policies.returns : a.policies.returns,
      booking: a.policies.booking === "unsure" ? template.policies.booking : a.policies.booking,
      payment: a.policies.payment.length ? PAYMENT_METHODS.filter((m) => a.policies.payment.includes(m)) : template.policies.payment,
    },
    voices,
    source: "ai",
  };
}

/** The draft from the AI's raw text (JSON, maybe in a code fence); the template when it cannot be read. */
export function parseDraft(textValue: string, ctx: QuizContext, template: QuizDraft): QuizDraft {
  try {
    return sanitizeDraft(JSON.parse(textValue.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")), ctx, template);
  } catch {
    return template;
  }
}

// ---- The template ------------------------------------------------------------------------------------------------

type Kit = {
  kind: ProductKindValue;
  values: string[];
  reasons: string[];
  personas: Omit<PersonaIdea, "location">[];
  competitors: string[];
  differentiators: string[];
  faqs: { question: string; answer: string }[];
  delivery: PolicyChoice<"delivery"> | "";
  returns: PolicyChoice<"returns"> | "";
  booking: PolicyChoice<"booking"> | "";
};

const ASK = "Message us and we will tell you.";

const GENERIC: Kit = {
  kind: "SERVICE",
  values: ["Honesty", "Quality", "Respect for customers", "Reliability", "Fast service", "Community"],
  reasons: ["Friendly, personal service", "Quality you can count on", "Easy to order by phone or WhatsApp"],
  personas: [
    { name: "Busy working adult", ageRange: "25-34", gender: "any", occupation: "Office worker", needs: ["Save time", "Good quality"], pains: ["Slow service", "Unclear prices"], triggers: ["A friend's recommendation", "A quick reply on WhatsApp"], channels: ["WhatsApp", "Instagram"] },
    { name: "Careful family buyer", ageRange: "35-44", gender: "female", occupation: "Parent", needs: ["Value for money", "Something the family can trust"], pains: ["Poor quality", "Being let down"], triggers: ["Good reviews", "A clear price"], channels: ["WhatsApp", "Facebook"] },
    { name: "Young trend seeker", ageRange: "18-24", gender: "any", occupation: "Student", needs: ["Something new", "A good price"], pains: ["Boring choices", "Long waits"], triggers: ["A post that catches their eye", "Something their friends like"], channels: ["TikTok", "Instagram"] },
  ],
  competitors: ["Other shops nearby", "Big supermarkets", "Sellers on Instagram", "Markets"],
  differentiators: ["Personal service", "We know our customers by name", "Easy to reach on WhatsApp", "Quality we stand behind"],
  faqs: [
    { question: "Where are you?", answer: "Message us and we will send you our location." },
    { question: "How can I order?", answer: "Message us on WhatsApp or call us, and we will help you." },
    { question: "How can I pay?", answer: ASK },
    { question: "Do you deliver?", answer: "Message us with your location and we will tell you." },
    { question: "When are you open?", answer: "See our opening hours, or message us any time." },
  ],
  delivery: "city",
  returns: "exchange",
  booking: "whatsapp",
};

const KITS: { match: RegExp; kit: Partial<Kit> }[] = [
  {
    match: /food|restaurant|caf[eé]|bakery|bake|juice|catering|coffee|kitchen|snack|drink|butcher|grocer/i,
    kit: {
      kind: "PHYSICAL",
      values: ["Fresh every day", "Clean kitchen", "Local ingredients", "Friendly service", "Fair prices", "Family"],
      reasons: ["Made fresh", "Tastes like home", "Ready when you need it"],
      competitors: ["Other restaurants nearby", "Supermarket food", "Home cooking", "Food delivery apps"],
      returns: "noFood",
      booking: "walkIn",
      differentiators: ["Fresh, made the same day", "Local ingredients", "Friendly, quick service", "A clean, welcoming place"],
      faqs: [
        { question: "Do you deliver?", answer: "Message us with your location and we will tell you." },
        { question: "Can I order for an event?", answer: "Yes, message us with the date and how many people, and we will help." },
        { question: "What is on the menu today?", answer: ASK },
        { question: "How can I pay?", answer: ASK },
        { question: "Where are you?", answer: "Message us and we will send you our location." },
      ],
    },
  },
  {
    match: /beauty|salon|hair|barber|spa|cosmetic|nail|makeup|make-up/i,
    kit: {
      kind: "SERVICE",
      values: ["Care", "Hygiene", "Style", "Respect for your time", "Confidence", "Quality products"],
      reasons: ["Skilled, careful hands", "Clean and relaxing place", "Looks that last"],
      competitors: ["Other salons nearby", "Home stylists", "Beauty shops"],
      delivery: "pickup",
      returns: "",
      booking: "whatsapp",
      differentiators: ["Skilled team", "Clean tools every time", "We listen to what you want", "On time"],
      faqs: [
        { question: "Do I need to book?", answer: "Booking is best: message us with the day and time you want." },
        { question: "What services do you offer?", answer: "Message us and we will send you our list." },
        { question: "How much does it cost?", answer: "Prices depend on the service: message us and we will tell you." },
        { question: "Where are you?", answer: "Message us and we will send you our location." },
        { question: "How can I pay?", answer: ASK },
      ],
    },
  },
  {
    match: /fashion|cloth|tailor|kitenge|shoe|boutique|wear|dress|textile/i,
    kit: {
      kind: "PHYSICAL",
      values: ["Style", "Quality fabric", "Made with care", "Fair prices", "Proudly local", "Personal service"],
      reasons: ["Unique style", "Good fabric", "Made to fit you"],
      competitors: ["Other boutiques", "Second-hand markets", "Online sellers"],
      booking: "walkIn",
      differentiators: ["Pieces you will not see everywhere", "Good fabric", "Made to measure", "Friendly advice on what suits you"],
      faqs: [
        { question: "Do you make to measure?", answer: ASK },
        { question: "What sizes do you have?", answer: "Message us with what you like and we will tell you the sizes we have." },
        { question: "Do you deliver?", answer: "Message us with your location and we will tell you." },
        { question: "Can I return or exchange?", answer: ASK },
        { question: "How can I pay?", answer: ASK },
      ],
    },
  },
  {
    match: /tech|software|\bapp\b|digital|computer|phone|electronic|\bit\b|internet|web/i,
    kit: {
      kind: "DIGITAL",
      values: ["Reliability", "Simplicity", "Support that answers", "Innovation", "Security", "Honesty"],
      reasons: ["Easy to use", "Saves you time", "Help when you need it"],
      competitors: ["Bigger international brands", "Local IT shops", "Doing it by hand"],
      delivery: "country",
      returns: "refund",
      booking: "online",
      differentiators: ["Local support that answers", "Simple to use", "Built for how business works here", "Honest advice"],
      faqs: [
        { question: "How do I get started?", answer: "Message us and we will set you up." },
        { question: "Do you offer support?", answer: "Yes, message us and we will help you." },
        { question: "How much does it cost?", answer: "Message us and we will tell you the price for your needs." },
        { question: "Can I try it first?", answer: ASK },
        { question: "How can I pay?", answer: ASK },
      ],
    },
  },
];

function kitFor(ctx: QuizContext): Kit {
  const hay = [ctx.industry, ctx.about].filter(Boolean).join(" ");
  const found = KITS.find((k) => k.match.test(hay));
  return { ...GENERIC, ...found?.kit };
}

function guessLanguages(ctx: QuizContext): string[] {
  const out: string[] = [];
  if (/rwanda/i.test(ctx.country ?? "")) out.push("Kinyarwanda");
  out.push("English");
  if (ctx.contentLanguage && !out.some((l) => l.toLowerCase() === ctx.contentLanguage!.toLowerCase()) && (COMMON_LANGUAGES as readonly string[]).includes(ctx.contentLanguage)) out.push(ctx.contentLanguage);
  return out;
}

function templateVoices(name: string, what: string): VoiceOption[] {
  const v = (id: string, label: string, emoji: string, voice: string, d: string[], dont: string[], sample: string): VoiceOption => {
    const s = clean(sample, SUMMARY_LIMITS.sample);
    return { id, label, emoji, summary: { voice, do: d, dont, samples: [s] }, sample: s };
  };
  return [
    v("v1", "Warm and friendly", "😊", "Warm, friendly and close, like a neighbour who knows you. Simple words and a smile in every line.", ["Talk to one person, using “you”", "Keep it simple and kind", "End with an easy next step"], ["Sound stiff or cold", "Use jargon"], `Hello friends! 👋 At ${name} we love helping you with ${what}. Drop by or send us a message, we're happy to help! 😊`),
    v("v2", "Professional", "💼", "Professional and confident. Clear facts, polite and calm, so customers trust you.", ["Be clear and precise", "Stay polite and calm", "Say exactly how to order or book"], ["Use slang", "Overuse emojis"], `${name} offers ${what} you can rely on. Contact us today to find out how we can help you.`),
    v("v3", "Bold and fun", "⚡", "Bold, playful and full of energy. Short punchy lines that make people stop scrolling.", ["Open with a hook", "Use short, punchy lines", "Have fun with words"], ["Be boring", "Write long paragraphs"], `Ready for something good? 🔥 ${name} is here for ${what}. Come see what the fuss is about! ⚡`),
  ];
}

/** The guesses without the AI: from the business's own words and the kit of its industry. Never invents a fact. */
export function templateDraft(ctx: QuizContext): QuizDraft {
  const kit = kitFor(ctx);
  const name = clean(ctx.businessName, 80) || "We";
  const industry = clean(ctx.industry, 60);
  const what = industry ? industry.toLowerCase() : "what you need";
  const place = clean(ctx.area, 80) || clean(ctx.country, 80) || "Rwanda";
  const about = clean(ctx.about, 600);
  return {
    taglines: [`${name}: ${industry || "quality"} you can count on`, `Made for you, by ${name}`, industry ? `Your ${what} people in ${place}` : `Proudly serving ${place}`].map((t) => clean(t, PROFILE_LIMITS.tagline)),
    about: about || (industry ? clean(`${name} is a ${what} business serving customers in ${place}.`, 600) : ""),
    missions: [`To give every customer ${what} they can trust.`, `To make life easier for people in ${place}.`, `To grow with our community and serve it well.`].map((m) => clean(m, PROFILE_LIMITS.mission)),
    values: kit.values.slice(0, DRAFT_COUNTS.values),
    languages: guessLanguages(ctx),
    products: [],
    personas: kit.personas.map((p) => ({ ...p, location: clean(place, PERSONA_LIMITS.location) })),
    competitors: kit.competitors.filter((c) => !ctx.competitors.some((x) => sameKey(x) === sameKey(c))).slice(0, DRAFT_COUNTS.competitors),
    differentiators: kit.differentiators.slice(0, DRAFT_COUNTS.differentiators),
    positioning: [
      `For people in ${place} who want ${what} they can trust, ${name} offers friendly service and quality we stand behind.`,
      `${name} makes ${what} simple: easy to reach, quick to answer and always honest.`,
      `Unlike the rest, ${name} knows its customers and treats each one personally.`,
    ].map((p) => clean(p, COMPETITOR_LIMITS.statement)),
    faqs: kit.faqs.filter((f) => !ctx.faqs.some((q) => sameKey(q) === sameKey(f.question))).slice(0, DRAFT_COUNTS.faqs),
    policies: { delivery: kit.delivery, returns: kit.returns, booking: kit.booking, payment: ["mtn_momo", "cash"] },
    voices: templateVoices(name, what),
    source: "template",
  };
}

/** Reasons to suggest for a product the owner added themselves (no AI ideas for it). */
export function reasonIdeas(ctx: QuizContext): string[] {
  return kitFor(ctx).reasons;
}

/** The kind of thing this business most likely sells (the first tile picked for a new product). */
export function likelyKind(ctx: QuizContext): ProductKindValue {
  return kitFor(ctx).kind;
}

