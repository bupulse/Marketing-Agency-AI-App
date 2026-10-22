import { describe, expect, it } from "vitest";
import { emptyLocation, type BrandValues } from "@/components/brand-profile/steps";
import { validateKnowledge } from "@/lib/brand/schemas";
import { personaInputSchema, EMPTY_PERSONA } from "@/lib/knowledge/audience";
import { positioningSchema } from "@/lib/knowledge/competitors";
import { summarySchema } from "@/lib/knowledge/interview";
import { EMPTY_POLICIES, faqInputSchema, policiesSchema } from "@/lib/knowledge/policies";
import { productInputSchema } from "@/lib/knowledge/products";
import { profileInputSchema, type ProfileFormValues } from "@/lib/knowledge/profile";
import { templateDraft, type QuizContext } from "@/lib/knowledge/quiz-draft";
import {
  EMPTY_NOTE,
  lookSaveFrom,
  paletteOptions,
  photosSaveFrom,
  photoStepId,
  photoTargets,
  policyTitle,
  QUIZ_ROUND_IDS,
  reviewInputsFrom,
  roundForSection,
  type PhotoTarget,
  alignFaqs,
  faqTopic,
  HOURS_PRESETS,
  hoursChoiceOf,
  initialAnswers,
  knowledgeInputFrom,
  newCompetitorNames,
  newFaqsFrom,
  newProductNames,
  personaSavesFrom,
  policiesFrom,
  policyAnswerOf,
  policyOptions,
  positioningFrom,
  productDefaults,
  productInputsFrom,
  productStepId,
  profileInputFrom,
  quizSteps,
  reviewInputFrom,
  stepForField,
  stepProblem,
  storedPersonaKey,
  VOICE_RULES,
  voiceSaveFrom,
  type Given,
  type QuizAnswers,
  type QuizStored,
} from "@/lib/knowledge/quiz-map";
import { reviewInputSchema } from "@/lib/knowledge/reviews";

// Placeholder business (fixtures use fake names and +250788000000-style phones).
const ctx: QuizContext = {
  businessName: "Inzozi Bakery",
  industry: "Bakery",
  country: "Rwanda",
  area: "Kigali",
  about: "We bake bread and cakes every morning.",
  audience: "Families and office workers",
  website: null,
  contentLanguage: "English",
  products: [],
  personas: [],
  competitors: [],
  faqs: [],
};
const draft = templateDraft(ctx);
const places = { city: "Kigali", country: "Rwanda", type: "food" as const };

const all: Given = () => true;
const none: Given = () => false;
const except = (...ids: string[]): Given => (id) => !ids.includes(id);

const profile: ProfileFormValues = {
  name: "Inzozi Bakery",
  industry: "food",
  industryOther: "",
  industryDescription: "We bake bread and cakes for families in Kigali",
  tagline: "Fresh every morning",
  mission: "",
  vision: "Bread on every table",
  about: "We bake bread and cakes every morning.",
  yearFounded: "2019",
  size: "2-5",
  legalName: "Inzozi Bakery Ltd",
  registrationNumber: "123456789",
  website: "",
  serviceArea: "Kigali",
  languages: ["Kinyarwanda"],
  values: ["Fresh"],
  achievements: ["Best bakery 2024"],
};

const brand: BrandValues = {
  description: "Bakery",
  audience: "Families",
  tone: "",
  logoPath: null,
  brandColors: [],
  openingHours: [],
  hours: "Closed on public holidays",
  area: "Kigali",
  locations: [emptyLocation("head"), { ...emptyLocation("branch"), label: "Kimironko", address: "Kimironko market, Kigali" }],
  contacts: [{ type: "whatsapp", value: "", country: "Rwanda", primary: true }],
  contact: "",
  faqs: [{ question: "Do you bake on Sunday?", answer: "Yes." }],
};

const stored: QuizStored = {
  profile,
  products: ["Sourdough loaf"],
  personas: [{ id: "p1", ...EMPTY_PERSONA, name: "Office worker", ageRange: "25-34", location: "Kigali", needs: ["Quick breakfast"] }],
  competitors: ["Supermarket bakery"],
  positioning: { differentiators: ["Baked this morning"], statement: null },
  policies: { ...EMPTY_POLICIES, warranty: "Fresh or we replace it", paymentNotes: "Pay on pickup", paymentMethods: ["cash"] },
  faqs: ["Do you deliver?"],
  brand,
  voice: null,
  voiceAnswers: [],
  photoless: [],
  productIds: {},
  look: { logoPath: null, logoUrl: null, colors: [] },
  connected: false,
};

