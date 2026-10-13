// Angles (docs/CONTENT.md, "Create today's content"): every day a product's, campaign's or General's posts are written
// from a different angle (price, how it works, a customer story...), with a different hook and structure, so
// consecutive days never read alike. Pure: the service reads the history (ContentAngle rows) and saves the choice.

export const ANGLES = [
  { id: "offer", label: "Price or offer", guide: "Lead with the price or offer exactly as the facts state it, and why it is worth it now.", needs: "price" },
  { id: "how", label: "How it works", guide: "Explain simply how it works or how a customer gets it, step by step.", needs: null },
  { id: "benefits", label: "Features and benefits", guide: "Pick one or two features and say what each one does for the customer.", needs: null },
  { id: "news", label: "News or announcement", guide: "Announce something: what is new, starting or happening, only from the facts given.", needs: "news" },
  { id: "story", label: "Customer story", guide: "Tell a short customer story using one review from the CUSTOMER REVIEWS block, quoted word for word with the name given. Never invent a customer.", needs: "reviews" },
  { id: "tips", label: "Tips", guide: "Give 2 or 3 practical tips related to it that help the customer, then link back to the offer.", needs: null },
  { id: "faq", label: "Question customers ask", guide: "Answer one question customers ask, using only the business's own answer given.", needs: "faq" },
  { id: "why", label: "Why choose us", guide: "Say what makes the business different, from the positioning and selling points (never name a competitor).", needs: null },
  { id: "behind", label: "Behind the scenes", guide: "Show how it is made, prepared or delivered, or the people behind it, using only the facts given.", needs: null },
  { id: "local", label: "Local moment", guide: "Tie it to everyday life where the customers are (the season, the time of week, the area served), without inventing events or dates.", needs: null },
  { id: "cta", label: "Call to action", guide: "A short, direct invitation to act today: order, book, visit or message, with one clear step.", needs: null },
] as const;

export type AngleId = (typeof ANGLES)[number]["id"];
export type AngleNeed = "price" | "news" | "reviews" | "faq";

export const HOOKS = [
  { id: "question", guide: "Open with a question the customer would ask themselves." },
  { id: "bold", guide: "Open with a short, bold statement." },
  { id: "scene", guide: "Open with a one-line everyday scene the customer recognises." },
  { id: "direct", guide: "Open by speaking straight to the customer (you...)." },
  { id: "fact", guide: "Open with one concrete fact from the details given (never an invented number)." },
  { id: "contrast", guide: "Open with a before / after or problem / solution contrast." },
] as const;

export const STRUCTURES = [
  { id: "punchy", guide: "Short punchy lines, one idea per line." },
  { id: "story", guide: "A mini story: situation, what changed, invitation." },
  { id: "list", guide: "A short list of 2 or 3 points, then the call to action." },
  { id: "qa", guide: "A question, then the answer in two or three sentences." },
  { id: "oneliner", guide: "One strong sentence and a call to action; nothing more." },
] as const;

export type HookId = (typeof HOOKS)[number]["id"];
export type StructureId = (typeof STRUCTURES)[number]["id"];

export type AngleChoice = { angle: AngleId; hook: HookId; structure: StructureId };
export type AngleHistory = { day: string; angle: string; hook?: string | null; structure?: string | null }[];

/** What the subject's facts allow: no price angle without a price, no customer story without a quotable review... */
export type AngleFacts = { hasPrice: boolean; hasNews: boolean; reviews: number; faqs: number };

export function isAngleId(value: unknown): value is AngleId {
  return typeof value === "string" && ANGLES.some((a) => a.id === value);
}

export function angleInfo(id: string | null | undefined) {
  return ANGLES.find((a) => a.id === id) ?? null;
}

export function availableAngles(facts: AngleFacts): AngleId[] {
  const ok: Record<AngleNeed, boolean> = { price: facts.hasPrice, news: facts.hasNews, reviews: facts.reviews > 0, faq: facts.faqs > 0 };
  return ANGLES.filter((a) => a.needs === null || ok[a.needs]).map((a) => a.id);
}

/** A small stable hash, so the same subject and day always get the same tie-break (no randomness in tests). */
export function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The least recently used option that was not used on the days just before (`avoidDays`), ties broken by the seed.
 * Never-used options come first. Options used on the same day (an earlier run today) count as the most recent.
 */
function leastRecent<T extends string>(options: readonly T[], uses: { day: string; value: string | null | undefined }[], day: string, key: string): T {
  const last = new Map<string, string>();
  for (const u of uses) if (u.value && u.day <= day && (!last.has(u.value) || last.get(u.value)! < u.day)) last.set(u.value, u.day);
  const s = seed(`${key}|${day}`);
  const ranked = options
    .map((o, i) => ({ o, at: last.get(o) ?? "", tie: (s + i * 2654435761) >>> 0 }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.tie - b.tie));
  return ranked[0].o;
}

/**
 * The angle, hook and structure for a subject on a day. Least recently used first, so every angle the facts allow is
 * used before one comes back, and consecutive days always differ (as long as two or more angles are possible).
 */
export function pickAngle(input: { subjectKey: string; day: string; history: AngleHistory; facts: AngleFacts }): AngleChoice {
  const options = availableAngles(input.facts);
  const history = input.history.filter((h) => h.day <= input.day);
  const angle = leastRecent(options, history.map((h) => ({ day: h.day, value: h.angle })), input.day, `${input.subjectKey}|angle`);
  const hook = leastRecent(HOOKS.map((h) => h.id), history.map((h) => ({ day: h.day, value: h.hook })), input.day, `${input.subjectKey}|hook`);
  const structure = leastRecent(STRUCTURES.map((s) => s.id), history.map((h) => ({ day: h.day, value: h.structure })), input.day, `${input.subjectKey}|structure`);
  return { angle, hook, structure };
}

/** The angle lines for a writer's prompt. */
export function angleLines(choice: AngleChoice): string[] {
  const a = angleInfo(choice.angle)!;
  return [
    `Today's angle: ${a.label}. ${a.guide}`,
    `Hook: ${HOOKS.find((h) => h.id === choice.hook)?.guide ?? ""}`,
    `Structure: ${STRUCTURES.find((s) => s.id === choice.structure)?.guide ?? ""}`,
  ];
}

/** "product:<id>", "campaign:<id>" or "general": the key angles are remembered under. */
export function subjectKeyOf(scope: { kind: "product" | "campaign"; id: string } | { kind: "general" }): string {
  return scope.kind === "general" ? "general" : `${scope.kind}:${scope.id}`;
}
