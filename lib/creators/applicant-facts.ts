// What the company's Applicants list shows about each applicant (docs/CREATOR_CAMPAIGN_WIZARD.md, "Requirements" and
// "Followers"). Pure: the answers as stored, read back and put in words; the facts matchApplicant() needs; and the
// follower count a connected account verifies.
//
// Owner decisions (22 October 2026): requirements never block, the company sees "Matches" or "Doesn't match" and why,
// the ones who match first; what creators type for followers is kept, and once they connect the account the company
// sees "Verified" or the difference.

import { answerInWords, type Answer, type ApplicationForm, type FormField } from "./form-fields";
import { SOCIAL_LABEL, isSocialNetwork } from "./networks";
import { matchApplicant, type ApplicantFacts, type CreatorRequirements } from "./requirements";

/** One stored answer (CampaignCreator.answers values, Json) as an Answer, or null when it has an unknown shape. */
export function storedAnswer(value: unknown): Answer | null {
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.every((v) => typeof v === "string") ? (value as string[]) : null;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.min === "number" && typeof o.max === "number") return { min: o.min, max: o.max };
    if (typeof o.from === "string" && typeof o.to === "string") return { from: o.from, to: o.to };
  }
  return null;
}

/** CampaignCreator.answers as stored, read into Answers by field id. */
export function storedAnswers(value: unknown): Record<string, Answer> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Answer> = {};
  for (const [id, v] of Object.entries(value as Record<string, unknown>)) {
    const a = storedAnswer(v);
    if (a !== null) out[id] = a;
  }
  return out;
}

/** The answer of the field added from a preset ("location", "languages", "niches"). */
function presetAnswer(form: ApplicationForm, answers: Record<string, Answer>, preset: string): Answer | null {
  const field = form.fields.find((f) => (f.preset ?? f.id) === preset);
  return field ? (answers[field.id] ?? null) : null;
}

const asList = (a: Answer | null): string[] | null => (Array.isArray(a) ? a : typeof a === "string" && a.trim() ? a.split(/\s*,\s*/).filter(Boolean) : null);

/**
 * The facts to match an applicant on: their accounts' followers (the verified count where there is one), and the
 * answers to the location, languages and niches presets. A marketplace applicant who was not asked where they live
 * is placed by their profile's location.
 */
export function factsOf(form: ApplicationForm, answers: Record<string, Answer>, followers: number[], profileLocation?: string | null): ApplicantFacts {
  const where = presetAnswer(form, answers, "location");
  return {
    followers,
    location: typeof where === "string" && where.trim() ? where : (profileLocation ?? null),
    languages: asList(presetAnswer(form, answers, "languages")),
    niches: asList(presetAnswer(form, answers, "niches")),
  };
}

/** True when the campaign asks for anything matchApplicant() checks. */
export const hasRequirements = (req: CreatorRequirements) => Boolean(req.minFollowers || req.locations.length || req.languages.length || req.niches.length);

export type MatchState = { kind: "match" | "unknown" | "miss" | "none"; misses: string[]; unknown: string[] };

/** "Matches", "<not given>" only, or "Doesn't match: <reasons>"; "none" when the campaign has no requirements. */
export function matchState(req: CreatorRequirements, facts: ApplicantFacts): MatchState {
  if (!hasRequirements(req)) return { kind: "none", misses: [], unknown: [] };
  const { misses, unknown } = matchApplicant(req, facts);
  return { kind: misses.length ? "miss" : unknown.length ? "unknown" : "match", misses, unknown };
}

const MATCH_ORDER: Record<MatchState["kind"], number> = { match: 0, none: 0, unknown: 1, miss: 2 };

/** The rows, those who match first, then those who left something out, then those who don't (stable otherwise). */
export function sortByMatch<T>(rows: T[], stateOf: (row: T) => MatchState | undefined): T[] {
  return rows
    .map((row, i) => ({ row, i, rank: MATCH_ORDER[stateOf(row)?.kind ?? "none"] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.row);
}

export type AnswerLine = { id: string; label: string; text: string; file?: string | null };

/** The form's answers as the company reads them, in the form's order; an upload carries its signed link (`urls`). */
export function answerLines(form: ApplicationForm, answers: Record<string, Answer>, urls: Map<string, string>, currency: string): AnswerLine[] {
  const out: AnswerLine[] = [];
  for (const field of form.fields) {
    const value = answers[field.id];
    if (value === undefined || value === null || value === "") continue;
    out.push({ id: field.id, label: field.label, text: answerInWords(field, value, currency), ...(field.type === "UPLOAD" ? { file: typeof value === "string" ? (urls.get(value) ?? null) : null } : {}) });
  }
  return out;
}

/** The UPLOAD answers' storage paths, to sign. */
export const uploadAnswers = (fields: FormField[], answers: Record<string, Answer>) => fields.filter((f) => f.type === "UPLOAD" && typeof answers[f.id] === "string").map((f) => answers[f.id] as string);

// ---- Followers a connected account verifies ----

/** A connected account as the follower check needs it. */
export type CountedAccount = { network: string; username: string | null; displayName: string | null; followers: number | null };

const bare = (v: string | null | undefined) => (v ?? "").trim().replace(/^@+/, "").toLowerCase();

/** The connected account behind a typed handle: same network, the same name, or the only one on that network. */
export function accountFor<T extends CountedAccount>(handle: { network: string; handle: string }, accounts: T[]): T | null {
  const same = accounts.filter((a) => a.network === handle.network);
  const named = same.find((a) => bare(a.username) === bare(handle.handle) || bare(a.displayName) === bare(handle.handle));
  return named ?? (same.length === 1 ? same[0] : null);
}

/** Within this share above the real count, what they typed still counts as verified (counts move from day to day). */
const VERIFIED_SLACK = 0.1;

export type FollowerCheck = { kind: "verified"; has: number } | { kind: "differs"; said: number; has: number };

/** What the connected account says against what they typed; null when the account's count is not known. */
export function followerCheck(said: number | null | undefined, has: number | null | undefined): FollowerCheck | null {
  if (has === null || has === undefined) return null;
  if (said === null || said === undefined || said <= has * (1 + VERIFIED_SLACK)) return { kind: "verified", has };
  return { kind: "differs", said, has };
}

/** "12,300 followers · Verified" or "Said 20,000 · has 12,300". */
export function followerCheckInWords(check: FollowerCheck): string {
  const n = (v: number) => v.toLocaleString("en-US");
  return check.kind === "verified" ? `${n(check.has)} followers · Verified` : `Said ${n(check.said)} · has ${n(check.has)}`;
}

/** The network's name for any stored network. */
export const anyNetworkLabel = (n: string) => (isSocialNetwork(n) ? SOCIAL_LABEL[n] : n);