const answers = (patch: Partial<{ [K in keyof QuizAnswers]: Partial<QuizAnswers[K]> }> = {}): QuizAnswers => {
  const base = initialAnswers(stored, draft, { likelyKind: "PHYSICAL", places }).answers;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) out[k] = { ...(base as Record<string, object>)[k], ...v };
  return out as QuizAnswers;
};

describe("🏠 You -> saveProfile", () => {
  it("keeps every stored field the quiz does not ask, and the skipped ones", () => {
    const input = profileInputFrom(profile, { ...answers().you, tagline: "Bread with love", mission: "Feed Kigali well", values: ["Fresh", "Family"] }, except("you.values"));
    expect(input).toMatchObject({ tagline: "Bread with love", mission: "Feed Kigali well", values: ["Fresh"], vision: "Bread on every table", legalName: "Inzozi Bakery Ltd", achievements: ["Best bakery 2024"], serviceArea: "Kigali", name: "Inzozi Bakery" });
    expect(profileInputSchema(new Date("2026-10-22")).safeParse(input).success).toBe(true);
  });

  it("never wipes with an empty answer", () => {
    const input = profileInputFrom(profile, { ...answers().you, tagline: "  ", languages: [], yearFounded: "" }, all);
    expect(input.tagline).toBe("Fresh every morning");
    expect(input.languages).toEqual(["Kinyarwanda"]);
    expect(input.yearFounded).toBe("2019");
  });

  it("skipping everything gives back what is stored", () => {
    expect(profileInputFrom(profile, { tagline: "x", about: "y", size: "solo", yearFounded: "2000", languages: ["French"], values: ["X"], mission: "z", vision: "v", website: "x.rw" }, none)).toEqual(profile);
  });

  it("fills a too-short sign-up description from what you do, so the save does not fail on it", () => {
    const input = profileInputFrom({ ...profile, industryDescription: "Bakery" }, answers().you, all);
    expect(input.industryDescription).toBe(profile.about);
  });
});

describe("🛍️ What you sell -> createProduct", () => {
  const sell = { picked: ["Sourdough loaf", "Birthday cake", "birthday cake ", "Croissant"], details: { "birthday cake": { kind: "PHYSICAL" as const, price: "15,000", onRequest: false, reason: "Made to order" }, croissant: { kind: "PHYSICAL" as const, price: "", onRequest: true, reason: "" } } };

  it("asks only about new products, once each", () => {
    expect(newProductNames(stored.products, sell.picked)).toEqual(["Birthday cake", "Croissant"]);
  });

  it("creates drafts for the answered ones, valid for the product schema", () => {
    const items = productInputsFrom(stored.products, sell, [], "RWF", except(productStepId("Croissant")));
    expect(items.map((i) => i.name)).toEqual(["Birthday cake"]);
    const parsed = productInputSchema.safeParse(items[0].input);
    expect(parsed.success && parsed.data).toMatchObject({ status: "DRAFT", priceModel: "FIXED", priceAmount: 15000, usps: ["Made to order"] });
  });

  it("no price typed is 'Ask for price', never an invented price; a missing reason is refused by the schema", () => {
    const [croissant] = productInputsFrom(stored.products, { ...sell, picked: ["Croissant"] }, [], "RWF", all);
    expect(croissant.input).toMatchObject({ priceModel: "ON_REQUEST", price: "" });
    expect(productInputSchema.safeParse(croissant.input).success).toBe(false); // no reason
    const [noPrice] = productInputsFrom(stored.products, { picked: ["Bagel"], details: { bagel: { kind: "PHYSICAL", price: " ", onRequest: false, reason: "Soft" } } }, [], "RWF", all);
    expect(noPrice.input).toMatchObject({ priceModel: "ON_REQUEST", price: "" });
    expect(productInputSchema.safeParse(noPrice.input).success).toBe(true);
  });

  it("an owner-added product starts with a reason picked and 'Ask for price', so it saves as it is", () => {
    const d = productDefaults("Passion Juice", draft.products, "PHYSICAL", ["Made fresh", "Local fruit"]);
    expect(d).toEqual({ kind: "PHYSICAL", price: "", onRequest: true, reason: "Made fresh" });
    const a = answers({ sell: { picked: ["Passion Juice"], details: { "passion juice": d } } });
    expect(stepProblem(productStepId("Passion Juice"), a, draft.products, "RWF")).toBeNull();
    const [item] = productInputsFrom(stored.products, a.sell, draft.products, "RWF", all);
    expect(productInputSchema.safeParse(item.input).success).toBe(true);
  });

  it("checks a product's question on Next with the product schema", () => {
    const a = answers({ sell: { picked: ["Passion Juice"], details: { "passion juice": { kind: "PHYSICAL", price: "abc", onRequest: false, reason: "" } } } });
    expect(stepProblem(productStepId("Passion Juice"), a, [], "RWF")).toBe("Add at least one reason to choose it.");
    a.sell.details["passion juice"].reason = "Fresh";
    expect(stepProblem(productStepId("Passion Juice"), a, [], "RWF")).toMatch(/Enter a number/);
    a.sell.details["passion juice"].price = "1,500";
    expect(stepProblem(productStepId("Passion Juice"), a, [], "RWF")).toBeNull();
    expect(stepProblem("love.quote.0", { ...answers(), love: [{ ...EMPTY_NOTE, quote: "Great!" }] }, [], "RWF")).toMatch(/name/);
    expect(stepProblem("you.tagline", a, [], "RWF")).toBeNull();
  });

  it("a skipped pick creates nothing", () => {
    expect(productInputsFrom(stored.products, sell, [], "RWF", except("sell.pick"))).toEqual([]);
  });
});

