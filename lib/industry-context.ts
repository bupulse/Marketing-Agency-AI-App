// The company's sector in the AI's words: the guided fields of its Industry row (Admin -> Industries) plus the owner's
// own description from sign-up, as one compact block for the system context of content generation, Autopilot and the
// website chat. Pure (no server imports): every prompt builder calls industryContext() on the loaded business.

/** The guided fields of an Industry row (lib/generated Industry minus the bookkeeping columns). */
export type IndustryGuide = {
  name: string;
  shortDescription: string;
  customers: string;
  offerings: string;
  postIdeas: string;
  tone: string;
  hashtags: string[];
  seasons: string;
  avoid: string;
};

/** What industryContext needs from a Business row (every field optional so partial selects work). */
export type IndustryBusiness = {
  industry?: string | null;
  industryOther?: string | null;
  industryDescription?: string | null;
  /** Onboarding "what you sell": the fallback when the sign-up description is missing (companies from before 12 Oct 2026). */
  description?: string | null;
  industryRef?: IndustryGuide | null;
};

/** Default size of the whole block, in characters (about 400 tokens): small next to the prompts' existing budgets. */
export const INDUSTRY_CONTEXT_MAX = 1600;
/** Each guided field is cut to this many characters before the whole block is sized. */
export const INDUSTRY_FIELD_MAX = 320;

/** Cuts at a word boundary and marks the cut, like lib/studio/variants truncateSmart but without the sentence rules. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(0, max - 1));
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

const line = (label: string, value: string | null | undefined, max = INDUSTRY_FIELD_MAX) => {
  const v = value?.trim();
  return v ? `- ${label}: ${clip(v, max)}` : null;
};

/**
 * The industry block for a prompt, or "" when the business has no sector and no description. The owner's own words
 * come first (they are facts about this company); the sector guidance follows and is marked as general guidance so the
 * writer does not treat it as facts about the business (no invented offerings, dates or hashtags as claims).
 */
export function industryContext(business: IndustryBusiness | null | undefined, opts: { maxChars?: number } = {}): string {
  if (!business) return "";
  const max = opts.maxChars ?? INDUSTRY_CONTEXT_MAX;
  const guide = business.industryRef ?? null;
  const other = business.industryOther?.trim() || null;
  const own = business.industryDescription?.trim() || business.description?.trim() || null;
  const label = guide?.name?.trim() || other || business.industry?.trim() || null;
  if (!label && !own) return "";

  const head: string[] = [];
  if (guide) head.push(`Industry: ${guide.name}${guide.shortDescription?.trim() ? ` (${clip(guide.shortDescription, 160)})` : ""}`);
  else if (label) head.push(`Industry (in the owner's words): ${clip(label, 120)}`);
  if (own) head.push(`About this business, in the owner's words: ${clip(own, 520)}`);

  const guidance = guide
    ? [
        "Sector guidance (general knowledge about this kind of business, not facts about this one; use it for ideas, tone and timing, never as claims):",
        line("Typical customers", guide.customers),
        line("Typical products and services", guide.offerings),
        line("Post ideas that work", guide.postIdeas),
        line("Tone", guide.tone, 200),
        guide.hashtags?.length ? `- Hashtags that fit: ${guide.hashtags.slice(0, 12).join(" ")}` : null,
        line("Dates and seasons in Rwanda and East Africa", guide.seasons),
        line("Avoid (words, claims, compliance)", guide.avoid),
      ].filter(Boolean)
    : [];

  const text = [...head, ...guidance].join("\n");
  if (text.length <= max) return text;
  // Over budget: drop guidance lines from the bottom up, keeping the owner's words and the "avoid" line when possible.
  const keep = [...head];
  const avoid = guidance.find((l) => l?.startsWith("- Avoid")) ?? null;
  const rest = guidance.filter((l) => l !== avoid);
  let out = [...keep, ...(avoid ? [avoid] : [])].join("\n");
  for (const l of rest) {
    const next = [...keep, ...rest.slice(0, rest.indexOf(l) + 1), ...(avoid ? [avoid] : [])].join("\n");
    if (next.length > max) break;
    out = next;
  }
  return out.length <= max ? out : clip(out, max);
}
