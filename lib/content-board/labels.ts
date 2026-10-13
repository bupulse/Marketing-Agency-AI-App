// Client-safe names and status chips for the Content page.
import type { PostStatusName } from "@/lib/publishing/status";

const NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube" };

export function networkLabel(network: string): string {
  return NAMES[network] ?? network;
}

export type ChipTone = "review" | "scheduled" | "posted" | "failed" | "draft" | "action";

/** The card's status chip: what it says and its tone. `when` formats an instant in the business's zone. */
export function statusChip(
  post: { status: PostStatusName; scheduledAt: string | null; publishedAt: string | null },
  when: (iso: string) => string,
): { label: string; tone: ChipTone } {
  switch (post.status) {
    case "PENDING_APPROVAL":
      return { label: "Needs review", tone: "review" };
    case "DRAFT":
      return { label: "Draft", tone: "draft" };
    case "SCHEDULED":
      return { label: post.scheduledAt ? `Scheduled for ${when(post.scheduledAt)}` : "Scheduled", tone: "scheduled" };
    case "PUBLISHING":
      return { label: "Posting now", tone: "scheduled" };
    case "NEEDS_ACTION":
      return { label: "Post it yourself", tone: "action" };
    case "PUBLISHED":
      return { label: post.publishedAt ? `Posted ${when(post.publishedAt)}` : "Posted", tone: "posted" };
    case "FAILED":
      return { label: "Failed", tone: "failed" };
    default:
      return { label: "Cancelled", tone: "draft" };
  }
}

export const CHIP_STYLE: Record<ChipTone, string> = {
  review: "bg-new-bg text-new",
  draft: "bg-soft text-muted",
  scheduled: "bg-ok-bg text-ok",
  posted: "bg-success-bg text-success",
  failed: "bg-danger-bg text-danger",
  action: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

/** What Approve or Approve all says, including posts no free time was found for. */
export function approvedMessage(res: { approved?: unknown; skipped?: unknown }, total: number): { text: string; tone: "success" | "error" } {
  const approved = Number(res.approved ?? 0);
  const skipped = Number(res.skipped ?? 0);
  if (skipped > 0) {
    const missed = skipped === 1 ? "1 could not find a free time" : `${skipped} could not find a free time`;
    return { text: `Approved ${approved} of ${total}. ${missed}: open ${skipped === 1 ? "it" : "them"} and pick a time.`, tone: approved > 0 ? "success" : "error" };
  }
  if (total === 1) return { text: "Approved. It goes out at the best time.", tone: "success" };
  return { text: `${approved} posts approved. Each goes out at the best time for its app.`, tone: "success" };
}

/** Statuses of posts that have not gone out yet (the board highlights them). */
export const UNPOSTED: readonly PostStatusName[] = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "NEEDS_ACTION"];

/** The "Not posted yet" note's reason for a card. */
export function unpostedReason(post: { status: PostStatusName; remindOnly?: boolean; reviewNote?: string | null; network: string }, when: (iso: string) => string, scheduledAt: string | null): string {
  if (post.remindOnly) return `${networkLabel(post.network)} not connected`;
  switch (post.status) {
    case "PENDING_APPROVAL":
      return post.reviewNote ?? "Waiting for your OK";
    case "DRAFT":
      return "Draft";
    case "NEEDS_ACTION":
      return "Waiting for you to post it";
    case "PUBLISHING":
      return "Going out now";
    default:
      return scheduledAt ? `Goes out ${when(scheduledAt)}` : "Scheduled";
  }
}
