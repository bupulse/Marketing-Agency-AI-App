"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { reusePostAction } from "@/app/dashboard/calendar/actions";
import { Button, useToast } from "@/components/ui";
import { PostComposer } from "@/components/publishing/composer";
import { PostDetail } from "@/components/publishing/post-detail";
import type { ContentPost } from "@/lib/content-board/queries";
import type { CalendarPost, ComposerContext } from "@/lib/publishing/types";
import { dayKey } from "@/lib/publishing/time";
import { PostCard } from "./post-card";
import { useMakingByGroup } from "@/components/content-flow/use-set-progress";
import { bulkDeletable } from "@/lib/publishing/bulk-delete";
import { BulkActionBar, SelectToggle, useBulkSelect } from "./bulk-select";

/** Where a post's picture or video is made: its Autopilot card, or the day it was made on its product's, campaign's or General's content page. */
export function visualHrefFor(post: ContentPost, zone: string): string | null {
  if (post.source === "AUTOPILOT") return "/dashboard/autopilot";
  if (!post.contentId) return null;
  const base = post.subject ? `/dashboard/content/${post.subject.kind === "product" ? "products" : "campaigns"}/${post.subject.id}` : "/dashboard/content/general";
  return `${base}?day=${dayKey(new Date(post.createdAt), zone)}#day-visuals`;
}

/** Apps with an account BuPulse posts to automatically (by-hand posts for them can switch). */
export function autoNetworksOf(context: ComposerContext): string[] {
  return [...new Set(context.accounts.filter((a) => a.usable && !a.notify).map((a) => a.network))];
}

/**
 * A subject's posts as cards. A card opens the post (the calendar's detail: preview, approve, move, edit, delete);
 * Edit opens the composer. More posts load as the list end scrolls into view (or with the button). "Select" picks the
 * waiting ones (Needs your OK, Expired; never a posted or scheduled post) to delete together.
 */
export function PostBoard({
  posts,
  zone,
  context,
  total,
  moreHref,
  openPost,
  empty,
  showSubject = false,
  selectable = true,
}: {
  posts: ContentPost[];
  zone: string;
  context: ComposerContext;
  total: number;
  /** The same view with a higher limit, when there are more posts. */
  moreHref: string | null;
  /** A post to open on arrival (`?post=` links from the summary email). */
  openPost?: ContentPost | null;
  empty: ReactNode;
  showSubject?: boolean;
  /** Offer "Select" -> "Delete" for the waiting posts in this list. */
  selectable?: boolean;
}) {
  const router = useRouter();
  const [detailId, setDetailId] = useState<string | null>(openPost?.id ?? null);
  const [editing, setEditing] = useState<CalendarPost | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const loading = useRef(false);

  const all = openPost && !posts.some((p) => p.id === openPost.id) ? [openPost, ...posts] : posts;
  const detail = all.find((p) => p.id === detailId) ?? null;
  const makingOf = useMakingByGroup(all);
  const select = useBulkSelect(selectable ? all.filter((p) => bulkDeletable(p.status)).map((p) => p.id) : []);

  useEffect(() => {
    loading.current = false;
    const el = sentinel.current;
    if (!el || !moreHref || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loading.current) {
          loading.current = true;
          router.push(moreHref, { scroll: false });
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [moreHref, router]);

  if (all.length === 0) return <>{empty}</>;

  return (
    <div className="@container flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p role="status" className="text-[13px] text-muted">
          {total === 1 ? "1 post" : `${total} posts`}
        </p>
        <SelectToggle select={select} />
      </div>
      <ul className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4">
        {all.map((post) => (
          <li key={post.id}>
            <PostCard
              post={post}
              zone={zone}
              onOpen={() => setDetailId(post.id)}
              showSubject={showSubject}
              making={post.setMaking ? makingOf(post.groupId) : null}
              actions={post.status === "EXPIRED" ? <UseAgainButton postId={post.id} /> : undefined}
              selection={select.active && select.ids.includes(post.id) ? { selected: select.selected.has(post.id), onToggle: () => select.toggle(post.id) } : null}
            />
          </li>
        ))}
      </ul>
      {moreHref && (
        <div ref={sentinel} className="flex justify-center">
          <Link href={moreHref} scroll={false} className="inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-semibold text-pulse-blue hover:bg-soft">
            Show more
          </Link>
        </div>
      )}
      <BulkActionBar select={select} />
      <PostDetail post={detail} zone={zone} onClose={() => setDetailId(null)} onEdit={(p) => { setDetailId(null); setEditing(p); }} visualHref={detail ? visualHrefFor(detail, zone) : null} autoNetworks={autoNetworksOf(context)} />
      <PostComposer open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} context={context} post={editing ?? undefined} />
    </div>
  );
}

/** "Use again" on an expired post: back to "Needs your OK" for today, its count of missed days reset. */
function UseAgainButton({ postId }: { postId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      leading={<Undo2 aria-hidden className="size-4" />}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await reusePostAction(postId).catch(() => null);
          if (!res) toast("We lost the connection before BuPulse answered. The page now shows where things stand.", "error");
          else if (!res.ok) toast(res.error ?? "That did not work. Please try again.", "error");
          else toast("Back for today. Approve it when you are ready.", "success");
          router.refresh();
        })
      }
    >
      {pending ? "Bringing it back..." : "Use again"}
    </Button>
  );
}