describe("👥 Your customers -> createPersona / updatePersona", () => {
  it("updates the stored main persona with the answers, keeping its other fields", () => {
    const saves = personaSavesFrom(stored.personas, draft.personas, { ...answers().customers, picked: [storedPersonaKey("p1")], gender: "female", pains: ["Queues"] }, all);
    expect(saves).toHaveLength(1);
    expect(saves[0].id).toBe("p1");
    expect(saves[0].input).toMatchObject({ name: "Office worker", location: "Kigali", gender: "female", pains: ["Queues"], needs: ["Quick breakfast"] });
    expect(personaInputSchema.safeParse(saves[0].input).success).toBe(true);
  });

  it("creates a picked idea, and leaves a second stored persona alone", () => {
    const two = [...stored.personas, { ...stored.personas[0], id: "p2", name: "Student" }];
    const saves = personaSavesFrom(two, draft.personas, { ...answers().customers, picked: ["idea:1", storedPersonaKey("p2")] }, all);
    expect(saves).toHaveLength(1);
    expect(saves[0].id).toBeUndefined();
    expect(saves[0].input.name).toBe(draft.personas[1].name);
    expect(personaInputSchema.safeParse(saves[0].input).success).toBe(true);
  });

  it("skipped questions keep the persona's own values", () => {
    const [save] = personaSavesFrom(stored.personas, draft.personas, { ...answers().customers, needs: ["Something else"] }, except("customers.needs"));
    expect(save.input.needs).toEqual(["Quick breakfast"]);
  });
});

describe("⭐ Why you -> createCompetitor, savePositioning", () => {
  it("adds only new competitors and merges the positioning", () => {
    const why = { competitors: ["supermarket bakery", "Street sellers"], differentiators: ["Baked this morning", "Family recipe"], statement: "For families who want fresh bread." };
    expect(newCompetitorNames(stored.competitors, why, all)).toEqual(["Street sellers"]);
    const positioning = positioningFrom(stored.positioning, why, all);
    expect(positioning).toEqual({ differentiators: ["Baked this morning", "Family recipe"], statement: "For families who want fresh bread." });
    expect(positioningSchema.safeParse(positioning).success).toBe(true);
  });

  it("saves nothing when nothing changed", () => {
    expect(positioningFrom(stored.positioning, { competitors: [], differentiators: [], statement: "" }, all)).toBeNull();
    expect(positioningFrom(stored.positioning, { competitors: [], differentiators: ["New"], statement: "New" }, none)).toBeNull();
  });
});

