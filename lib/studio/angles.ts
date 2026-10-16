// Content packs (docs/CONTENT_PACKS.md): "Write content" makes several different posts for a product or campaign,
// each with its own angle, its own app and its own picture, instead of one post copied to every app. This file is the
// angle catalogue and the pure choices: which angles fit, which come next (rotated per subject), and which app each
// post goes to. No I/O, so it is unit tested.
import type { Network } from "@/lib/social/types";

export const ANGLE_IDS = [
  "price",
  "how-it-works",
  "features",
  "news",
  "story",
  "behind-scenes",
  "tips",
  "faq",
  "why-us",
  "seasonal",
  "cta",
  // Idea variety (owner, 13 October 2026: "every day a new idea, fun or professional").
  "playful",
  "poll",
  "breaking",
  "did-you-know",
  "challenge",
  "trivia",
  "myth-fact",
  "tip-of-day",
  "spotlight",
  "before-after",
  "meme",
] as const;
export type AngleId = (typeof ANGLE_IDS)[number];

export interface AngleDef {
  id: AngleId;
  label: string;
  /** What the writer makes of it. */
  brief: string;
  /** Who and what the people photo shows for this angle. */
  people: string;
  /** A list of steps, tips or questions: a carousel where the app has them. */
  list: boolean;
  /** Apps this angle suits best, best first. */
  networks: Network[];
  /** Fun or professional, so a day's ideas follow the brand's tone (`funShare`). */
  tone: "fun" | "pro";
}

