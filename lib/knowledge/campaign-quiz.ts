// The own campaign quiz (docs/QUIZ_MODE.md, "B. Own campaign quiz"): the date chips, the quiz's answers as the
// campaign form's input, and the AI's ideas made safe (with a template per kind when the AI cannot answer). Pure: the
// quiz screen, the server (lib/knowledge/campaign-ai.ts) and the tests share it.
//
// Rule: BuPulse never invents a price or a discount. Every number in an idea must be in the owner's line or in the
// stored prices of the products, and deal words ("free", "% off", "discount") only when the owner used them.

import { z } from "zod";
import { addDaysYmd } from "@/lib/demo/slots";
import { CAMPAIGN_LIMITS, isDay, MAX_HIGHLIGHTS, type CampaignInput, type CampaignTypeValue } from "./campaigns";

// ---- When -------------------------------------------------------------------------------------------------------

export const WHEN_CHIPS = [
  { value: "TODAY", label: "Today", emoji: "☀️" },
  { value: "WEEKEND", label: "This weekend", emoji: "🎉" },
  { value: "NEXT_WEEK", label: "Next week", emoji: "📆" },
  { value: "MONTH", label: "This month", emoji: "🗓️" },
  { value: "NONE", label: "No dates", emoji: "♾️" },
  { value: "PICK", label: "Pick dates", emoji: "✏️" },
] as const;
export type WhenChip = (typeof WHEN_CHIPS)[number]["value"];
export const WHEN_VALUES = WHEN_CHIPS.map((w) => w.value) as [WhenChip, ...WhenChip[]];

/** The chips an Event can pick (it needs a date). */
export const whenChipsFor = (type: CampaignTypeValue) => WHEN_CHIPS.filter((w) => type !== "EVENT" || w.value !== "NONE");

const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** The last day of `ymd`'s month. */
function monthEnd(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * The chip as the campaign's first and last day, from the business's `today` ("YYYY-MM-DD"). A single day has no last
 * day (the form's "Leave empty for a single day"). This weekend: the coming Saturday and Sunday (today on a weekend).
 * Next week: next Monday to Sunday. This month: today to the month's last day.
 */
export function datesForChip(chip: WhenChip, today: string, pick: { startsOn?: string; endsOn?: string } = {}): { startsOn: string | null; endsOn: string | null } {
  const range = (startsOn: string | null, endsOn: string | null) => ({ startsOn, endsOn: endsOn && endsOn !== startsOn ? endsOn : null });
  switch (chip) {
    case "TODAY":
      return range(today, null);
    case "WEEKEND": {
      const d = weekday(today);
      if (d === 0) return range(today, null);
      const saturday = addDaysYmd(today, d === 6 ? 0 : 6 - d);
      return range(saturday, addDaysYmd(saturday, 1));
    }
    case "NEXT_WEEK": {
      const monday = addDaysYmd(today, ((8 - weekday(today)) % 7) || 7);
      return range(monday, addDaysYmd(monday, 6));
    }
    case "MONTH":
      return range(today, monthEnd(today));
    case "NONE":
      return range(null, null);
    case "PICK": {
      const startsOn = pick.startsOn && isDay(pick.startsOn) ? pick.startsOn : null;
      const endsOn = pick.endsOn && isDay(pick.endsOn) ? pick.endsOn : null;
      return range(startsOn, endsOn);
    }
  }
}

/** BuPulse's guess for the dates of each kind before the AI answers. */
export const WHEN_GUESS: Record<CampaignTypeValue, WhenChip> = { EVENT: "WEEKEND", OFFER: "MONTH", PROMOTION: "NEXT_WEEK", LAUNCH: "TODAY", OTHER: "NONE" };

// ---- The quiz's answers as the form's input ---------------------------------------------------------------------

export type OwnQuizAnswers = {
  type: CampaignTypeValue;
  /** "What's it about?" in one line. */
  line: string;
  productIds: string[];
  when: WhenChip;
  pickStartsOn: string;
  pickEndsOn: string;
  /** The deal as customers read it; empty for "No price or discount". */
  deal: string;
  highlights: string[];
  name: string;
  description: string;
};

/** The campaign form's input (campaignInputSchema) from the quiz: the same record the full form saves. */
export function campaignFromQuiz(a: OwnQuizAnswers, today: string): CampaignInput {
  const { startsOn, endsOn } = datesForChip(a.when, today, { startsOn: a.pickStartsOn, endsOn: a.pickEndsOn });
  const line = a.line.trim();
  return {
    type: a.type,
    name: a.name.trim() || nameFromLine(line) || DEFAULT_NAME[a.type],
    description: a.description.trim() || line || null,
    startsOn,
    endsOn,
    priceInfo: a.deal.trim() || null,
    highlights: a.highlights,
    productIds: a.productIds,
    status: "ACTIVE",
  };
}

const DEFAULT_NAME: Record<CampaignTypeValue, string> = { EVENT: "Our event", OFFER: "Our special offer", PROMOTION: "Our promotion", LAUNCH: "Something new", OTHER: "Our campaign" };

/** A name from the owner's line: its first words, with a capital ("our new juice menu" → "Our new juice menu"). */
export function nameFromLine(line: string): string {
  const words = line.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").split(" ").slice(0, 7).join(" ").slice(0, 60).trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

// ---- What BuPulse suggests --------------------------------------------------------------------------------------

export type OwnSuggestion = {
  name: string;
  description: string;
  when: WhenChip;
  /** Up to 3 ways to put the price or the deal, each from the owner's line or a stored price. */
  deals: string[];
  highlights: string[];
  source: "ai" | "template";
};

/** What the suggestion is made from. `products` are the ones the owner picked, with their stored price in words. */
export type OwnSuggestContext = {
  type: CampaignTypeValue;
  line: string;
  businessName: string;
  products: { name: string; price: string | null }[];
};

/** What the AI is asked to return (a JSON Schema is made from it). Loose on purpose: sanitizeOwnSuggestion keeps the good parts. */
export const ownAiSchema = z.object({
  name: z.string().describe("Short campaign name customers read, 2 to 6 words"),
  description: z.string().describe("2 to 4 short sentences: what it is, who it is for, how to join or claim it"),
  when: z.string().describe(`When it runs, one of: ${WHEN_VALUES.filter((w) => w !== "PICK").join(", ")}`),
  deals: z.array(z.string()).describe("Up to 3 ways to say the price or deal, under 12 words each, using ONLY numbers from the owner's line or the product prices; empty when there is none"),
  highlights: z.array(z.string()).describe("3 to 5 short points customers should know, under 10 words each, no prices or numbers unless given"),
});

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");
const cleanText = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max).trim() : "");

/** Every number in a text, written plainly: "2,000 RWF" → "2000", "12.50" → "12.5", "20%" → "20". */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,. ]*\d|\d/g) ?? []).map((raw) => {
    const n = raw.replace(/[ ,]/g, "").replace(/\.(?=.*\.)/g, "");
    return n.includes(".") ? n.replace(/\.?0+$/, "") : n.replace(/^0+(?=\d)/, "");
  });
}