describe("📋 Rules -> savePolicies, createFaq", () => {
  it("keeps the policy fields the quiz does not ask; a tile is its policy sentence", () => {
    const next = policiesFrom(stored.policies, { ...answers().rules, payment: ["mtn_momo", "cash"], delivery: { choice: "city", text: "" }, returns: { choice: "other", text: "Talk to us within a day." }, booking: { choice: "", text: "" } }, all, places);
    expect(next).toMatchObject({
      warranty: "Fresh or we replace it",
      paymentNotes: "Pay on pickup",
      paymentMethods: ["mtn_momo", "cash"],
      delivery: "We deliver in Kigali. Message us with your address.",
      returns: "Talk to us within a day.",
      booking: null,
    });
    expect(policiesSchema.safeParse(next).success).toBe(true);
    expect(policiesFrom(stored.policies, answers().rules, none, places)).toBeNull();
  });

  it("offers clear common answers as tiles, plus Something else", () => {
    const shop = { ...places, type: "goods" as const };
    expect(policyOptions("delivery", shop).map((o) => o.label)).toEqual(["No delivery, pick-up only", "We deliver in Kigali", "We deliver across Rwanda", "Through a delivery app", "Something else"]);
    expect(policyOptions("returns", places).map((o) => o.label)).toEqual(["No returns on food and drinks", "We replace a wrong order", "Something else"]);
    expect(policyOptions("returns", shop).map((o) => o.label)).toEqual(["Exchange within 7 days with the receipt", "Refund within 7 days", "No returns once sold", "Something else"]);
    expect(policyOptions("booking", places).map((o) => o.label)).toEqual(["No booking, just walk in", "Book by WhatsApp or a call", "Book online", "Something else"]);
    expect(policyOptions("delivery", { city: "", country: "" })[1].label).toBe("We deliver in town");
  });

  it("shows a stored policy as its tile, or as Something else with its words", () => {
    expect(policyAnswerOf("booking", "no booking needed - just walk in", places)).toEqual({ choice: "walkIn", text: "" });
    expect(policyAnswerOf("returns", "We swap sizes for free.", places)).toEqual({ choice: "other", text: "We swap sizes for free." });
    expect(policyAnswerOf("delivery", null, places)).toEqual({ choice: "", text: "" });
    const { answers: a, guessed } = initialAnswers({ ...stored, policies: { ...stored.policies, booking: "Book online." } }, draft, { likelyKind: "PHYSICAL", places });
    expect(a.rules.booking).toEqual({ choice: "online", text: "" });
    expect(a.rules.returns.choice).toBe("noFood"); // the bakery's likeliest, as a guess
    expect(guessed).toContain("rules.returns");
    expect(guessed).not.toContain("rules.booking");
  });

  it("creates the kept questions that are not stored yet", () => {
    const rules = { ...answers().rules, faqs: [{ id: "a", question: "Do you deliver?", answer: "Yes" }, { id: "b", question: "Can I order a cake?", answer: "Yes, two days before." }, { id: "c", question: "Dropped one", answer: "x" }], faqKept: ["a", "b"] };
    const faqs = newFaqsFrom(stored.faqs, rules, all);
    expect(faqs).toEqual([{ question: "Can I order a cake?", answer: "Yes, two days before." }]);
    expect(faqInputSchema.safeParse(faqs[0]).success).toBe(true);
    expect(newFaqsFrom(stored.faqs, rules, none)).toEqual([]);
  });
});

