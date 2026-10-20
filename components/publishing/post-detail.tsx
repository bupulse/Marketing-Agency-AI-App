"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCheck, ClipboardCopy, Copy, Download, ExternalLink, Pencil, PlugZap, RotateCw, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { Badge, Button, Dialog, useToast } from "@/components/ui";
import {
  approvePostsAction,
  connectByHandPostsAction,
  deletePostAction,
  duplicatePostAction,
  markPostedAction,
  reschedulePostAction,
  retryPostAction,
  unschedulePostAction,
} from "@/app/dashboard/calendar/actions";
import { PostWriting } from "@/components/content-flow/post-writing";
import { WhatsAppShare } from "@/components/share/whatsapp-share";
import { postShareCaption } from "@/lib/share/whatsapp";
import { EDITABLE, STATUS_LABEL, STATUS_STYLE } from "@/lib/publishing/status";
import { parseLocalInput, toLocalInput } from "@/lib/publishing/time";
import type { CalendarPost, PostOutcome } from "@/lib/publishing/types";
import { formatDateTime } from "./helpers";
import { NetworkIcon, networkName } from "./network-icon";
import { PostPreview } from "./post-preview";
import { ResultsPanel } from "./post-results";

type Props = {
  post: CalendarPost | null;
  zone: string;
  onClose: () => void;
  onEdit: (post: CalendarPost) => void;
  /** Where the post's picture or video is made (its product, campaign or Autopilot), for "Needs review" notes. */
  visualHref?: string | null;
  /** Apps with a connected account BuPulse posts to: a post made for one before it was connected can switch to it. */
  autoNetworks?: readonly string[];
  /** The posts written together with this one (same groupId): a published post shows the results of each network. */
  group?: readonly CalendarPost[];
};

/** One post in full: how it looks, what happened to it, and what the owner can do about it. */
export function PostDetail({ post, zone, onClose, onEdit, visualHref, autoNetworks, group }: Props) {
  return (
    <Dialog open={post !== null} onOpenChange={(o) => !o && onClose()} title={post ? `${networkName(post.network)} post` : "Post"} className="max-w-2xl">
      {post && <DetailBody key={post.id} post={post} zone={zone} onClose={onClose} onEdit={onEdit} visualHref={visualHref} autoNetworks={autoNetworks} group={group} />}
    </Dialog>
  );
}

function retryMessage(res: Record<string, unknown>): { text: string; tone: "success" | "error" } {
  const outcome = (res.outcomes as PostOutcome[] | undefined)?.[0];
  if (outcome?.status === "PUBLISHED") return { text: "Published.", tone: "success" };
  if (outcome?.status === "NEEDS_ACTION") return { text: "We emailed you a reminder to post it.", tone: "success" };
  if (outcome?.status === "FAILED") return { text: outcome.error ?? "It failed again.", tone: "error" };
  return { text: "We will try again shortly.", tone: "success" };
}

