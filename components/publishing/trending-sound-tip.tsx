"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ClipboardCopy, Download, ExternalLink, Music } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { markPostedByHandAction, trendingTipsAction } from "@/app/dashboard/calendar/actions";
import { soundLabel, type TrendingTip } from "@/lib/social/instagram-audio";
import type { CalendarPost } from "@/lib/publishing/types";

const VIDEO = /\.(mp4|webm|mov)$/i;
const OPEN = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "FAILED", "NEEDS_ACTION"];

/** "Trending sound: Title – Artist" once BuPulse attached one; before that, what will happen (Facebook Login accounts). */
export function TrendingSoundLine({ post }: { post: CalendarPost }) {
  if (post.trendingSound) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-muted">
        <Music aria-hidden className="size-4 shrink-0 text-pulse-blue" />
        <span>
          Trending sound:{" "}
          {post.trendingSound.link ? (
            <a href={post.trendingSound.link} target="_blank" rel="noopener noreferrer" className="font-semibold text-text underline underline-offset-2">
              {soundLabel(post.trendingSound)}
            </a>
          ) : (
            <span className="font-semibold text-text">{soundLabel(post.trendingSound)}</span>
          )}
        </span>
      </p>
    );
  }
  if (post.instagramSound === "auto" && OPEN.includes(post.status)) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-muted">
        <Music aria-hidden className="size-4 shrink-0 text-pulse-blue" />
        BuPulse adds a trending Instagram sound when this reel goes out.
      </p>
    );
  }
  return null;
}

/** Whether the opened post shows the "Post manually with a trending sound" card. */
export function showsSoundTip(post: CalendarPost): boolean {
  return post.instagramSound === "tip" && OPEN.includes(post.status) && post.media.some((m) => VIDEO.test(m.path));
}

/**
 * For Instagram reels BuPulse cannot add a sound to (Instagram Login, BuPulse-Socials and the rest): the week's
 * trending sounds and a "Post manually" path. Download the video, copy the caption, open Instagram, add the sound, then
 * "I posted it" (the post becomes published and BuPulse never sends it).
 */
export function TrendingSoundTip({ post, caption }: { post: CalendarPost; caption: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tips, setTips] = useState<TrendingTip[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const video = post.media.find((m) => VIDEO.test(m.path));

  useEffect(() => {
    let live = true;
    trendingTipsAction().then((r) => live && setTips(r.ok ? r.tips : []), () => live && setTips([]));
    return () => {
      live = false;
    };
  }, []);

  function copy() {
    navigator.clipboard?.writeText(caption).then(
      () => toast("Caption copied.", "success"),
      () => toast("Could not copy. Select the text and copy it instead.", "error"),
    );
  }

  function posted() {
    start(async () => {
      const res = await markPostedByHandAction(post.id);
      if (!res.ok) return toast(res.error, "error");
      toast("Marked as posted.", "success");
      router.refresh();
    });
  }

  return (
    <section aria-label="Post with a trending sound" className="flex flex-col gap-3 rounded-2xl bg-soft p-3.5 text-[14px]">
      <p className="flex items-center gap-2 font-semibold text-text">
        <Music aria-hidden className="size-4 shrink-0 text-pulse-blue" /> Add a trending sound
      </p>
      <p className="text-muted">Reels with a trending sound reach more people. BuPulse cannot add Instagram sounds on this account, so you can post this reel yourself:</p>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-text">
        <li>Download the video.</li>
        <li>Copy the caption.</li>
        <li>Open Instagram, make a reel with the video, tap the music icon and pick a trending sound.</li>
        <li>Come back and tap &ldquo;I posted it&rdquo;.</li>
      </ol>
      {tips === null ? (
        <p className="text-[13px] text-muted">Loading this week&apos;s sounds…</p>
      ) : tips.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-muted">Trending this week</p>
          <ul className="flex flex-col gap-1">
            {tips.map((t) => (
              <li key={`${t.title}-${t.artist ?? ""}`} className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium text-text">{soundLabel(t)}</span>
                {t.link && (
                  <a href={t.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-pulse-blue">
                    Open <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[13px] text-muted">Pick any sound marked &ldquo;Trending&rdquo; in Instagram&apos;s music list.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {video && (
          <a href={video.url} target="_blank" rel="noopener noreferrer" download className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-[14px] font-semibold hover:bg-glass">
            <Download aria-hidden className="size-4" /> Video
          </a>
        )}
        <Button variant="outline" size="sm" leading={<ClipboardCopy aria-hidden className="size-4" />} onClick={copy}>
          Copy caption
        </Button>
        <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-[14px] font-semibold hover:bg-glass">
          <ExternalLink aria-hidden className="size-4" /> Open Instagram
        </a>
        {confirm ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} disabled={pending} onClick={posted}>
              Yes, I posted it
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(false)}>
              Not yet
            </Button>
          </span>
        ) : (
          <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} onClick={() => setConfirm(true)}>
            I posted it
          </Button>
        )}
      </div>
      {confirm && <p className="text-[13px] text-muted">BuPulse will then not post this reel on Instagram.</p>}
    </section>
  );
}