export const ANGLES: Record<AngleId, AngleDef> = {
  price: {
    id: "price",
    label: "Price or offer",
    brief: "The price or offer exactly as given, what the customer gets for it and why it is worth it. Never invent a price or discount.",
    people: "a happy customer with the product, at the moment of buying or receiving it",
    list: false,
    networks: ["instagram", "facebook"],
    tone: "pro",
  },
  "how-it-works": {
    id: "how-it-works",
    label: "How it works",
    brief: "The steps or process, 3 to 5 short steps, from first contact to result.",
    people: "a staff member explaining or showing the steps to a client",
    list: true,
    networks: ["tiktok", "youtube", "instagram"],
    tone: "pro",
  },
  features: {
    id: "features",
    label: "Features and benefits",
    brief: "The main features turned into benefits for the customer, from the facts given.",
    people: "a customer using the product in everyday life, enjoying its main benefit",
    list: true,
    networks: ["instagram", "facebook"],
    tone: "pro",
  },
  news: {
    id: "news",
    label: "News",
    brief: "An announcement: new arrival, launch, opening or event, with what is new and when (only dates given).",
    people: "the team welcoming the first customers, a lively moment at the opening or launch",
    list: false,
    networks: ["facebook", "linkedin", "instagram"],
    tone: "pro",
  },
  story: {
    id: "story",
    label: "Customer story",
    brief: "A customer story. Quote a review only from the CUSTOMER REVIEWS block, word for word with the name given; without one, tell a relatable everyday scenario of a typical customer, never a fake quote or name.",
    people: "a typical customer in an everyday moment where the product or service helps",
    list: false,
    networks: ["facebook", "instagram"],
    tone: "pro",
  },
  "behind-scenes": {
    id: "behind-scenes",
    label: "Behind the scenes",
    brief: "Behind the scenes: the team, the care and the work that goes into it.",
    people: "the team at work, preparing or making it with care",
    list: false,
    networks: ["tiktok", "instagram", "linkedin"],
    tone: "fun",
  },
  tips: {
    id: "tips",
    label: "Tips",
    brief: "3 to 5 practical tips related to the product or service that help the customer, ending with a soft call to action.",
    people: "a person demonstrating a useful tip with the product",
    list: true,
    networks: ["instagram", "tiktok", "linkedin"],
    tone: "pro",
  },
  faq: {
    id: "faq",
    label: "FAQ or myth-buster",
    brief: "Answer the questions customers ask (from the FAQs given) or bust a common myth, without inventing facts.",
    people: "a staff member answering a customer's question face to face",
    list: true,
    networks: ["instagram", "linkedin", "facebook"],
    tone: "pro",
  },
  "why-us": {
    id: "why-us",
    label: "Why us",
    brief: "Why choose this business, from its POSITIONING and differentiators. Never name a competitor.",
    people: "a confident customer choosing this business over the alternatives",
    list: false,
    networks: ["linkedin", "facebook"],
    tone: "pro",
  },
  seasonal: {
    id: "seasonal",
    label: "Local moment",
    brief: "Tie it to the local moment given (a holiday or season in the country), warmly and respectfully.",
    people: "local people enjoying the season or celebration together, with the product",
    list: false,
    networks: ["facebook", "instagram"],
    tone: "fun",
  },
  cta: {
    id: "cta",
    label: "Book or buy",
    brief: "A clear call to action: how to book, order or visit, using only the contact details and hours given.",
    people: "a customer booking or ordering on their phone, smiling",
    list: false,
    networks: ["instagram", "facebook", "tiktok"],
    tone: "pro",
  },
  playful: {
    id: "playful",
    label: "Playful",
    brief: "A light, fun post: a playful line or a small joke about everyday life with it. Brand-safe, never mocking anyone.",
    people: "friends laughing together while using the product",
    list: false,
    networks: ["instagram", "tiktok", "facebook"],
    tone: "fun",
  },
  poll: {
    id: "poll",
    label: "Question or poll",
    brief: "An engaging question or a poll with 2 to 4 options about a real choice customers make, inviting them to answer in the comments.",
    people: "a customer smiling while choosing between two options",
    list: false,
    networks: ["facebook", "instagram", "linkedin"],
    tone: "fun",
  },
  breaking: {
    id: "breaking",
    label: "Breaking news",
    brief: "Breaking news, only from real news in the facts given (a new product, campaign, event or opening). Never invent news, dates or numbers.",
    people: "the team excitedly announcing the news to customers",
    list: false,
    networks: ["facebook", "linkedin", "instagram"],
    tone: "pro",
  },
  "did-you-know": {
    id: "did-you-know",
    label: "Did you know?",
    brief: "\"Did you know?\": one useful fact from the details given or common knowledge about the industry. Never invent statistics, percentages or numbers.",
    people: "a staff member sharing a surprising fact with a customer",
    list: false,
    networks: ["instagram", "linkedin", "facebook"],
    tone: "pro",
  },
  challenge: {
    id: "challenge",
    label: "Challenge or contest",
    brief: "A challenge or contest that invites customers to take part (for example making the best short video about the business). Never invent a prize, an end date or how the winner is chosen: write [PRIZE], [END DATE] and [HOW THE WINNER IS CHOSEN] where they go, and end with a short rules line: \"Rules: [HOW THE WINNER IS CHOSEN]. Ends [END DATE]. Prize: [PRIZE].\" The owner fills them in.",
    people: "young people joyfully filming a short video with the product",
    list: false,
    networks: ["tiktok", "instagram", "facebook"],
    tone: "fun",
  },
  trivia: {
    id: "trivia",
    label: "Trivia or quiz",
    brief: "A trivia or quiz question about the product's world, with the answer at the end or invited in the comments. Facts only from the details given or common knowledge.",
    people: "friends playing a quiz game, one of them raising a hand",
    list: false,
    networks: ["instagram", "facebook", "tiktok"],
    tone: "fun",
  },
  "myth-fact": {
    id: "myth-fact",
    label: "Myth vs fact",
    brief: "Myth vs fact: one or two common beliefs customers have, each with the truth from the facts given.",
    people: "a staff member calmly explaining something to a surprised customer",
    list: true,
    networks: ["linkedin", "instagram", "facebook"],
    tone: "pro",
  },
  "tip-of-day": {
    id: "tip-of-day",
    label: "Tip of the day",
    brief: "Tip of the day: one short, practical tip the customer can use today, then a soft call to action.",
    people: "a person demonstrating a quick tip with the product",
    list: false,
    networks: ["instagram", "tiktok", "linkedin"],
    tone: "pro",
  },
  spotlight: {
    id: "spotlight",
    label: "Customer spotlight",
    brief: "Customer spotlight: quote one review from the CUSTOMER REVIEWS block word for word with the name given, and thank the customer. Never invent a customer, a quote or a name.",
    people: "a happy customer, proud, in the spotlight with the product",
    list: false,
    networks: ["facebook", "instagram", "linkedin"],
    tone: "pro",
  },
  "before-after": {
    id: "before-after",
    label: "Before and after",
    brief: "A before / after story, only from the photos or facts given (what it looked like before, what changed). Never invent results or numbers.",
    people: "a customer looking pleased at the result after the work is done",
    list: false,
    networks: ["instagram", "facebook", "tiktok"],
    tone: "pro",
  },
  meme: {
    id: "meme",
    label: "Meme-style humour",
    brief: "Meme-style humour: a short, relatable \"when you...\" line about a situation customers know, brand-safe. No real memes, no famous people, nothing offensive.",
    people: "a person making a funny, relatable face in an everyday moment with the product",
    list: false,
    networks: ["instagram", "tiktok", "facebook"],
    tone: "fun",
  },
};

