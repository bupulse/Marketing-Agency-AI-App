// "Select" -> "Delete" on the Posts pages: which posts may go in one go, and why the others stay. Pure (no server
// imports), so the cards, the server action and the tests share one rule.

/** Most posts one bulk delete takes: a page shows at most a few dozen waiting at once. */
export const MAX_BULK_DELETE = 100;

/**
 * Posts that wait for the owner and were never posted: "Needs your OK" (drafts and posts waiting for approval) and
 * "Expired" (missed their day 3 times). Scheduled, going out, posted, failed or cancelled posts are never bulk deleted:
 * those are deleted one at a time from the post itself, where BuPulse says what happens on the app.
 */
export const BULK_DELETABLE = ["DRAFT", "PENDING_APPROVAL", "EXPIRED"] as const;

export type BulkSkipReason = "not_found" | "publishing" | "posted" | "not_waiting" | "changed";

/** Why posts stayed, for one post and for several. */
export const BULK_SKIP_TEXT: Record<BulkSkipReason, [one: string, many: string]> = {
  not_found: ["could not be found", "could not be found"],
  publishing: ["is going out right now", "are going out right now"],
  posted: ["is already posted", "are already posted"],
  not_waiting: ["is scheduled or no longer waiting", "are scheduled or no longer waiting"],
  changed: ["changed while you were looking", "changed while you were looking"],
};

/** Can this card be picked for "Delete selected"? */
export function bulkDeletable(status: string): boolean {
  return (BULK_DELETABLE as readonly string[]).includes(status);
}

/** Why one post may not be bulk deleted, or null when it may. A post the publisher holds (lockedAt) is going out. */
export function bulkSkipReason(row: { status: string; lockedAt: Date | null } | undefined): BulkSkipReason | null {
  if (!row) return "not_found";
  if (row.status === "PUBLISHING" || row.lockedAt) return "publishing";
  if (row.status === "PUBLISHED") return "posted";
  if (!bulkDeletable(row.status)) return "not_waiting";
  return null;
}

/**
 * "Select all" in select mode: at most MAX_BULK_DELETE are picked, so with more waiting the button says "Select 100"
 * and, once those are picked, "Clear all" (it used to keep saying "Select all 140" and never offered to clear).
 */
export function selectAllButton(total: number, selected: number): { all: boolean; label: string } {
  const cap = Math.min(total, MAX_BULK_DELETE);
  const all = total > 0 && selected >= cap;
  return { all, label: all ? "Clear all" : total > MAX_BULK_DELETE ? `Select ${MAX_BULK_DELETE}` : `Select all ${total}` };
}

export type BulkDeleteResult ={ deleted: number; skipped: { id: string; reason: BulkSkipReason }[] };

/** The toast after a bulk delete: how many went and, in plain words, why any stayed. */
export function bulkDeleteMessage(res: BulkDeleteResult): { text: string; tone: "success" | "error" } {
  const gone = res.deleted === 1 ? "1 post deleted." : `${res.deleted} posts deleted.`;
  if (res.skipped.length === 0) return { text: gone, tone: "success" };
  const counts = new Map<BulkSkipReason, number>();
  for (const s of res.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const why = [...counts].map(([reason, n]) => `${n} ${BULK_SKIP_TEXT[reason][n === 1 ? 0 : 1]}`).join(", ");
  const kept = res.skipped.length === 1 ? "1 post was kept" : `${res.skipped.length} posts were kept`;
  return { text: `${res.deleted > 0 ? `${gone} ` : ""}${kept}: ${why}.`, tone: res.deleted > 0 ? "success" : "error" };
}
