// How post statuses look and read. Client-safe (no server imports).

export type PostStatusName =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "NEEDS_ACTION"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export const STATUS_LABEL: Record<PostStatusName, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Needs approval",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  NEEDS_ACTION: "Post it yourself",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/**
 * Card colours per status (the owner's decision of 10 November 2026): green for scheduled and posted (a lighter green
 * until it is out), yellow for waiting for the owner's OK, red for failed; orange for "post it yourself" so it does not
 * read as waiting for approval. `hover` is the calendar card's hover: the same colour, stronger, with a soft glow.
 */
export const STATUS_STYLE: Record<PostStatusName, { card: string; dot: string; badge: string; hover: string }> = {
  DRAFT: { card: "border-line bg-soft/60", dot: "bg-muted", badge: "bg-soft text-muted", hover: "hover:border-muted/40 hover:bg-soft" },
  PENDING_APPROVAL: {
    card: "border-yellow-400/50 bg-yellow-300/15 dark:border-yellow-300/30 dark:bg-yellow-300/10",
    dot: "bg-yellow-400",
    badge: "bg-yellow-300/25 text-yellow-800 dark:bg-yellow-300/15 dark:text-yellow-200",
    hover: "hover:border-yellow-400/80 hover:bg-yellow-300/30 hover:shadow-yellow-400/25 dark:hover:border-yellow-300/60 dark:hover:bg-yellow-300/20",
  },
  SCHEDULED: {
    card: "border-success/20 bg-success/5",
    dot: "bg-success/70",
    badge: "bg-success-bg text-success",
    hover: "hover:border-success/45 hover:bg-success/15 hover:shadow-success/20",
  },
  PUBLISHING: {
    card: "border-success/20 bg-success/5",
    dot: "bg-success animate-pulse",
    badge: "bg-success-bg text-success",
    hover: "hover:border-success/45 hover:bg-success/15 hover:shadow-success/20",
  },
  PUBLISHED: {
    card: "border-success/35 bg-success-bg",
    dot: "bg-success",
    badge: "bg-success-bg text-success",
    hover: "hover:border-success/60 hover:bg-success/20 hover:shadow-success/25",
  },
  NEEDS_ACTION: {
    card: "border-orange-500/40 bg-orange-500/12",
    dot: "bg-orange-500",
    badge: "bg-orange-500/15 text-orange-800 dark:text-orange-300",
    hover: "hover:border-orange-500/70 hover:bg-orange-500/20 hover:shadow-orange-500/20",
  },
  FAILED: {
    card: "border-danger/30 bg-danger-bg",
    dot: "bg-danger",
    badge: "bg-danger-bg text-danger",
    hover: "hover:border-danger/60 hover:bg-danger/15 hover:shadow-danger/25",
  },
  CANCELLED: { card: "border-line bg-soft/40 opacity-70", dot: "bg-muted", badge: "bg-soft text-muted", hover: "hover:bg-soft/70" },
  // Missed its day 3 times (lib/content-board/carry-over.ts): history, until "Use again".
  EXPIRED: { card: "border-line bg-soft/40 opacity-80", dot: "bg-muted", badge: "bg-soft text-muted", hover: "hover:bg-soft/70" },
};

/** Statuses the owner can still edit. */
export const EDITABLE: readonly PostStatusName[] = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "FAILED", "NEEDS_ACTION"];
/** Statuses that can be dragged to another time. */
export const MOVABLE: readonly PostStatusName[] = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "FAILED", "NEEDS_ACTION"];
/** Statuses that count as "in the queue" (will go out at their time). */
export const QUEUED: readonly PostStatusName[] = ["SCHEDULED", "PENDING_APPROVAL", "PUBLISHING"];
