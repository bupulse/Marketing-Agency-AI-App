"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PostComposer } from "@/components/publishing/composer";
import { PostDetail } from "@/components/publishing/post-detail";
import type { ContentPost } from "@/lib/content-board/queries";
import type { CalendarPost, ComposerContext } from "@/lib/publishing/types";
import { PostCard } from "./post-card";

/** Where a post's picture or video is made: its Autopilot card, or its product's or campaign's page. */
export function visualHrefFor(post: ContentPost): string | null {
  if (post.source === "AUTOPILOT") return "/dashboard/autopilot";
  if (post.subject) return `/dashboard/knowledge/${post.subject.kind === "product" ? "products" : "campaigns"}/${post.subject.id}`;
  return null;
}

/**
 * A subject's posts as cards. A card opens the post (the calendar's detail: preview, approve, move, edit, delete);
 * Edit opens the composer. More posts load as the list end scrolls into view (or with the button).
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
}) {
  const router = useRouter();
  const [detailId, setDetailId] = useState<string | null>(openPost?.id ?? null);
  const [editing, setEditing] = useState<CalendarPost | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const loading = useRef(false);

  const all = openPost && !posts.some((p) => p.id === openPost.id) ? [openPost, ...posts] : posts;
  const detail = all.find((p) => p.id === detailId) ?? null;

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
    <div className="flex flex-col gap-4">
      <p role="status" className="px-1 text-[13px] text-muted">
        {total === 1 ? "1 post" : `${total} posts`}
      </p>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {all.map((post) => (
          <li key={post.id}>
            <PostCard post={post} zone={zone} onOpen={() => setDetailId(post.id)} showSubject={showSubject} />
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
      <PostDetail post={detail} zone={zone} onClose={() => setDetailId(null)} onEdit={(p) => { setDetailId(null); setEditing(p); }} visualHref={detail ? visualHrefFor(detail) : null} />
      <PostComposer open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} context={context} post={editing ?? undefined} />
    </div>
  );
}