export function isAngleId(value: unknown): value is AngleId {
  return typeof value === "string" && (ANGLE_IDS as readonly string[]).includes(value);
}

/** What the subject offers the writer: angles without their facts are skipped, never invented. */
export interface AngleFacts {
  /** "product", "service", "event", "offer", "listing", "project", "other" (lib/knowledge/legacy.ts). */
  subjectType: string;
  hasPrice: boolean;
  /** A launch, an event, an offer, or a product added in the last 30 days. */
  isNew: boolean;
  hasCompetitors: boolean;
  hasFaqs: boolean;
  /** An upcoming holiday or season in the company's country, for the local-moment angle. */
  moment?: string | null;
  /** Quotable reviews exist (customer spotlight). */
  hasReviews?: boolean;
  /** Real before / after material (photos named so, or facts): the before-after angle. */
  hasBeforeAfter?: boolean;
  /** A contest may be suggested: only where the owner confirms the prize before it goes out ("Create today's content"). */
  contests?: boolean;
}

export function eligibleAngles(facts: AngleFacts): AngleId[] {
  return ANGLE_IDS.filter((id) => {
    if (id === "price") return facts.hasPrice;
    if (id === "news") return facts.isNew;
    if (id === "why-us") return facts.hasCompetitors;
    if (id === "seasonal") return !!facts.moment;
    if (id === "breaking") return facts.isNew;
    if (id === "spotlight") return !!facts.hasReviews;
    if (id === "before-after") return !!facts.hasBeforeAfter;
    if (id === "challenge") return !!facts.contests;
    return true;
  });
}

// The order a fresh subject starts in, by what it is: the angles that sell it best come first.
const PRIORITY: Record<string, AngleId[]> = {
  product: ["features", "price", "story", "tips", "how-it-works", "news", "why-us", "faq", "seasonal", "behind-scenes", "cta", "tip-of-day", "did-you-know", "poll", "playful", "myth-fact", "spotlight", "trivia", "breaking", "before-after", "meme", "challenge"],
  service: ["how-it-works", "story", "price", "faq", "why-us", "behind-scenes", "tips", "features", "news", "seasonal", "cta", "tip-of-day", "did-you-know", "poll", "playful", "myth-fact", "spotlight", "trivia", "breaking", "before-after", "meme", "challenge"],
  event: ["news", "cta", "behind-scenes", "story", "faq", "seasonal", "features", "price", "how-it-works", "tips", "why-us", "tip-of-day", "did-you-know", "poll", "playful", "myth-fact", "spotlight", "trivia", "breaking", "before-after", "meme", "challenge"],
  offer: ["price", "cta", "features", "story", "news", "seasonal", "faq", "how-it-works", "tips", "why-us", "behind-scenes", "tip-of-day", "did-you-know", "poll", "playful", "myth-fact", "spotlight", "trivia", "breaking", "before-after", "meme", "challenge"],
};

/**
 * The next `count` angles for a subject: angles it never had first, then the least recently used (`recent` is newest
 * first), so the same angle does not come back until the others had their turn. Ties follow the subject type's
 * priority. Distinct; fewer only when fewer fit.
 */
