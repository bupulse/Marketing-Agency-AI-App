// What the post window says about approving a post whose time has passed (docs/guide/features/07-calendar-and-publishing.md).
// approvePosts (lib/publishing/service.ts) moves such a post to the next good free time; the owner should know that
// before pressing Approve. Pure, so it is tested.

/** True when the post waits for approval and its time is now or past. */
export function approvalTimePassed(post: { status: string; scheduledAt: string | Date | null }, now: Date = new Date()): boolean {
  if (post.status !== "PENDING_APPROVAL" || !post.scheduledAt) return false;
  return new Date(post.scheduledAt).getTime() <= now.getTime();
}

export const TIME_PASSED_NOTE = "Its time has passed. Approve it and BuPulse posts it at the next good time, or pick a new time with Move.";
export const APPROVED_LATE = "Approved. Its time had passed, so it goes out at the next good time.";