/** Words that make a deal; an idea may use one only when the owner did. */
const DEAL_WORDS = /\b(free|discounts?|discounted|off|half[- ]price|bogo|cashback|sale|cheaper|promo)\b/gi;

/** The facts an idea may use: the numbers and the deal words of the owner's line and the stored prices. */
export function allowedFacts(ctx: Pick<OwnSuggestContext, "line" | "products">) {
  const sources = [ctx.line, ...ctx.products.map((p) => `${p.name} ${p.price ?? ""}`)];
  return { numbers: new Set(sources.flatMap(numbersIn)), dealWords: new Set(sources.flatMap((s) => (s.match(DEAL_WORDS) ?? []).map((w) => w.toLowerCase().replace(/s$/, "")))) };
}

/** True when the text says no price, discount or number that is not in the facts. */
export function usesOnlyFacts(text: string, facts: ReturnType<typeof allowedFacts>): boolean {
  if (numbersIn(text).some((n) => !facts.numbers.has(n))) return false;
  return (text.match(DEAL_WORDS) ?? []).every((w) => facts.dealWords.has(w.toLowerCase().replace(/s$/, "")));
}

const lines = (v: unknown, max: number, each: number, ok: (s: string) => boolean) => {
  const seen = new Set<string>();
  return (Array.isArray(v) ? v : [])
    .map((x) => clean(x, each))
    .filter((x) => x.length >= 2 && ok(x) && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .slice(0, max);
};

/** The AI's answer made safe: anything missing, wrong or with an invented number taken from `fallback` (the template). */
export function sanitizeOwnSuggestion(raw: unknown, ctx: OwnSuggestContext, fallback: OwnSuggestion): OwnSuggestion {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const facts = allowedFacts(ctx);
  const ok = (s: string) => usesOnlyFacts(s, facts);
  const name = clean(r.name, 80);
  const description = cleanText(r.description, 800);
  const when = typeof r.when === "string" ? (WHEN_VALUES.find((w) => w === (r.when as string).trim().toUpperCase()) ?? null) : null;
  const deals = lines(r.deals, 3, 120, ok);
  const highlights = lines(r.highlights, 5, CAMPAIGN_LIMITS.highlight, ok);
  return {
    name: name.length >= 2 && ok(name) ? name : fallback.name,
    description: description.length >= 10 && ok(description) ? description : fallback.description,
    when: when && when !== "PICK" && !(ctx.type === "EVENT" && when === "NONE") ? when : fallback.when,
    deals: deals.length ? deals : fallback.deals,
    highlights: highlights.length ? highlights.slice(0, MAX_HIGHLIGHTS) : fallback.highlights,
    source: "ai",
  };
}

const SHOP = (b: string) => (b ? `at ${b}` : "with us");

const TEMPLATE: Record<CampaignTypeValue, { describe: (what: string, b: string) => string; highlights: (product: string | null) => string[] }> = {
  OFFER: {
    describe: (what, b) => `${what} ${SHOP(b)}, for a short time only. Come in or send us a message to get it.`,
    highlights: (p) => [p ? `Ask for our ${p}` : "Ask us in store or on WhatsApp", "For a short time only", "Tell a friend who would love it"],
  },
  EVENT: {
    describe: (what, b) => `${what} ${SHOP(b)}. Everyone is welcome: come along and bring a friend. Message us to find out more.`,
    highlights: (p) => ["Everyone is welcome", "Bring a friend", p ? `Try our ${p}` : "Come and meet the team"],
  },
  PROMOTION: {
    describe: (what, b) => `${what} ${SHOP(b)}. Come and see why our customers keep coming back.`,
    highlights: (p) => [p ? `Our ${p}, at its best` : "Our best, all in one place", "Ask us anything", "Order in store or by message"],
  },
  LAUNCH: {
    describe: (what, b) => `Something new ${SHOP(b)}: ${what.charAt(0).toLowerCase()}${what.slice(1)}. Be one of the first to try it.`,
    highlights: (p) => ["Brand new", "Be one of the first to try it", p ? `Ask us about ${p}` : "Ask us what's new"],
  },
  OTHER: {
    describe: (what, b) => `${what} ${SHOP(b)}. Follow us and send us a message to find out more.`,
    highlights: (p) => [p ? `Featuring our ${p}` : "Something worth sharing", "Ask us anything", "Tell a friend"],
  },
};

/** The template's ideas for the kind (no AI): the deals come only from the owner's line and the stored prices. */
export function templateOwnSuggestion(ctx: OwnSuggestContext): OwnSuggestion {
  const line = ctx.line.trim().replace(/[.!?]+$/, "");
  const product = ctx.products[0]?.name ?? null;
  const what = nameFromLine(line) || (product ? `Our ${product}` : DEFAULT_NAME[ctx.type]);
  const deals: string[] = [];
  if (numbersIn(line).length && line.length <= 120) deals.push(line[0].toUpperCase() + line.slice(1));
  for (const p of ctx.products) if (p.price && deals.length < 3) deals.push(`${p.name}: ${p.price}`.slice(0, 120));
  return {
    name: (nameFromLine(line) || (product ? `${product} ${ctx.type === "EVENT" ? "day" : ctx.type === "LAUNCH" ? "launch" : "offer"}` : DEFAULT_NAME[ctx.type])).slice(0, 80),
    description: TEMPLATE[ctx.type].describe(what, ctx.businessName.trim()).slice(0, 800),
    when: WHEN_GUESS[ctx.type],
    deals: [...new Set(deals)],
    highlights: TEMPLATE[ctx.type].highlights(product),
    source: "template",
  };
}

/** Ideas for "What's it about?" by kind, with the first picked product when there is one. No prices or discounts. */
export function lineIdeas(type: CampaignTypeValue, product: string | null): string[] {
  const p = product ?? "our best seller";
  switch (type) {
    case "OFFER":
      return [`A special price on ${p}`, "A thank-you deal for our customers", "Our month-end offer"];
    case "EVENT":
      return ["An open day at our place", `A tasting of ${p}`, "A small party for our customers"];
    case "PROMOTION":
      return [`A week to show off ${p}`, "Why customers love us", "Back to school with us"];
    case "LAUNCH":
      return [`Our new ${product ?? "product"}`, "Our new branch", "Our new menu"];
    case "OTHER":
      return ["Our anniversary", "Meet the team behind us", "A big thank you to our customers"];
  }
}
