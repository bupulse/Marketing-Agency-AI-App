"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCheck, ClipboardCopy, Clock, Copy, Download, Ellipsis, ExternalLink, Pencil, PlugZap, RotateCw, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { APPROVED_LATE, approvalTimePassed, TIME_PASSED_NOTE } from "@/lib/publishing/approval-note";
import { Button, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  approvePostsAction,
  connectByHandPostsAction,
  deletePostAction,
  duplicatePostAction,
  markPostedAction,
  reschedulePostAction,
  retryPostAction,
  unschedulePostAction,
  reusePostAction,
} from "@/app/dashboard/calendar/actions";
import { PostWriting } from "@/components/content-flow/post-writing";
import { PostModal, contentPostView, type PostDetailView, type Platform } from "@/components/media-cards";
import { distinctLabels } from "@/components/media-cards/helpers";
import { WhatsAppShare } from "@/components/share/whatsapp-share";
import { postShareCaption } from "@/lib/share/whatsapp";
import { EDITABLE, STATUS_LABEL } from "@/lib/publishing/status";
import { parseLocalInput, toLocalInput } from "@/lib/publishing/time";
import type { CalendarPost, PostOutcome } from "@/lib/publishing/types";
import { formatDateTime } from "./helpers";
import { networkName } from "./network-icon";
import { ResultsPanel } from "./post-results";
import { showsSoundTip, TrendingSoundLine, TrendingSoundTip } from "./trending-sound-tip";

/** How a format reads next to its app when two versions share one ("Facebook · Carousel"). */
const FORMAT_WORD: Record<string, string> = { POST: "Post", CAROUSEL: "Carousel", SCRIPT: "Video script", ARTICLE: "Article", THREAD: "Thread" };

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
  /** The list it was opened from (the board's cards, the calendar's day): previous and next walk it. */
  list?: readonly CalendarPost[];
  /** Previous / next: the page opens that post instead. */
  onNavigate?: (post: CalendarPost) => void;
};

/** A post in the opened-post view (components/media-cards PostModal): its caption per app, when, and who made it. */
export function detailView(post: CalendarPost, zone: string, group: readonly CalendarPost[] = []): PostDetailView {
  const view = contentPostView(post, zone);
  const when = post.status === "PUBLISHED" && post.publishedAt ? `Published ${formatDateTime(post.publishedAt, zone)}` : post.scheduledAt ? formatDateTime(post.scheduledAt, zone) : null;
  const madeBy = post.source === "AUTOPILOT" ? "Autopilot" : post.source === "DAILY" ? "Made for you" : post.source === "STUDIO" ? "Video Studio" : null;
  const others = group.filter((p) => p.id !== post.id && p.network !== post.network);
  const labels = distinctLabels(others.map((p) => ({ name: networkName(p.network), detail: FORMAT_WORD[p.format] ?? null })));
  return {
    ...view,
    timeLabel: when,
    status: view.status === "reminder" && post.status === "SCHEDULED" ? "scheduled" : view.status,
    statusLabel: STATUS_LABEL[post.status],
    variants: others.map((p, i) => ({ platform: p.network as Platform, caption: p.text, hashtags: p.hashtags, status: contentPostView(p, zone).status, label: labels[i] })),
    details: [
      ...(when ? [{ label: post.status === "PUBLISHED" ? "Posted" : "When", value: when.replace(/^Published /, "") }] : []),
      { label: "App", value: `${networkName(post.network)} · ${post.accountName}` },
      ...(madeBy ? [{ label: "Made by", value: madeBy }] : []),
      ...(post.autoScheduledAt && post.status !== "PENDING_APPROVAL" ? [{ label: "Scheduled", value: "On its own (no approval needed)" }] : []),
      ...(post.trendingSound ? [{ label: "Sound", value: `Trending: ${post.trendingSound.artist ? `${post.trendingSound.title} – ${post.trendingSound.artist}` : post.trendingSound.title}` }] : []),
    ],
    dateLine: post.status === "PUBLISHED" && post.publishedAt ? `Posted ${formatDateTime(post.publishedAt, zone)}` : post.scheduledAt ? `${post.status === "SCHEDULED" ? "Goes out" : "Planned for"} ${formatDateTime(post.scheduledAt, zone)}` : null,
  };
}

