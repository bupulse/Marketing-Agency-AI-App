// The support chat's decisions, pure so they are tested without a database or an AI (tests/support):
// when the AI hands a chat to a person (docs/SUPPORT_CHAT.md section 2, research 2.3: asked, upset, not confident,
// always-handed-over topics), and the lead score, urgency and tags agents sort by (section 4).
import type { HandoverReason, Surface } from "./contract";

// Asking for a person, in the languages visitors write: English, French, Kinyarwanda, Swahili.
const HUMAN = [
  /\b(real|live|actual)\s+(person|human|agent|people)\b/i,
  /\b(talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+|some)?(person|human|agent|someone|somebody|staff|support|team|manager)\b/i,
  /^\s*(an?\s+)?(human|agent|person|operator|representative)(\s+(please|pls|plz))?\s*[!?.]*\s*$/i,
  /\b(customer\s+(service|care)|call\s+me|phone\s+me)\b/i,
  /\b(parler|discuter)\s+(à|a|avec)\s+(un|une|quelqu)/i,
  /\b(un\s+humain|une\s+personne|un\s+conseiller|un\s+agent)\b/i,
  /\bumuntu\s+(nyawe|w[ia]\s?ukuri)\b/i,
  /\b(ndashaka|nshaka)\s+(kuvugana|kuvuga)\s+n/i,
  /\b(nataka|naomba)\s+(kuongea|kuzungumza)\s+na\b/i,
  /\bmtu\s+halisi\b/i,
];

// Clearly upset: anger words, repeated "!!!", or a long message shouting in capitals.
const UPSET = [
  /\b(scam|fraud|useless|terrible|horrible|worst|ridiculous|unacceptable|angry|furious|disgusting|waste of (my )?(time|money)|rip ?off)\b/i,
  /\b(arnaque|inadmissible|nul|honteux|énervé|furieux|escroquerie)\b/i,
  /\b(ubujura|birambabaje|ndarakaye)\b/i,
  /\b(utapeli|nimekasirika|upuuzi)\b/i,
  /!{3,}/,
];

export function askedForHuman(text: string): boolean {
  return HUMAN.some((r) => r.test(text));
}

export function soundsUpset(text: string): boolean {
  if (UPSET.some((r) => r.test(text))) return true;
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 20 && letters === letters.toUpperCase();
}

const STEM = 5;
const stems = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, STEM));

/** The first always-handed-over topic whose every significant word appears in the text ("refunds" matches "refund"). */
export function matchedTopic(text: string, topics: readonly string[]): string | null {
  const words = new Set(stems(text));
  for (const topic of topics) {
    const need = stems(topic);
    if (need.length && need.every((w) => words.has(w))) return topic;
  }
  return null;
}

export type AiVerdict = {
  /** What the AI itself flagged. */
  handover: "none" | "asked" | "upset" | "topic";
  confident: boolean;
  /** A sales or pricing question (plans, prices, trial, what BuPulse does). */
  sales: boolean;
};

export type HandoverInput = {
  surface: Surface;
  text: string;
  topics: readonly string[];
  /** Null when there is no AI answer (switched off, over its limits, or it failed). */
  ai: AiVerdict | null;
};

/**
 * Whether this visitor message goes to a person, and why. In order: asked for a person, upset, an always-handed-over
 * topic, no AI answer, the AI not confident. Sales and pricing questions on public pages (and the bio corner link)
 * stay with the AI and are only tagged: there the AI's job is to sell, and a person would only slow the visitor down.
 * Asking for a person or being upset still hands over there too.
 */
export function decideHandover(input: HandoverInput): { reason: HandoverReason | null; salesTag: boolean } {
  const salesHere = (input.surface === "public" || input.surface === "bio") && !!input.ai?.sales;
  if (askedForHuman(input.text) || input.ai?.handover === "asked") return { reason: "asked", salesTag: salesHere };
  if (soundsUpset(input.text) || input.ai?.handover === "upset") return { reason: "upset", salesTag: salesHere };
  if (!salesHere && (matchedTopic(input.text, input.topics) || input.ai?.handover === "topic")) return { reason: "topic", salesTag: false };
  if (!input.ai) return { reason: "not_confident", salesTag: false };
  if (!input.ai.confident && !salesHere) return { reason: "not_confident", salesTag: false };
  return { reason: null, salesTag: salesHere };
}