export function chooseAngles(facts: AngleFacts, recent: readonly string[], count: number, options: { funShare?: number; funCount?: number; exclude?: readonly AngleId[] } = {}): AngleId[] {
  const order = PRIORITY[facts.subjectType] ?? PRIORITY.product;
  const eligible = eligibleAngles(facts).filter((id) => !options.exclude?.includes(id));
  const lastUse = (id: AngleId) => {
    const i = recent.indexOf(id);
    return i < 0 ? Number.POSITIVE_INFINITY : i; // larger = longer ago
  };
  const ranked = [...eligible].sort((a, b) => lastUse(b) - lastUse(a) || order.indexOf(a) - order.indexOf(b));
  const n = Math.max(0, count);
  if (options.funShare === undefined && options.funCount === undefined) return ranked.slice(0, n);
  // Fun vs professional per the brand's tone: about `funShare` of the ideas are fun (or exactly `funCount`), in
  // rotation order otherwise.
  const fun = Math.min(n, Math.max(0, options.funCount ?? Math.round(n * Math.min(1, Math.max(0, options.funShare ?? 0)))));
  const quota = { fun, pro: n - fun };
  const out: AngleId[] = [];
  for (const id of ranked) {
    if (out.length >= n || quota[ANGLES[id].tone] === 0) continue;
    quota[ANGLES[id].tone] -= 1;
    out.push(id);
  }
  for (const id of ranked) if (out.length < n && !out.includes(id)) out.push(id);
  return out;
}

/**
 * How fun the ideas should be, from the Digital Marketing Profile's tone and personality answers: playful brands get
 * about half fun ideas, formal ones a few, the rest about a third.
 */
/**
 * How many of `count` ideas are fun today: the share's whole part, and its fraction on a share of the days (a stable
 * low-discrepancy sequence by day), so a one-post day is sometimes fun and the long-run share holds.
 */
export function funCountFor(share: number, count: number, dayNumber: number): number {
  const exact = Math.max(0, Math.min(1, share)) * count;
  const whole = Math.floor(exact);
  const turn = (dayNumber * 0.6180339887498949) % 1;
  return Math.min(count, whole + (turn < exact - whole ? 1 : 0));
}

export function funShareFor(answers: readonly { topic: string; answer: string }[] | null | undefined): number {
  const text = (answers ?? []).filter((a) => a.topic === "tone" || a.topic === "personality" || a.topic === "formality").map((a) => a.answer.toLowerCase()).join(" ");
  if (/\b(formal|professional|serious|expert|corporate|authoritative)/.test(text) && !/\b(fun|playful|humou?r|casual|witty)/.test(text)) return 0.15;
  if (/\b(fun|playful|humou?r|casual|witty|cheeky|energetic)/.test(text)) return 0.5;
  return 0.33;
}

/** Apps a pack goes to when none is connected yet: the ones most small businesses use. */
export const DEFAULT_PACK_NETWORKS: readonly Network[] = ["instagram", "facebook", "tiktok", "linkedin"];

export type PackFormat = "image" | "carousel" | "video";

/** How a post looks on an app: video on TikTok and YouTube, a carousel for list angles where the app has them. */
export function formatFor(angle: AngleId, network: Network): PackFormat {
  if (network === "tiktok" || network === "youtube") return "video";
  if (ANGLES[angle].list && (network === "instagram" || network === "facebook" || network === "linkedin")) return "carousel";
  return "image";
}

/**
 * Spreads the pack over the apps: each post goes to the app that has the fewest posts so far, preferring the apps its
 * angle suits. Every app gets one before any gets a second. Pure and stable.
 */
export function spreadNetworks(angles: readonly AngleId[], networks: readonly Network[]): { angle: AngleId; network: Network; format: PackFormat }[] {
  const apps = networks.length ? [...new Set(networks)] : [...DEFAULT_PACK_NETWORKS];
  const count = new Map<Network, number>(apps.map((n) => [n, 0]));
  return angles.map((angle) => {
    const fit = ANGLES[angle].networks;
    const rank = (n: Network) => {
      const i = fit.indexOf(n);
      return i < 0 ? fit.length : i;
    };
    const network = [...apps].sort((a, b) => count.get(a)! - count.get(b)! || rank(a) - rank(b) || apps.indexOf(a) - apps.indexOf(b))[0];
    count.set(network, count.get(network)! + 1);
    return { angle, network, format: formatFor(angle, network) };
  });
}