describe("📋 Rules: the questions never contradict the tiles", () => {
  const rules = (patch: Partial<QuizAnswers["rules"]> = {}): QuizAnswers["rules"] => ({
    ...answers().rules,
    payment: ["mtn_momo", "cash"],
    delivery: { choice: "pickup", text: "" },
    returns: { choice: "noFood", text: "" },
    booking: { choice: "walkIn", text: "" },
    faqs: [
      { id: "idea-0", question: "Do you deliver?", answer: "Message us with your location and we will tell you." },
      { id: "idea-1", question: "How can I pay?", answer: "Message us and we will tell you." },
      { id: "idea-2", question: "Do I need to book?", answer: "Booking is best." },
      { id: "idea-3", question: "Can I return or exchange?", answer: "Message us and we will tell you." },
      { id: "idea-4", question: "What is on the menu today?", answer: "Message us and we will tell you." },
    ],
    faqKept: ["idea-0", "idea-1", "idea-2", "idea-3", "idea-4"],
    faqEdited: [],
    ...patch,
  });

  it("answers delivery, payment, booking and returns from what was picked, with the stored address", () => {
    const faqs = alignFaqs(rules(), { ...places, address: "KN 4 Ave, Kiyovu, Kigali" });
    expect(faqs.map((f) => f.answer)).toEqual([
      "No, we don't deliver. You can pick up at KN 4 Ave, Kiyovu, Kigali.",
      "You can pay by MTN Mobile Money or Cash.",
      "No booking needed: just walk in.",
      "We do not take returns on food and drinks.",
      "Message us and we will tell you.", // not about a policy: as BuPulse wrote it
    ]);
    expect(alignFaqs(rules(), places)[0].answer).toBe("No, we don't deliver. You can pick up at our place.");
    expect(alignFaqs(rules({ delivery: { choice: "city", text: "" } }), places)[0].answer).toBe("Yes. We deliver in Kigali. Message us with your address.");
  });

  it("keeps the idea's answer when nothing was picked for its topic, and the owner's own words always", () => {
    const none = alignFaqs(rules({ delivery: { choice: "", text: "" }, payment: [] }), places);
    expect(none[0].answer).toBe("Message us with your location and we will tell you.");
    expect(none[1].answer).toBe("Message us and we will tell you.");
    const own = alignFaqs(rules({ faqs: [{ id: "idea-0", question: "Do you deliver?", answer: "Yes, on Saturdays." }], faqEdited: ["idea-0"] }), places);
    expect(own[0].answer).toBe("Yes, on Saturdays.");
  });

  it("saves the aligned answers", () => {
    const faqs = newFaqsFrom([], rules(), all, places);
    expect(faqs[0]).toEqual({ question: "Do you deliver?", answer: "No, we don't deliver. You can pick up at our place." });
    expect(faqs.every((f) => faqInputSchema.safeParse(f).success)).toBe(true);
  });

  it("knows the topic of a question", () => {
    expect(["Do you deliver?", "How much is delivery?", "Can I get a refund?", "Can I book a table?", "Do you take Mobile Money?", "Where are you?"].map(faqTopic)).toEqual(["delivery", "delivery", "returns", "booking", "payment", null]);
  });
});

describe("📍 Find us -> saveKnowledge", () => {
  it("saves nothing when the round was skipped or nothing changed", () => {
    expect(knowledgeInputFrom(brand, answers().find, none, "Rwanda")).toBeNull();
    const withAll = { ...brand, openingHours: HOURS_PRESETS.monSat, contacts: [{ type: "whatsapp" as const, value: "+250788000000", country: "Rwanda", primary: true }] };
    expect(knowledgeInputFrom(withAll, { hours: "monSat", custom: HOURS_PRESETS.weekdays[0], phone: "+250788000000", address: "" }, all, "Rwanda")).toBeNull();
  });

  it("puts the hours, phone and address on the whole stored card, which then passes the essentials check", () => {
    const input = knowledgeInputFrom(brand, { hours: "weekdays", custom: HOURS_PRESETS.weekdays[0], phone: "+250788000000", address: "KN 4 Ave, Kiyovu, Kigali" }, all, "Rwanda");
    expect(input).not.toBeNull();
    expect(input!.hours).toBe("Closed on public holidays");
    expect(input!.faqs).toEqual(brand.faqs);
    expect(input!.locations?.map((l) => l.address)).toEqual(["KN 4 Ave, Kiyovu, Kigali", "Kimironko market, Kigali"]);
    expect(input!.contacts?.[0]).toMatchObject({ type: "whatsapp", value: "+250788000000" });
    const checked = validateKnowledge(input!, { country: "Rwanda", requireEssentials: true });
    expect(checked.ok).toBe(true);
  });

  it("knows the presets back from stored hours", () => {
    expect(hoursChoiceOf([])).toBe("");
    expect(hoursChoiceOf(HOURS_PRESETS.always)).toBe("always");
    expect(hoursChoiceOf([{ days: ["sat"], open: "09:00", close: "13:00" }])).toBe("keep");
  });
});

