// How post statuses look and read. Client-safe (no server imports).

export type PostStatusName =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "NEEDS_ACTION"
  | "FAILED"
  | "CANCELLED";

export const STATUS_LABEL: Record<PostStatusName, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Needs approval",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  NEEDS_ACTION: "Post it yourself",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** Card colours per status (tokens from globals.css; amber for "you need to do something"). */
export const STATUS_STYLE: Record<PostStatusName, { card: string; dot: string; badge: string }> = {
  DRAFT: { card: "border-line bg-soft/60", dot: "bg-muted", badge: "bg-soft text-muted" },
  PENDING_APPROVAL: { card: "border-new/30 bg-new-bg", dot: "bg-new", badge: "bg-new-bg text-new" },
  SCHEDULED: { card: "border-ok/25 bg-ok-bg", dot: "bg-ok", badge: "bg-ok-bg text-ok" },
  PUBLISHING: { card: "border-ok/25 bg-ok-bg", dot: "bg-ok animate-pulse", badge: "bg-ok-bg text-ok" },
  PUBLISHED: { card: "border-success/25 bg-success-bg", dot: "bg-success", badge: "bg-success-bg text-success" },
  NEEDS_ACTION: {
    card: "border-amber-500/40 bg-amber-500/15",
    dot: "bg-amber-500",
    badge: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  FAILED: { card: "border-danger/30 bg-danger-bg", dot: "bg-danger", badge: "bg-danger-bg text-danger" },
  CANCELLED: { card: "border-line bg-soft/40 opacity-70", dot: "bg-muted", badge: "bg-soft text-muted" },
};

/** Statuses the owner can still edit. */
export const EDITABLE: readonly PostStatusName[] = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "FAILED", "NEEDS_ACTION"];
/** Statuses that can be dragged to another time. */
export const MOVABLE: readonly PostStatusName[] = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "FAILED", "NEEDS_ACTION"];
/** Statuses that count as "in the queue" (will go out at their time). */
export const QUEUED: readonly PostStatusName[] = ["SCHEDULED", "PENDING_APPROVAL", "PUBLISHING"];