function DetailBody({ post, zone, onClose, onEdit, visualHref, autoNetworks = [], group = [] }: Omit<Props, "post"> & { post: CalendarPost }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveTo, setMoveTo] = useState(() => (post.scheduledAt ? toLocalInput(new Date(post.scheduledAt), zone) : ""));
  const [error, setError] = useState<string | null>(null);
  const style = STATUS_STYLE[post.status];
  const editable = (EDITABLE as readonly string[]).includes(post.status);
  // Results (when the plan shows them, lib/publishing/results.ts): this post first, then its other networks.
  const withResults = post.status === "PUBLISHED" && post.results ? [post, ...group.filter((p) => p.id !== post.id && p.status === "PUBLISHED" && p.results)] : null;

  function act(run: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, success: string | ((res: Record<string, unknown>) => { text: string; tone: "success" | "error" }), closeAfter = true) {
    setError(null);
    startTransition(async () => {
      const res = await run();
      if (!res.ok) return setError(res.error ?? "That did not work. Please try again.");
      const message = typeof success === "string" ? { text: success, tone: "success" as const } : success(res);
      toast(message.text, message.tone);
      router.refresh();
      if (closeAfter) onClose();
    });
  }

  function reschedule() {
    const at = parseLocalInput(moveTo, zone);
    if (!at) return setError("Pick a valid date and time.");
    act(() => reschedulePostAction(post.id, at.toISOString()), "Moved.");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <NetworkIcon network={post.network} size={22} />
        <span className="text-[15px] font-semibold">{post.accountName}</span>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${style.badge}`}>{STATUS_LABEL[post.status]}</span>
        {post.source === "AUTOPILOT" && <Badge tone="violet">Autopilot</Badge>}
        {post.source === "DAILY" && <Badge tone="violet">Made for you</Badge>}
        {post.autoScheduledAt && post.status !== "PENDING_APPROVAL" && <Badge tone="blue">Auto-scheduled</Badge>}
        {post.scheduledAt && <span className="text-[13px] text-muted">{post.status === "PUBLISHED" && post.publishedAt ? `Published ${formatDateTime(post.publishedAt, zone)}` : formatDateTime(post.scheduledAt, zone)}</span>}
      </div>

      {post.status === "FAILED" && (
        <div role="alert" className="flex gap-2.5 rounded-2xl bg-danger-bg p-3.5 text-[14px] text-danger">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>{post.lastError ?? "This post could not be published."}</p>
        </div>
      )}
      {post.status === "PENDING_APPROVAL" && post.reviewNote && (
        <p role="note" className="rounded-2xl bg-new-bg p-3.5 text-[14px] text-new">
          {post.reviewNote}{" "}
          {visualHref && (
            <Link href={visualHref} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
              Open it
            </Link>
          )}
        </p>
      )}
      {post.status === "SCHEDULED" && post.autoScheduledAt && (
        <p className="rounded-2xl bg-soft p-3.5 text-[14px] text-muted">Scheduled on its own because this app needs no approval. You can change it, move it, take it back to review or delete it until it goes out.</p>
      )}
      {post.remindOnly && post.status !== "PUBLISHED" && (
        <div className="flex flex-col gap-2 rounded-2xl bg-amber-500/15 p-3.5 text-[14px] text-amber-900 dark:text-amber-200">
          <p>
            {networkName(post.network)} is not connected to BuPulse, so this post is a reminder: at its time you get an email with the caption and the {post.media.some((m) => /\.(mp4|webm)$/i.test(m.path)) ? "video" : "pictures"} to post it yourself, then press &ldquo;Mark as posted&rdquo;.
          </p>
          {autoNetworks.includes(post.network) ? (
            <p className="font-medium">{networkName(post.network)} is connected now. Switch this post to publish automatically.</p>
          ) : (
            <Link href="/dashboard/connections" className="inline-flex min-h-11 w-fit items-center font-semibold underline underline-offset-2">
              Connect {networkName(post.network)}
            </Link>
          )}
        </div>
      )}
      {post.status === "NEEDS_ACTION" && (
        <p className="rounded-2xl bg-amber-500/15 p-3.5 text-[14px] text-amber-900 dark:text-amber-200">
          We emailed you a reminder to post this on {networkName(post.network)}. Once it is up, press &ldquo;Mark as posted&rdquo;.
        </p>
      )}
      {post.status === "SCHEDULED" && post.lastError && <p className="rounded-2xl bg-soft p-3.5 text-[14px] text-muted">Last try: {post.lastError} We will try again automatically.</p>}

      {withResults && <ResultsPanel posts={withResults} zone={zone} />}

      <PostPreview
        network={post.network}
        accountName={post.accountName}
        avatarUrl={post.accountAvatar}
        text={post.text}
        hashtags={post.hashtags}
        media={post.media}
        reminder={post.format === "SCRIPT" || post.notify}
        hideReminderNote
        className="max-w-md"
      />

      {post.permalink && !withResults && (
        <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold text-pulse-blue">
          View on {networkName(post.network)} <ExternalLink aria-hidden className="size-4" />
        </a>
      )}

      {(post.status === "SCHEDULED" || post.status === "PENDING_APPROVAL" || post.status === "DRAFT" || post.status === "FAILED" || post.status === "NEEDS_ACTION") && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="detail-move" className="text-[13px] font-medium text-muted">Move to ({zone})</label>
            <input id="detail-move" type="datetime-local" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="min-h-11 rounded-[14px] border border-line bg-glass px-3 text-[15px] text-text" />
          </div>
          <Button variant="outline" size="sm" onClick={reschedule} disabled={pending || !moveTo}>Move</Button>
        </div>
      )}

      {error && <p role="alert" className="text-[14px] font-medium text-danger">{error}</p>}

      <div className="flex flex-wrap items-start gap-2">
        {post.status === "PENDING_APPROVAL" && (
          <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => approvePostsAction([post.id]), (res) => (Number(res.skipped ?? 0) > 0 ? { text: "No free time was found for it. Open it, pick a time with Move, then approve.", tone: "error" } : { text: "Approved. It will go out at its time.", tone: "success" }))}>Approve</Button>
        )}
        {post.status === "FAILED" && (
          <Button size="sm" leading={<RotateCw aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => retryPostAction(post.id), retryMessage)}>Retry</Button>
        )}
        {post.status === "NEEDS_ACTION" && (
          <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => markPostedAction(post.id), "Marked as posted.")}>Mark as posted</Button>
        )}
        {post.remindOnly && autoNetworks.includes(post.network) && (post.status === "PENDING_APPROVAL" || post.status === "SCHEDULED" || post.status === "DRAFT") && (
          <Button size="sm" leading={<PlugZap aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => connectByHandPostsAction([post.id]), `Switched. It goes out on ${networkName(post.network)} automatically.`)}>Publish automatically</Button>
        )}
        {(post.remindOnly || post.notify || post.status === "NEEDS_ACTION") && (
          <Button variant="outline" size="sm" leading={<ClipboardCopy aria-hidden className="size-4" />} onClick={() => copyCaption(post, toast)}>Copy caption</Button>
        )}
        {(post.remindOnly || post.status === "NEEDS_ACTION") &&
          post.media.map((m, i) => (
            <a key={m.path} href={m.url} target="_blank" rel="noopener noreferrer" download className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-[14px] font-semibold hover:bg-soft">
              <Download aria-hidden className="size-4" /> {/\.(mp4|webm)$/i.test(m.path) ? "Video" : post.media.length > 1 ? `Image ${i + 1}` : "Image"}
            </a>
          ))}
        <WhatsAppShare media={post.media} caption={postShareCaption(post)} what="post" />
        {post.status === "SCHEDULED" && (
          <Button variant="outline" size="sm" leading={<Undo2 aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => unschedulePostAction(post.id), "Back in review. It will not go out until you approve it.")}>Back to review</Button>
        )}
        {editable && <Button variant="outline" size="sm" leading={<Pencil aria-hidden className="size-4" />} disabled={pending} onClick={() => onEdit(post)}>Edit</Button>}
        <Button variant="outline" size="sm" leading={<Copy aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => duplicatePostAction(post.id), "Copied to your drafts.")}>Duplicate</Button>
        {post.status !== "PUBLISHING" && (
          confirmDelete ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="border-danger text-danger" disabled={pending} onClick={() => act(() => deletePostAction(post.id), post.status === "PUBLISHED" ? "Removed from BuPulse. It stays live on the network." : "Deleted.")}>
                {post.status === "PUBLISHED" ? "Yes, remove from BuPulse" : "Yes, delete"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            </span>
          ) : (
            <Button variant="outline" size="sm" leading={<Trash2 aria-hidden className="size-4" />} disabled={pending} onClick={() => setConfirmDelete(true)}>Delete</Button>
          )
        )}
      </div>
      {confirmDelete && post.status === "PUBLISHED" && (
        <p className="text-[13px] text-muted">This only removes it from BuPulse. The post stays live on {networkName(post.network)}, so delete it there too if you want it gone.</p>
      )}

      {/* The script, headlines, Generate again and Versions; Copy caption sits above for reminder posts. */}
      <PostWriting postId={post.id} zone={zone} copyCaption={post.remindOnly || post.notify || post.status === "NEEDS_ACTION" ? null : captionText(post)} />
    </div>
  );
}

/** The caption and hashtags as they are posted. */
function captionText(post: CalendarPost): string {
  return [post.title, post.text.trim(), post.hashtags.join(" ")].filter(Boolean).join("\n\n");
}

/** The caption and hashtags as they are posted, on the clipboard. */
function copyCaption(post: CalendarPost, toast: (message: string, tone?: "info" | "success" | "error") => void) {
  navigator.clipboard?.writeText(captionText(post)).then(
    () => toast("Caption copied.", "success"),
    () => toast("Could not copy. Select the text and copy it instead.", "error"),
  );
}
