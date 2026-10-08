import { describe, expect, it } from "vitest";
import type { BusinessFacts } from "@/lib/widget/prompt";

// Quality check of the website chat: 5 businesses x 4 questions with the real model. Runs only with
// AI_EVAL=1 and a real GEMINI_API_KEY (npm run ai:eval:widget); it costs cents.
const key = process.env.GEMINI_API_KEY;
const enabled = process.env.AI_EVAL === "1" && !!key && key !== "placeholder";

interface Case {
  id: string;
  facts: BusinessFacts;
  known: { q: string; mustInclude: RegExp };
  price: string;
  unknown: string;
  other: { q: string; language: RegExp };
}

const k = (o: Partial<BusinessFacts["knowledge"]>) => ({ hours: undefined, area: undefined, contact: undefined, faqs: [], ...o });

const cases: Case[] = [
  {
    id: "phone-shop",
    facts: { name: "TechHub Kigali", industry: "Phone store", description: "New and refurbished smartphones", contentLanguage: "English", knowledge: k({ hours: "Mon-Sat 8:00-19:00", area: "Kigali" }), projects: [{ type: "product", title: "Galaxy A55 128GB", price: "420,000 RWF", features: ["Dual SIM", "1-year warranty"] }] },
    known: { q: "What time do you open on Saturday?", mustInclude: /8/ },
    price: "How much is the Galaxy A55?",
    unknown: "Do you repair laptops?",
    other: { q: "Quelles sont vos heures d'ouverture ?", language: /\b(ouvert|heures|de|à|nous)\b/i },
  },
  {
    id: "school",
    facts: { name: "Lycée Les Cèdres", industry: "School", description: "Private bilingual school", contentLanguage: "French", knowledge: k({ contact: "admissions@lescedres.example", faqs: [{ question: "Y a-t-il un bus scolaire ?", answer: "Oui, dans toute la ville." }] }), projects: [] },
    known: { q: "Do you have a school bus?", mustInclude: /bus|city|ville/i },
    price: "How much are the school fees?",
    unknown: "Is there a swimming pool?",
    other: { q: "Habari, mnatoa masomo ya Kiingereza?", language: /\b(ni|na|kwa|ya|shule|samahani)\b/i },
  },
  {
    id: "salon",
    facts: { name: "Glow Studio", industry: "Beauty salon", description: "Hair, nails and skincare", contentLanguage: "Spanish", knowledge: k({ hours: "Lunes a sábado, 9:00-18:00" }), projects: [{ type: "offer", title: "Pack novia", price: "120 €", features: ["Prueba incluida"] }] },
    known: { q: "¿A qué hora abren los lunes?", mustInclude: /9/ },
    price: "¿Cuánto cuesta el pack novia?",
    unknown: "¿Hacen tatuajes?",
    other: { q: "Do you do bridal makeup?", language: /\b(the|we|you|our|bridal)\b/i },
  },
  {
    id: "clinic",
    facts: { name: "Afya Bora Clinic", industry: "Clinic", description: "Family health clinic: general practice and dental care", contentLanguage: "Swahili", knowledge: k({ hours: "Jumatatu hadi Jumamosi, saa 2 asubuhi hadi saa 12 jioni", area: "Dar es Salaam" }), projects: [] },
    known: { q: "Where are you located?", mustInclude: /Dar es Salaam/i },
    price: "How much is a dental check-up?",
    unknown: "Do you offer eye surgery?",
    other: { q: "Bonjour, avez-vous un dentiste ?", language: /\b(nous|dentaire|vous|notre|oui)\b/i },
  },
  {
    id: "builder",
    facts: { name: "Imara Builders", industry: "Construction", description: "Residential and commercial building contractor", contentLanguage: "English", knowledge: k({ area: "Kigali and surrounding districts", contact: "info@imara.example" }), projects: [{ type: "project", title: "Family home, Nyarutarama", price: null, features: ["4 bedrooms", "Solar water heating"] }] },
    known: { q: "Which areas do you build in?", mustInclude: /Kigali/i },
    price: "I want a quote to build a 3 bedroom house",
    unknown: "Can you build in Nairobi?",
    other: { q: "Je voudrais construire une maison, vous faites ça ?", language: /\b(nous|vous|maison|construire|oui)\b/i },
  },
];

const UNSURE = /(team|contact|get back|reach|reply|équipe|contacter|répondre|equipo|contactar|timu|wasiliana|details|détails|datos|taarifa|cannot|can't|don't|not sure|n'ai pas|no tengo|sijui|siwezi)/i;

describe.skipIf(!enabled)("Website chat quality (5 businesses x 4 questions)", () => {
  async function ask(c: Case, q: string) {
    const { generateChatReply } = await import("@/lib/widget/ai");
    return generateChatReply({ facts: c.facts, history: [{ role: "visitor", content: q }], leadCaptured: false, userId: "eval", businessId: "eval" });
  }
  it.each(cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const known = await ask(c, c.known.q);
    expect(known.reply, `known: ${known.reply}`).toMatch(c.known.mustInclude);

    const price = await ask(c, c.price);
    expect(price.wantsContact, `price: ${price.reply}`).toBe(true);
    const listed = c.facts.projects.find((p) => p.price);
    if (!listed || !c.price.toLowerCase().includes(listed.title.split(" ")[0].toLowerCase())) {
      expect(price.reply, "must not invent a number").not.toMatch(/\d[\d,. ]{2,}\s?(RWF|€|\$|USD|EUR|FRW)/i);
    }

    const unknown = await ask(c, c.unknown);
    expect(unknown.wantsContact, `unknown: ${unknown.reply}`).toBe(true);
    expect(unknown.reply).toMatch(UNSURE);

    const other = await ask(c, c.other.q);
    expect(other.reply, `language: ${other.reply}`).toMatch(c.other.language);
  }, 120_000);
});
