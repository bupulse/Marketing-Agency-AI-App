// Contests (docs/CONTENT.md): the AI may suggest a challenge or contest post, but never invents its prize, end date or
// how the winner is chosen. It writes placeholders; the post waits as "Needs your confirmation: prize & rules" until
// the owner fills them in and confirms they will give the prize. Until then it cannot be approved, scheduled or
// published (lib/publishing/validate.ts), and a contest is never auto-approved. Pure.
import { z } from "zod";

export const CONTEST_NOTE = "Needs your confirmation: prize & rules";
export const PLACEHOLDERS = { prize: "[PRIZE]", endsOn: "[END DATE]", howChosen: "[HOW THE WINNER IS CHOSEN]" } as const;

/** Whether a text still has a contest placeholder (any spelling of the brackets' case). */
export function hasContestPlaceholders(text: string): boolean {
  return /\[(prize|end date|how the winner is chosen)\]/i.test(text);
}

/** A contest's rules line, appended when the writer forgot it. */
export const RULES_LINE = `Rules: ${PLACEHOLDERS.howChosen}. Ends ${PLACEHOLDERS.endsOn}. Prize: ${PLACEHOLDERS.prize}.`;

/** The contest post's text: placeholders kept for the owner, and always a short rules line. */
export function contestDraftText(text: string): string {
  const t = text.trim();
  return /\brules?\b\s*:/i.test(t) && hasContestPlaceholders(t) ? t : `${t}\n\n${RULES_LINE}`;
}

const clean = (max: number) => z.string().trim().min(1).max(max).refine((v) => !/[[\]<>]/.test(v), "Use plain text without brackets.");

export const contestConfirmSchema = z.object({
  prize: clean(120),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the end date."),
  howChosen: clean(200),
  willPay: z.literal(true, { message: "Confirm that you will give the prize." }),
});
export type ContestConfirm = z.infer<typeof contestConfirmSchema>;

/** "Friday 23 October" for the post. */
export function contestDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** The text with the owner's prize, end date and winner rule in place of the placeholders. */
export function applyContest(text: string, c: Pick<ContestConfirm, "prize" | "endsOn" | "howChosen">): string {
  return text
    .replace(/\[prize\]/gi, c.prize)
    .replace(/\[end date\]/gi, contestDate(c.endsOn))
    .replace(/\[how the winner is chosen\]/gi, c.howChosen);
}

/** Post.contest as stored: what the owner confirmed, or {} while it waits. */
export type StoredContest = { prize?: string; endsOn?: string; howChosen?: string; confirmedAt?: string };

export function readContest(value: unknown): StoredContest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  return { prize: s("prize"), endsOn: s("endsOn"), howChosen: s("howChosen"), confirmedAt: s("confirmedAt") };
}

/** A contest post may be approved only once confirmed and with no placeholder left. */
export function contestBlocked(post: { text: string; contest?: unknown }): boolean {
  if (hasContestPlaceholders(post.text)) return true;
  const c = readContest(post.contest);
  return c !== null && !c.confirmedAt;
}