function retryMessage(res: Record<string, unknown>): { text: string; tone: "success" | "error" } {
  const outcome = (res.outcomes as PostOutcome[] | undefined)?.[0];
  if (outcome?.status === "PUBLISHED") return { text: "Published.", tone: "success" };
  if (outcome?.status === "NEEDS_ACTION") return { text: "We emailed you a reminder to post it.", tone: "success" };
  if (outcome?.status === "FAILED") return { text: outcome.error ?? "It failed again.", tone: "error" };
  return { text: "We will try again shortly.", tone: "success" };
}

type Ui = { id: string | null; confirmDelete: boolean; moveTo: string; error: string | null; more: boolean };

/**
 * One post in full, like Instagram's opened post (components/media-cards PostModal): the picture or video on the left,
 * and on the right the account, the caption for each app, when and who made it, what happened to it (notes, results),
 * moving it, the script and versions; the owner's buttons at the bottom. "Edit" opens the composer. Previous and next
 * walk the list it was opened from.
 */
export function PostDetail({ post, zone, onClose, onEdit, visualHref, autoNetworks = [], group = [], list, onNavigate }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [ui, setUi] = useState<Ui>({ id: null, confirmDelete: false, moveTo: "", error: null, more: false });
  // A new post opened (or the next one): its own move time, no question or error left over.
  if (post && ui.id !== post.id) setUi({ id: post.id, confirmDelete: false, moveTo: post.scheduledAt ? toLocalInput(new Date(post.scheduledAt), zone) : "", error: null, more: false });

  const posts = useMemo(() => (post ? (list?.some((p) => p.id === post.id) ? list : [post]) : []), [post, list]);
  const index = post ? posts.findIndex((p) => p.id === post.id) : -1;
  // Each post's own group: the one the page gave for the open post, else its group within the list.
  const views = useMemo(() => posts.map((p) => detailView(p, zone, p.id === post?.id && group.length ? group : (list ?? []).filter((x) => x.groupId && x.groupId === p.groupId))), [posts, post?.id, zone, group, list]);

  function act(run: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, success: string | ((res: Record<string, unknown>) => { text: string; tone: "success" | "error" }), closeAfter = true) {
    setUi((u) => ({ ...u, error: null }));
    startTransition(async () => {
      const res = await run();
      if (!res.ok) return setUi((u) => ({ ...u, error: res.error ?? "That did not work. Please try again." }));
      const message = typeof success === "string" ? { text: success, tone: "success" as const } : success(res);
      toast(message.text, message.tone);
      router.refresh();
      if (closeAfter) onClose();
    });
  }

  function reschedule(p: CalendarPost) {
    const at = parseLocalInput(ui.moveTo, zone);
    if (!at) return setUi((u) => ({ ...u, error: "Pick a valid date and time." }));
    act(() => reschedulePostAction(p.id, at.toISOString()), "Moved.");
  }

  return (
    <PostModal
      posts={views}
      index={index >= 0 ? index : null}
      onIndexChange={(i) => posts[i] && onNavigate?.(posts[i])}
      onClose={onClose}
      renderBody={(_, i) => posts[i] && <Body post={posts[i]} zone={zone} ui={ui} setUi={setUi} pending={pending} visualHref={visualHref} autoNetworks={autoNetworks} group={group} reschedule={reschedule} onClose={onClose} />}
      renderFooter={(_, i) => posts[i] && <Actions post={posts[i]} ui={ui} setUi={setUi} pending={pending} act={act} autoNetworks={autoNetworks} onEdit={onEdit} toast={toast} />}
    />
  );
}

type SetUi = (fn: (u: Ui) => Ui) => void;