describe("🎙️ Your voice -> approveVoice", () => {
  const voiceAnswers = { tone: "formal" as const, emojis: "no" as const, length: "short" as const, pick: "v2" };

  it("approves the picked post's voice with the this-or-that rules", () => {
    const save = voiceSaveFrom(null, draft.voices, voiceAnswers, all)!;
    expect(save.summary.voice).toBe(draft.voices[1].summary.voice);
    expect(save.summary.do).toEqual(expect.arrayContaining([VOICE_RULES.formal, VOICE_RULES.short]));
    expect(save.summary.dont).toContain(VOICE_RULES.emojisNo);
    expect(save.answers).toEqual([
      { topic: "formality", answer: "Formal" },
      { topic: "emojis", answer: "No emojis" },
      { topic: "followup", answer: "Post length: short" },
    ]);
    expect(summarySchema.safeParse(save.summary).success).toBe(true);
  });

  it("played again, the rules are replaced, not added twice", () => {
    const once = voiceSaveFrom(null, draft.voices, voiceAnswers, all)!.summary;
    const again = voiceSaveFrom(once, draft.voices, { ...voiceAnswers, tone: "friendly", emojis: "yes", pick: "keep" }, all)!.summary;
    expect(again.do).toContain(VOICE_RULES.friendly);
    expect(again.do).not.toContain(VOICE_RULES.formal);
    expect(again.dont).not.toContain(VOICE_RULES.emojisNo);
    expect(again.do.filter((l) => l === VOICE_RULES.short)).toHaveLength(1);
  });

  it("a skipped round with no voice saves nothing", () => {
    expect(voiceSaveFrom(null, draft.voices, voiceAnswers, none)).toBeNull();
    expect(voiceSaveFrom(null, draft.voices, voiceAnswers, except("voice.pick"))).toBeNull();
  });
});

describe("💬 Love notes -> createReview", () => {
  it("saves a pasted review; consent only when the question was answered yes", () => {
    const love = { quote: "Best bread in town!", customerName: "Aline K.", source: "WHATSAPP" as const, canPublish: true };
    const input = reviewInputFrom(love, all, 0)!;
    expect(input).toMatchObject({ quote: "Best bread in town!", customerName: "Aline K.", source: "WHATSAPP", canPublish: true });
    expect(reviewInputSchema("2026-10-22").safeParse(input).success).toBe(true);
    expect(reviewInputFrom(love, except("love.consent.0"))!.canPublish).toBe(false);
  });

  it("no quote, no review", () => {
    expect(reviewInputFrom({ quote: " ", customerName: "", source: "", canPublish: false }, all)).toBeNull();
    expect(reviewInputFrom({ quote: "Nice", customerName: "A", source: "", canPublish: false }, none)).toBeNull();
  });
});

describe("the questions", () => {
  it("keep their place when the products are saved (the start list is frozen)", () => {
    const a = answers({ sell: { picked: ["Birthday cake", "Croissant"] } });
    const before = quizSteps(["sell", "customers"], a, stored, { canGrant: true }).map((s) => s.id);
    const after = quizSteps(["sell", "customers"], a, { ...stored, products: [...stored.products, "Birthday cake", "Croissant"] }, { canGrant: true }).map((s) => s.id);
    // Read from what is stored now, the two product questions drop out and every later question moves up two places:
    // the quiz, at the same number, shows a customers question. The quiz builds its steps from the frozen start list.
    expect(after.length).toBe(before.length - 2);
    expect(after[before.indexOf(productStepId("Croissant"))]).toBe("customers.age");
    expect(quizSteps(["sell", "customers"], a, { ...stored, products: stored.products }, { canGrant: true }).map((s) => s.id)).toEqual(before);
  });

  it("leaves out the rounds the person cannot edit, and adds a question per new product", () => {
    const a = answers({ sell: { picked: ["Birthday cake", "Sourdough loaf"] } });
    const steps = quizSteps(["sell", "love"], a, stored, { canGrant: false });
    expect(steps.map((s) => s.id)).toEqual(["sell.pick", productStepId("Birthday cake"), "love.quote.0"]);
  });

  it("asks where a review came from only once there is one, and consent only of Owners and Admins", () => {
    const a = { ...answers(), love: [{ ...EMPTY_NOTE, quote: "Lovely" }, { ...EMPTY_NOTE }, { ...EMPTY_NOTE }] };
    expect(quizSteps(["love"], a, stored, { canGrant: true }).map((s) => s.id)).toEqual(["love.quote.0", "love.source.0", "love.consent.0", "love.quote.1"]);
    expect(quizSteps(["love"], a, stored, { canGrant: false }).map((s) => s.id)).toEqual(["love.quote.0", "love.source.0", "love.quote.1"]);
  });

  it("starts from what is stored, else BuPulse's guess (tagged)", () => {
    const { answers: a, guessed } = initialAnswers(stored, draft, { likelyKind: "PHYSICAL", places });
    expect(a.you.tagline).toBe("Fresh every morning");
    expect(guessed).not.toContain("you.tagline");
    expect(a.you.mission).toBe(draft.missions[0]);
    expect(guessed).toContain("you.mission");
    expect(a.customers.picked).toEqual([storedPersonaKey("p1")]);
    expect(a.rules.payment).toEqual(["cash"]);
    expect(a.rules.faqs.some((f) => f.question === "Do you deliver?")).toBe(false);
    expect(a.find.hours).toBe("monSat");
    expect(guessed).toContain("find.hours");
  });

  it("puts a field error on its question, others on the round's first", () => {
    expect(stepForField("find", "contacts.0.value", "find.hours")).toBe("find.phone");
    expect(stepForField("find", "locations.0.address", "find.hours")).toBe("find.address");
    expect(stepForField("you", "industry", "you.tagline")).toBe("you.tagline");
    expect(stepForField("love", "customerName", "x")).toBe("love.quote.0");
  });
});

