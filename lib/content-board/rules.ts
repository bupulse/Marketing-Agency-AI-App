// Auto-approval's safety rules (docs/CONTENT.md): may a post waiting for review be scheduled on its own? Pure, so the
// rules are tested on their own and the server (lib/content-board/auto.ts) only gathers the facts.
import { networkLabel } from "./labels";

export interface AutoFacts {
  network: string;
  format: string;
  /** Content -> Settings says this app's posts wait for approval. */
  requireApproval: boolean;
  /** The plan includes scheduling (the calendar feature) and the account is not read-only. */
  canSchedule: boolean;
  /** The connected account, or null when the post has none (disconnected, or an app not connected yet). */
  account: { usable: boolean } | null;
  /** A post for an app that is not connected yet: it goes out as a "post it yourself" reminder, no account needed. */
  byHand?: boolean;
  /** The network needs a picture or video (Instagram, TikTok, YouTube). */
  requiresMedia: boolean;
  hasMedia: boolean;
  hasVideo: boolean;
  /** A video is planned for the post's content but not rendered yet (it renders in the owner's browser). */
  videoPending: boolean;
  /** The picture is planned but not drawn yet. */
  imagePending: boolean;
  /** The network's rules the post breaks (text too long, too many hashtags...). */
  issues: readonly string[];
}

export type AutoDecision = { action: "wait" } | { action: "review"; reason: string } | { action: "schedule" };

export const REVIEW_REASONS = {
  plan: "Scheduling is not part of your plan right now, so this post waits for you.",
  noAccount: "Connect this app in Channels first.",
  video: "Video needs to be made: open to render.",
  picture: "The picture is still being made: open it to finish.",
  noPicture: "This post needs a picture. Add one to post it.",
} as const;

/**
 * - The app needs approval: the post waits, with no note (that is the owner's choice, not a problem).
 * - Otherwise it is scheduled unless something would make it fail or go out unfinished: no scheduling in the plan,
 *   no usable account, a video idea whose video is planned but not rendered yet (videos are made in the browser, so it
 *   waits as "Needs review" rather than going out as a picture: the idea was a video), a picture not drawn yet or
 *   missing, or the network's rules. Then it waits with the reason.
 * - A video idea with no video planned (the plan has no video) is the network's script reminder, as before: scheduled.
 * - A post for an app that is not connected yet is scheduled as a "post it yourself" reminder (same checks otherwise).
 */
export function autoDecision(f: AutoFacts): AutoDecision {
  if (f.requireApproval) return { action: "wait" };
  if (!f.canSchedule) return { action: "review", reason: REVIEW_REASONS.plan };
  if (!f.account && !f.byHand) return { action: "review", reason: REVIEW_REASONS.noAccount };
  if (f.account && !f.account.usable) return { action: "review", reason: `${networkLabel(f.network)} needs to be reconnected first. Open Channels to fix it.` };
  const videoIdea = f.format === "SCRIPT";
  if (videoIdea && !f.hasVideo && f.videoPending) return { action: "review", reason: REVIEW_REASONS.video };
  const needsPicture = f.requiresMedia && !videoIdea && f.format !== "ARTICLE";
  if (needsPicture && !f.hasMedia) return { action: "review", reason: f.imagePending ? REVIEW_REASONS.picture : REVIEW_REASONS.noPicture };
  if (f.issues.length > 0) return { action: "review", reason: f.issues[0] };
  return { action: "schedule" };
}
