"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck, Pencil, Trash2 } from "lucide-react";
import { Button, GlassCard, useToast } from "@/components/ui";
import { approvePostsAction, deletePostAction } from "@/app/dashboard/calendar/actions";
import { PostComposer } from "@/components/publishing/composer";
import { PostDetail } from "@/components/publishing/post-detail";
import type { ContentPost } from "@/lib/content-board/queries";
import type { CalendarPost, ComposerContext } from "@/lib/publishing/types";
import { autoNetworksOf, visualHrefFor } from "./post-board";
import { approvedMessage } from "@/lib/content-board/labels";
import { PostCard } from "./post-card";

/**
 * "Today": the posts made today that wait for review, with Approve (scheduled at the best time), Edit and Reject on
 * each, and Approve all. Older ones waiting are one link away.
 */
export function TodayReview({ posts, older, zone, context }: { posts: ContentPost[]; older: number; zone: string; context: ComposerContext }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CalendarPost | null>(null);
  const detail = posts.find((p) => p.id === detailId) ?? null;

  function run(id: string | null, action: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, done: (res: Record<string, unknown>) => string | { text: string; tone: "success" | "error" }) {
    setBusyId(id);
    start(async () => {
      // A request lost on the way back must not take the page down: refresh to show where things stand.
      const res = await action().catch(() => null);
      setBusyId(null);
      setRejecting(null);
      if (!res) {
        toast("We lost the connection before BuPulse answered. The page now shows where things stand: check it before trying again.", "error");
        router.refresh();
        return;
      }
      if (!res.ok) return toast(res.error ?? "That did not work. Please try again.", "error");
      const message = done(res);
      if (typeof message === "string") toast(message, "success");
      else toast(message.text, message.tone);
      router.refresh();
    });
  }

  const approveAll = () =>
    run(null, () => approvePostsAction(posts.map((p) => p.id)), (res) => approvedMessage(res, posts.length));

  return (
    <section aria-labelledby="today-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <h2 id="today-heading" className="text-xl font-semibold tracking-[-0.02em]">
            Today{" "}
            <span className="ml-1 inline-flex min-w-7 items-center justify-center rounded-full bg-new-bg px-2 py-0.5 align-middle text-[14px] text-new">
              <span className="sr-only">: </span>
              {posts.length}
              <span className="sr-only"> to review</span>
            </span>
          </h2>
          <p className="text-[15px] text-muted">
            {posts.length === 0 ? "Nothing new to review today." : "New posts waiting for your OK. Approving schedules each one at the best time for its app."}
          </p>
        </div>
        {posts.length > 1 && (
          <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} disabled={pending} onClick={approveAll}>
            Approve all {posts.length}
          </Button>
        )}
      </div>

      {posts.length > 0 ? (
        <ul className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 2xl:grid-cols-4" aria-label="Posts to review today">
          {posts.map((post) => (
            <li key={post.id} className="w-[85%] shrink-0 snap-start sm:w-auto">
              <PostCard
                post={post}
                zone={zone}
                showSubject
                onOpen={() => setDetailId(post.id)}
                actions={
                  rejecting === post.id ? (
                    <>
                      <Button size="sm" variant="outline" className="border-danger text-danger" disabled={pending} onClick={() => run(post.id, () => deletePostAction(post.id), () => "Rejected and deleted.")}>
                        Yes, delete it
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} disabled={pending} onClick={() => run(post.id, () => approvePostsAction([post.id]), (res) => approvedMessage(res, 1))} aria-label={`Approve ${post.accountName} post`}>
                        {busyId === post.id ? "Approving..." : "Approve"}
                      </Button>
                      <Button size="sm" variant="outline" leading={<Pencil aria-hidden className="size-4" />} disabled={pending} onClick={() => setEditing(post)} aria-label={`Edit ${post.accountName} post`}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" leading={<Trash2 aria-hidden className="size-4" />} disabled={pending} onClick={() => setRejecting(post.id)} aria-label={`Reject ${post.accountName} post`}>
                        Reject
                      </Button>
                    </>
                  )
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <GlassCard className="px-5 py-6 text-[15px] text-muted">You are all caught up. New posts from Studio and Autopilot show up here to approve.</GlassCard>
      )}
      {older > 0 && (
        <Link href="/dashboard/content?status=review" className="inline-flex min-h-11 w-fit items-center px-1 text-[15px] font-semibold text-pulse-blue">
          {older === 1 ? "1 more post from earlier days waits for review" : `${older} more posts from earlier days wait for review`}
        </Link>
      )}

      <PostDetail post={detail} zone={zone} onClose={() => setDetailId(null)} onEdit={(p) => { setDetailId(null); setEditing(p); }} visualHref={detail ? visualHrefFor(detail, zone) : null} autoNetworks={autoNetworksOf(context)} />
      <PostComposer open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} context={context} post={editing ?? undefined} />
    </section>
  );
}
