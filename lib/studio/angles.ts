// Content packs (docs/CONTENT_PACKS.md): "Write content" makes several different posts for a product or campaign,
// each with its own angle, its own app and its own picture, instead of one post copied to every app. This file is the
// angle catalogue and the pure choices: which angles fit, which come next (rotated per subject), and which app each
// post goes to. No I/O, so it is unit tested.
import type { Network } from "@/lib/social/types";

export const ANGLE_IDS = ["price", "how-it-works", "features", "news", "story", "behind-scenes", "tips", "faq", "why-us", "seasonal", "cta"] as const;
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
}

export const ANGLES: Record<AngleId, AngleDef> = {
  price: {
    id: "price",
    label: "Price or offer",
    brief: "The price or offer exactly as given, what the customer gets for it and why it is worth it. Never invent a price or discount.",
    people: "a happy customer with the product, at the moment of buying or receiving it",
    list: false,
    networks: ["instagram", "facebook"],
  },
  "how-it-works": {
    id: "how-it-works",
    label: "How it works",
    brief: "The steps or process, 3 to 5 short steps, from first contact to result.",
    people: "a staff member explaining or showing the steps to a client",
    list: true,
    networks: ["tiktok", "youtube", "instagram"],
  },
  features: {
    id: "features",
    label: "Features and benefits",
    brief: "The main features turned into benefits for the customer, from the facts given.",
    people: "a customer using the product in everyday life, enjoying its main benefit",
    list: true,
    networks: ["instagram", "facebook"],
  },
  news: {
    id: "news",
    label: "News",
    brief: "An announcement: new arrival, launch, opening or event, with what is new and when (only dates given).",
    people: "the team welcoming the first customers, a lively moment at the opening or launch",
    list: false,
    networks: ["facebook", "linkedin", "instagram"],
  },
  story: {
    id: "story",
    label: "Customer story",
    brief: "A customer story. Quote a review only from the CUSTOMER REVIEWS block, word for word with the name given; without one, tell a relatable everyday scenario of a typical customer, never a fake quote or name.",
    people: "a typical customer in an everyday moment where the product or service helps",
    list: false,
    networks: ["facebook", "instagram"],
  },
  "behind-scenes": {
    id: "behind-scenes",
    label: "Behind the scenes",
    brief: "Behind the scenes: the team, the care and the work that goes into it.",
    people: "the team at work, preparing or making it with care",
    list: false,
    networks: ["tiktok", "instagram", "linkedin"],
  },
  tips: {
    id: "tips",
    label: "Tips",
    brief: "3 to 5 practical tips related to the product or service that help the customer, ending with a soft call to action.",
    people: "a person demonstrating a useful tip with the product",
    list: true,
    networks: ["instagram", "tiktok", "linkedin"],
  },
  faq: {
    id: "faq",
    label: "FAQ or myth-buster",
    brief: "Answer the questions customers ask (from the FAQs given) or bust a common myth, without inventing facts.",
    people: "a staff member answering a customer's question face to face",
    list: true,
    networks: ["instagram", "linkedin", "facebook"],
  },
  "why-us": {
    id: "why-us",
    label: "Why us",
    brief: "Why choose this business, from its POSITIONING and differentiators. Never name a competitor.",
    people: "a confident customer choosing this business over the alternatives",
    list: false,
    networks: ["linkedin", "facebook"],
  },
  seasonal: {
    id: "seasonal",
    label: "Local moment",
    brief: "Tie it to the local moment given (a holiday or season in the country), warmly and respectfully.",
    people: "local people enjoying the season or celebration together, with the product",
    list: false,
    networks: ["facebook", "instagram"],
  },
  cta: {
    id: "cta",
    label: "Book or buy",
    brief: "A clear call to action: how to book, order or visit, using only the contact details and hours given.",
    people: "a customer booking or ordering on their phone, smiling",
    list: false,
    networks: ["instagram", "facebook", "tiktok"],
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
}

export function eligibleAngles(facts: AngleFacts): AngleId[] {
  return ANGLE_IDS.filter((id) => {
    if (id === "price") return facts.hasPrice;
    if (id === "news") return facts.isNew;
    if (id === "why-us") return facts.hasCompetitors;
    if (id === "seasonal") return !!facts.moment;
    return true;
  });
}

// The order a fresh subject starts in, by what it is: the angles that sell it best come first.
const PRIORITY: Record<string, AngleId[]> = {
  product: ["features", "price", "story", "tips", "how-it-works", "news", "why-us", "faq", "seasonal", "behind-scenes", "cta"],
  service: ["how-it-works", "story", "price", "faq", "why-us", "behind-scenes", "tips", "features", "news", "seasonal", "cta"],
  event: ["news", "cta", "behind-scenes", "story", "faq", "seasonal", "features", "price", "how-it-works", "tips", "why-us"],
  offer: ["price", "cta", "features", "story", "news", "seasonal", "faq", "how-it-works", "tips", "why-us", "behind-scenes"],
};

/**
 * The next `count` angles for a subject: angles it never had first, then the least recently used (`recent` is newest
 * first), so the same angle does not come back until the others had their turn. Ties follow the subject type's
 * priority. Distinct; fewer only when fewer fit.
 */
export function chooseAngles(facts: AngleFacts, recent: readonly string[], count: number): AngleId[] {
  const order = PRIORITY[facts.subjectType] ?? PRIORITY.product;
  const eligible = eligibleAngles(facts);
  const lastUse = (id: AngleId) => {
    const i = recent.indexOf(id);
    return i < 0 ? Number.POSITIVE_INFINITY : i; // larger = longer ago
  };
  return [...eligible]
    .sort((a, b) => lastUse(b) - lastUse(a) || order.indexOf(a) - order.indexOf(b))
    .slice(0, Math.max(0, count));
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