/** What happened to the post and what to know (notes, results), moving it, and its script and versions. */
function Body({ post, zone, ui, setUi, pending, visualHref, autoNetworks, group, reschedule, onClose }: { post: CalendarPost; zone: string; ui: Ui; setUi: SetUi; pending: boolean; visualHref?: string | null; autoNetworks: readonly string[]; group: readonly CalendarPost[]; reschedule: (p: CalendarPost) => void; onClose: () => void }) {
  // Opened from a click, never rendered on the server: reading the clock here cannot mismatch.
  const timePassed = approvalTimePassed(post);
  // Results (when the plan shows them, lib/publishing/results.ts): this post first, then its other networks.
  const withResults = post.status === "PUBLISHED" && post.results ? [post, ...group.filter((p) => p.id !== post.id && p.status === "PUBLISHED" && p.results)] : null;
  return (
    <>
      {post.status === "FAILED" && (
        <div role="alert" className="flex gap-2.5 rounded-2xl bg-danger-bg p-3.5 text-[14px] text-danger">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>{post.lastError ?? "This post could not be published."}</p>
        </div>
      )}
      {timePassed && (
        <p role="note" className="flex gap-2.5 rounded-2xl bg-soft p-3.5 text-[14px] text-muted">
          <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
          {TIME_PASSED_NOTE}
        </p>
      )}
      {post.status === "PENDING_APPROVAL" && post.reviewNote && (
        <p role="note" className="rounded-2xl bg-new-bg p-3.5 text-[14px] text-new">
          {post.reviewNote}{" "}
          {visualHref && (
            // Closes the post too: on its own subject page only the address's query changes, and the post stayed open on top.
            <Link href={visualHref} onClick={onClose} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
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
            {networkName(post.network)} is not connected to BuPulse, so this post is a reminder: at its time you get an email with the caption and the {post.media.some((m) => /\.(mp4|webm)$/i.test(m.path)) ? "video" : "pictures"} to post it yourself, then press {showsSoundTip(post) ? "“I posted it”" : "“Mark as posted”"}.
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
      {post.status === "EXPIRED" && (
        <p role="note" className="rounded-2xl bg-soft p-3.5 text-[14px] text-muted">
          This post missed its day 3 times, so it expired and will not go out. &ldquo;Use again&rdquo; brings it back to &ldquo;Needs your OK&rdquo; for today.
        </p>
      )}
      {post.status === "SCHEDULED" && post.lastError && <p className="rounded-2xl bg-soft p-3.5 text-[14px] text-muted">Last try: {post.lastError} We will try again automatically.</p>}

      {/* Instagram reels: the trending sound attached (or to be), or the "Post manually" path with one. */}
      <TrendingSoundLine post={post} />
      {showsSoundTip(post) && <TrendingSoundTip post={post} caption={captionText(post)} />}

      {withResults && <ResultsPanel posts={withResults} zone={zone} />}

      {post.permalink && !withResults && (
        <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold text-pulse-blue">
          View on {networkName(post.network)} <ExternalLink aria-hidden className="size-4" />
        </a>
      )}

      {(post.status === "SCHEDULED" || post.status === "PENDING_APPROVAL" || post.status === "DRAFT" || post.status === "FAILED" || post.status === "NEEDS_ACTION") && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="detail-move" className="text-[13px] font-medium text-muted">
              Move to ({zone})
            </label>
            <input id="detail-move" type="datetime-local" value={ui.moveTo} onChange={(e) => setUi((u) => ({ ...u, moveTo: e.target.value }))} className="min-h-11 rounded-[14px] border border-line bg-glass px-3 text-[15px] text-text" />
          </div>
          <Button variant="outline" size="sm" onClick={() => reschedule(post)} disabled={pending || !ui.moveTo}>
            Move
          </Button>
        </div>
      )}

      {ui.error && (
        <p role="alert" className="text-[14px] font-medium text-danger">
          {ui.error}
        </p>
      )}

      {/* The script, headlines, Generate again and Versions; Copy caption sits below for reminder posts. */}
      <PostWriting postId={post.id} zone={zone} copyCaption={post.remindOnly || post.notify || post.status === "NEEDS_ACTION" ? null : captionText(post)} />
    </>
  );
}

/** The owner's buttons for the post, by its status. */
function Actions({
  post,
  ui,
  setUi,
  pending,
  act,
  autoNetworks,
  onEdit,
  toast,
}: {
  post: CalendarPost;
  ui: Ui;
  setUi: SetUi;
  pending: boolean;
  act: (run: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, success: string | ((res: Record<string, unknown>) => { text: string; tone: "success" | "error" }), closeAfter?: boolean) => void;
  autoNetworks: readonly string[];
  onEdit: (post: CalendarPost) => void;
  toast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const editable = (EDITABLE as readonly string[]).includes(post.status);
  const timePassed = approvalTimePassed(post);
  // A delete waiting for its "Yes" keeps the folded buttons open.
  const more = ui.more || ui.confirmDelete;
  // The trending-sound card has its own Video and Copy caption buttons: not twice on the same screen.
  const soundTip = showsSoundTip(post);
  return (
    <>
      <div className="flex flex-wrap items-start gap-2">
        {post.status === "PENDING_APPROVAL" && (
          <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => approvePostsAction([post.id]), (res) => (Number(res.skipped ?? 0) > 0 ? { text: "No free time was found for it. Open it, pick a time with Move, then approve.", tone: "error" } : { text: timePassed ? APPROVED_LATE : "Approved. It will go out at its time.", tone: "success" }))}>
            Approve
          </Button>
        )}
        {post.status === "EXPIRED" && (
          <Button size="sm" leading={<Undo2 aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => reusePostAction(post.id), "Back for today. Approve it when you are ready.")}>
            Use again
          </Button>
        )}
        {post.status === "FAILED" && (
          <Button size="sm" leading={<RotateCw aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => retryPostAction(post.id), retryMessage)}>
            Retry
          </Button>
        )}
        {post.status === "NEEDS_ACTION" && (
          <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => markPostedAction(post.id), "Marked as posted.")}>
            Mark as posted
          </Button>
        )}
        {post.remindOnly && autoNetworks.includes(post.network) && (post.status === "PENDING_APPROVAL" || post.status === "SCHEDULED" || post.status === "DRAFT") && (
          <Button size="sm" leading={<PlugZap aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => connectByHandPostsAction([post.id]), `Switched. It goes out on ${networkName(post.network)} automatically.`)}>
            Publish automatically
          </Button>
        )}
        {editable && (
          <Button variant="outline" size="sm" leading={<Pencil aria-hidden className="size-4" />} disabled={pending} onClick={() => onEdit(post)}>
            Edit
          </Button>
        )}
        {/* On a phone the less-used buttons fold under "More", so the caption keeps room (8 buttons took a quarter of the
            screen); from md up they all show, as before (md:contents). */}
        <Button variant="outline" size="sm" className="md:hidden" aria-expanded={more} leading={<Ellipsis aria-hidden className="size-4" />} onClick={() => setUi((u) => ({ ...u, more: !u.more }))}>
          {more ? "Less" : "More"}
        </Button>
        <div className={cn("flex-wrap items-start gap-2 md:contents", more ? "flex w-full" : "hidden")}>
          {!soundTip && (post.remindOnly || post.notify || post.status === "NEEDS_ACTION") && (
            <Button variant="outline" size="sm" leading={<ClipboardCopy aria-hidden className="size-4" />} onClick={() => copyCaption(post, toast)}>
              Copy caption
            </Button>
          )}
          {!soundTip && (post.remindOnly || post.status === "NEEDS_ACTION") &&
            post.media.map((m, i) => (
              <a key={m.path} href={m.url} target="_blank" rel="noopener noreferrer" download className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-[14px] font-semibold hover:bg-soft">
                <Download aria-hidden className="size-4" /> {/\.(mp4|webm)$/i.test(m.path) ? "Video" : post.media.length > 1 ? `Image ${i + 1}` : "Image"}
              </a>
            ))}
          <WhatsAppShare media={post.media} caption={postShareCaption(post)} what="post" />
          {post.status === "SCHEDULED" && (
            <Button variant="outline" size="sm" leading={<Undo2 aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => unschedulePostAction(post.id), "Back in review. It will not go out until you approve it.")}>
              Back to review
            </Button>
          )}
          <Button variant="outline" size="sm" leading={<Copy aria-hidden className="size-4" />} disabled={pending} onClick={() => act(() => duplicatePostAction(post.id), "Copied to your drafts.")}>
            Duplicate
          </Button>
          {post.status !== "PUBLISHING" &&
            (ui.confirmDelete ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="border-danger text-danger" disabled={pending} onClick={() => act(() => deletePostAction(post.id), post.status === "PUBLISHED" ? "Removed from BuPulse. It stays live on the network." : "Deleted.")}>
                  {post.status === "PUBLISHED" ? "Yes, remove from BuPulse" : "Yes, delete"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setUi((u) => ({ ...u, confirmDelete: false }))}>
                  Keep it
                </Button>
              </span>
            ) : (
              <Button variant="outline" size="sm" leading={<Trash2 aria-hidden className="size-4" />} disabled={pending} onClick={() => setUi((u) => ({ ...u, confirmDelete: true }))}>
                Delete
              </Button>
            ))}
        </div>
      </div>
      {ui.confirmDelete && post.status === "PUBLISHED" && <p className="mt-2 text-[13px] text-muted">This only removes it from BuPulse. The post stays live on {networkName(post.network)}, so delete it there too if you want it gone.</p>}
    </>
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