describe("to 100%: the new questions", () => {
  it("asks a vision and a website in You, and keeps them when skipped", () => {
    const input = profileInputFrom(profile, { ...answers().you, vision: "Two shops by 2030", website: "inzozi.rw" }, all);
    expect(input).toMatchObject({ vision: "Two shops by 2030", website: "inzozi.rw" });
    expect(profileInputSchema(new Date("2026-10-22")).safeParse(input).success).toBe(true);
    expect(profileInputFrom(profile, { ...answers().you, vision: "New", website: "x.rw" }, except("you.vision", "you.website"))).toMatchObject({ vision: "Bread on every table", website: "" });
    expect(answers().you.vision).toBe("Bread on every table"); // stored first
    expect(initialAnswers({ ...stored, profile: { ...profile, vision: "" } }, draft, { likelyKind: "PHYSICAL", places }).answers.you.vision).toBe(draft.visions[0]);
  });

  it("has a Photos round after What you sell: stored products without a photo, and each new product, before it is saved", () => {
    const s = { ...stored, photoless: [{ id: "p1", name: "Sourdough loaf" }] };
    const a = answers({ sell: { picked: ["Birthday cake"] } });
    const before = photoTargets(s, a);
    expect(before).toEqual([
      { key: "p-p1", name: "Sourdough loaf", productId: "p1", isNew: false },
      { key: "n-birthday-cake", name: "Birthday cake", productId: null, isNew: true },
    ]);
    // Saved: the same question, now with the product's id (the round keeps its length).
    const after = photoTargets({ ...s, productIds: { "birthday cake": "p9" } }, a);
    expect(after.map((t) => t.key)).toEqual(before.map((t) => t.key));
    expect(after[1].productId).toBe("p9");
    const ids = quizSteps(["sell", "photos", "customers"], a, s, { canGrant: true }).map((x) => x.id);
    expect(ids.slice(0, 4)).toEqual(["sell.pick", productStepId("Birthday cake"), photoStepId("p-p1"), photoStepId("n-birthday-cake")]);
  });

  it("links the gallery picks and makes a new product with a photo active", () => {
    const targets: PhotoTarget[] = [
      { key: "p-p1", name: "Sourdough loaf", productId: "p1", isNew: false },
      { key: "n-cake", name: "Birthday cake", productId: "p9", isNew: true },
      { key: "n-bun", name: "Bun", productId: "p10", isNew: true },
    ];
    const photo = (id: string) => ({ id, url: `https://example.test/${id}.jpg`, kind: "photo" });
    const a = { added: { "n-cake": [photo("m1")] }, picked: { "p-p1": [photo("m2"), photo("m2")] } };
    expect(photosSaveFrom(targets, a, all)).toEqual({ links: [{ productId: "p1", assetIds: ["m2"] }], activate: ["p9"] });
    // Skipped: the picks are not linked; an upload is in the album already.
    expect(photosSaveFrom(targets, a, none)).toEqual({ links: [], activate: ["p9"] });
  });

  it("saves the logo and colours over what is stored, and nothing when unchanged", () => {
    const s = { logoPath: "u1/logo/old.png", logoUrl: null, colors: ["#111111"] };
    const look = { logoPath: "u1/logo/new.png", logoUrl: "blob:x", colors: ["#d63384", "#f8c8dc"], palette: "p0", logoColors: [] };
    expect(lookSaveFrom(s, look, all)).toEqual({ logoPath: "u1/logo/new.png", brandColors: ["#D63384", "#F8C8DC"] });
    expect(lookSaveFrom(s, look, except("look.colors"))).toEqual({ logoPath: "u1/logo/new.png", brandColors: ["#111111"] });
    expect(lookSaveFrom(s, look, none)).toBeNull();
    expect(paletteOptions({ logoColors: ["#000000"] }, s, [["#FFFFFF"]]).map((o) => o.id)).toEqual(["logo", "keep", "p0"]);
  });

  it("fits the policy tiles and guesses to a salon: no food returns", () => {
    const salon = templateDraft({ ...ctx, businessName: "Trial Salon", industry: "Hair and nail salon", about: "Hair and nails in Remera." });
    expect(salon.businessType).toBe("service");
    expect(salon.policies).toMatchObject({ delivery: "atPlace", returns: "redo", warranty: "satisfaction" });
    const service = { ...places, type: "service" as const };
    expect(policyOptions("returns", service).map((o) => o.label)).toEqual(["Free redo within 7 days if you're not happy", "No refunds after the service", "Something else"]);
    expect(policyOptions("warranty", service).map((o) => o.value)).toEqual(["work30", "satisfaction", "none", "other"]);
    expect(policyTitle("warranty", "service")).toBe("Do you guarantee your work?");
    expect(policyTitle("delivery", "service")).toBe("Where do you serve customers?");
    const { answers: a } = initialAnswers({ ...stored, policies: EMPTY_POLICIES }, salon, { likelyKind: "SERVICE", places: service });
    expect(a.rules.returns.choice).toBe("redo");
    // Every type's guesses are among its own tiles.
    for (const industry of ["Bakery", "Hair salon", "Kitenge fashion", "Software", null]) {
      const d = templateDraft({ ...ctx, industry, about: null });
      const t = { ...places, type: d.businessType };
      for (const kind of ["delivery", "returns", "warranty", "booking"] as const) {
        const guess = d.policies[kind];
        if (guess) expect(policyOptions(kind, t).map((o) => o.value), `${industry} ${kind}`).toContain(guess);
      }
    }
  });

  it("saves the warranty, and answers a guarantee question from it", () => {
    const rules = { ...answers().rules, warranty: { choice: "fresh", text: "" }, faqs: [{ id: "a", question: "Do you guarantee freshness?", answer: "Ask us." }], faqKept: ["a"], faqEdited: [] };
    expect(policiesFrom(stored.policies, rules, all, places)?.warranty).toBe("Everything is fresh; if it is not, we replace it.");
    expect(alignFaqs(rules, places)[0].answer).toBe("Everything is fresh; if it is not, we replace it.");
    const salon = { ...rules, delivery: { choice: "atPlace", text: "" }, faqs: [{ id: "b", question: "Do you deliver?", answer: "x" }] };
    expect(alignFaqs(salon, { ...places, type: "service", address: "KG 11 Ave, Remera" })[0].answer).toBe("No, customers come to us, at KG 11 Ave, Remera.");
  });

  it("takes up to 3 reviews, one slot after another", () => {
    const note = (quote: string) => ({ ...EMPTY_NOTE, quote, customerName: "A." });
    const a = { ...answers(), love: [note("One"), note("Two"), note("Three")] };
    const ids = quizSteps(["love"], a, stored, { canGrant: true }).map((x) => x.id);
    expect(ids.filter((x) => x.startsWith("love.quote"))).toEqual(["love.quote.0", "love.quote.1", "love.quote.2"]);
    expect(reviewInputsFrom(a.love, except("love.quote.1")).map((r) => [r.slot, r.input.quote])).toEqual([
      [0, "One"],
      [2, "Three"],
    ]);
    expect(stepProblem("love.quote.2", { ...a, love: [note("One"), note("Two"), { ...EMPTY_NOTE, quote: "No name" }] }, [], "RWF")).toMatch(/name/);
  });

  it("ends with Go live, and knows which round raises each section", () => {
    expect(quizSteps(["golive"], answers(), stored, { canGrant: true }).map((x) => x.id)).toEqual(["golive.connect"]);
    const all = QUIZ_ROUND_IDS;
    expect(roundForSection("products", { next: "Add photos to 3 products" }, all)).toBe("photos");
    expect(roundForSection("products", { next: "Add what you sell" }, all)).toBe("sell");
    expect(roundForSection("products", { next: "Add photos to 3 products" }, ["sell"])).toBe("sell");
    expect(roundForSection("brand", undefined, all)).toBe("look");
    expect(roundForSection("channels", undefined, all)).toBe("golive");
    expect(roundForSection("campaigns", undefined, all)).toBeNull();
  });
});
