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
