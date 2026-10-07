"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Copy, ExternalLink, Pencil, RotateCw, Trash2, TriangleAlert } from "lucide-react";
import { Badge, Button, Dialog, useToast } from "@/components/ui";
import {
  approvePostsAction,
  deletePostAction,
  duplicatePostAction,
  markPostedAction,
  reschedulePostAction,
  retryPostAction,
} from "@/app/dashboard/calendar/actions";
import { EDITABLE, STATUS_LABEL, STATUS_STYLE } from "@/lib/publishing/status";
import { parseLocalInput, toLocalInput } from "@/lib/publishing/time";
import type { CalendarPost, PostOutcome } from "@/lib/publishing/types";
import { formatDateTime } from "./helpers";
import { NetworkIcon, networkName } from "./network-icon";
import { PostPreview } from "./post-preview";

type Props = {
  post: CalendarPost | null;
  zone: string;
  onClose: () => void;
  onEdit: (post: CalendarPost) => void;
};

/** One post in full: how it looks, what happened to it, and what the owner can do about it. */
export function PostDetail({ post, zone, onClose, onEdit }: Props) {
  return (
    <Dialog open={post !== null} onOpenChange={(o) => !o && onClose()} title={post ? `${networkName(post.network)} post` : "Post"} className="max-w-2xl">
      {post && <DetailBody key={post.id} post={post} zone={zone} onClose={onClose} onEdit={onEdit} />}
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

function DetailBody({ post, zone, onClose, onEdit }: Omit<Props, "post"> & { post: CalendarPost }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveTo, setMoveTo] = useState(() => (post.scheduledAt ? toLocalInput(new Date(post.scheduledAt), zone) : ""));
  const [error, setError] = useState<string | null>(null);
  const style = STATUS_STYLE[post.status];
  const editable = (EDITABLE as readonly string[]).includes(post.status);

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
        {post.scheduledAt && <span className="text-[13px] text-muted">{post.status === "PUBLISHED" && post.publishedAt ? `Published ${formatDateTime(post.publishedAt, zone)}` : formatDateTime(post.scheduledAt, zone)}</span>}
      </div>

      {post.status === "FAILED" && (
        <div role="alert" className="flex gap-2.5 rounded-2xl bg-danger-bg p-3.5 text-[14px] text-danger">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>{post.lastError ?? "This post could not be published."}</p>
        </div>
      )}
      {post.status === "NEEDS_ACTION" && (
        <p className="rounded-2xl bg-amber-500/15 p-3.5 text-[14px] text-amber-900 dark:text-amber-200">
          We emailed you a reminder to post this on {networkName(post.network)}. Once it is up, press &ldquo;Mark as posted&rdquo;.
        </p>
      )}
      {post.status === "SCHEDULED" && post.lastError && <p className="rounded-2xl bg-soft p-3.5 text-[14px] text-muted">Last try: {post.lastError} We will try again automatically.</p>}

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

      {post.permalink && (
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

      <div className="flex flex-wrap gap-2">
        {post.status === "PENDING_APPROVAL" && (
          <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => approvePostsAction([post.id]), "Approved. It will go out at its time.")}>Approve</Button>
        )}
        {post.status === "FAILED" && (
          <Button size="sm" leading={<RotateCw aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => retryPostAction(post.id), retryMessage)}>Retry</Button>
        )}
        {post.status === "NEEDS_ACTION" && (
          <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => markPostedAction(post.id), "Marked as posted.")}>Mark as posted</Button>
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
    </div>
  );
}
