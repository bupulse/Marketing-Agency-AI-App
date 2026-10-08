import type { ApprovalView } from "./types";

/** Requests wait this long for the owner (same as APPROVAL_TTL_MS in the service). */
export const APPROVAL_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

export const isExpiredApproval = (a: Pick<ApprovalView, "status" | "createdAt">, now: number, ttl = APPROVAL_WAIT_MS) =>
  a.status === "pending" && new Date(a.createdAt).getTime() <= now - ttl;

/** Paddle may already have acted: the owner must look before anything else is done. */
export const approvalNeedsCheck = (status: string) => status === "needs_check" || status === "approved";

/** Live pending requests, and history (decided, expired, stuck), newest first. Pending never depends on the history query. */
export function splitApprovals(pendingRows: ApprovalView[], recent: ApprovalView[], now: number, ttl = APPROVAL_WAIT_MS) {
  const pending = pendingRows.filter((a) => a.status === "pending" && !isExpiredApproval(a, now, ttl));
  const history = [...pendingRows.filter((a) => isExpiredApproval(a, now, ttl)), ...recent.filter((a) => a.status !== "pending")].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
  return { pending, history };
}