export type LeadInput = {
  surface: Surface;
  planStatus: string | null; // the signed-in client's plan status, if any
  hasEmail: boolean;
  hasPhone: boolean;
  hasBusiness: boolean;
  visitorMessages: number;
  sales: boolean;
  signal: "none" | "warm" | "hot";
};

/** 0-100: how likely this chat brings or keeps money in. Creators score low; prospects and trial clients high. */
export function leadScore(i: LeadInput): number {
  let score = i.surface === "creator" ? 5 : i.planStatus === "trial" || i.planStatus === "pending_demo" ? 30 : i.planStatus ? 10 : 20;
  if (i.hasEmail) score += 15;
  if (i.hasPhone) score += 10;
  if (i.hasBusiness) score += 10;
  score += Math.min(i.visitorMessages, 5) * 3;
  if (i.sales) score += 15;
  score += i.signal === "hot" ? 30 : i.signal === "warm" ? 15 : 0;
  return Math.max(0, Math.min(100, score));
}

export function urgencyOf(upset: boolean, aiUrgency: "none" | "upset" | "urgent"): "upset" | "urgent" | null {
  if (upset || aiUrgency === "upset") return "upset";
  return aiUrgency === "urgent" ? "urgent" : null;
}

/** Who is asking: a signed-in client (owner or teammate of a business), a signed-in creator, or a possible customer. */
export type Person = "client" | "creator" | "prospect";

export function personOf(visitor: { userId: string | null; businessId: string | null; creatorProfileId: string | null }): Person {
  if (visitor.userId && visitor.businessId) return "client";
  if (visitor.userId && visitor.creatorProfileId) return "creator";
  return "prospect";
}

/** Pages only a possible customer needs: someone already signed in is never sent to sign up, log in or start a trial. */
export const SIGN_UP_PAGES = ["/signup", "/login", "/start-trial"];

/** The pages an AI button may open for this person: the base list and the guide's pages, minus sign-up pages for anyone signed in. */
export function allowedPagesFor(person: Person, pages: readonly string[]): string[] {
  const all = [...new Set(pages)];
  return person === "prospect" ? all : all.filter((p) => !SIGN_UP_PAGES.includes(p));
}

const MAX_TAGS = 8;

/** The conversation's tags after this message: earlier tags kept, new ones added, lead tags replaced by the latest. */
export function mergeTags(previous: readonly string[], add: { score: number; note: string | null; upset: boolean; sales: boolean; outsideHours: boolean; topics: readonly string[] }): string[] {
  const note = add.note?.trim().slice(0, 60) || null;
  const keep = previous.filter((t) => !/^(hot|warm) lead\b/.test(t) && !(add.upset && t.startsWith("upset")));
  const next = [
    add.score >= 70 ? `hot lead${note ? `: ${note}` : ""}` : add.score >= 50 ? `warm lead${note ? `: ${note}` : ""}` : null,
    add.upset ? `upset${note ? `: ${note}` : ""}` : null,
    add.sales ? "sales" : null,
    add.outsideHours ? "outside hours" : null,
    ...add.topics.map((t) => t.toLowerCase().slice(0, 30)),
  ].filter((t): t is string => !!t);
  return [...new Set([...next, ...keep])].slice(0, MAX_TAGS);
}

/** Tagged chats sort to the top of the agent's list: upset first, then urgent, then hot leads. */
export function priorityOf(c: { urgency: string | null; leadScore: number | null }): number {
  return c.urgency === "upset" ? 3 : c.urgency === "urgent" ? 2 : (c.leadScore ?? 0) >= 70 ? 1 : 0;
}
