"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlugZap, Sparkles } from "lucide-react";
import { Button, GlassCard, useToast } from "@/components/ui";
import { connectByHandPostsAction } from "@/app/dashboard/calendar/actions";
import { createPostsFromContentAction } from "@/app/dashboard/content/actions";

/** "Create posts from this content": for content that has no posts yet (written before posts were drafted). */
export function CreatePostsButton({ contentId }: { contentId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      size="lg"
      leading={<Sparkles aria-hidden className="size-5" />}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await createPostsFromContentAction(contentId);
          if (!res.ok) return toast(res.error, "error");
          toast(res.created === 1 ? "1 post is ready for review." : `${res.created} posts are ready for review.`, "success");
          router.refresh();
        })
      }
    >
      {pending ? "Creating posts..." : "Create posts from this content"}
    </Button>
  );
}

/** Posts made for apps that are connected now: switch them all to publish automatically in one click. */
export function SwitchToAutoBanner({ postIds }: { postIds: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const n = postIds.length;
  return (
    <GlassCard role="status" className="flex flex-wrap items-center gap-3 p-4">
      <PlugZap aria-hidden className="size-5 shrink-0 text-pulse-blue" />
      <p className="min-w-0 flex-1 text-[15px]">
        {n === 1 ? "1 post was made" : `${n} posts were made`} as a reminder to post yourself, and {n === 1 ? "its app is" : "their apps are"} connected now.
      </p>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await connectByHandPostsAction(postIds);
            if (!res.ok) return toast(res.error, "error");
            toast(res.switched === 1 ? "1 post now goes out automatically." : `${res.switched} posts now go out automatically.`, "success");
            router.refresh();
          })
        }
      >
        Publish automatically
      </Button>
    </GlassCard>
  );
}
