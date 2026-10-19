"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { makeFirstPostAction } from "@/app/dashboard/first-post/actions";
import { Button, GlassCard } from "@/components/ui";
import type { PreviewView } from "@/lib/preview/first-post";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "B";

/**
 * The free first-post preview on the demo screen (lib/preview/first-post.ts): one post about the business, written by
 * BuPulse, shown as it would look on social media. Only rendered when Admin -> Settings switches it on.
 */
export function FirstPostPreview({ initial, businessName, color, canMake }: { initial: PreviewView | null; businessName: string; color: string | null; canMake: boolean }) {
  const [preview, setPreview] = useState<PreviewView | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = preview?.status === "ready" && preview.caption;
  const canTry = canMake && (!preview || preview.canRetry);

  const make = () =>
    start(async () => {
      setError(null);
      const r = await makeFirstPostAction();
      if (r.ok) setPreview(r.preview);
      else setError(r.error);
    });

  return (
    <GlassCard as="section" aria-labelledby="first-post" className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="first-post" className="flex items-center gap-2 text-base font-semibold">
          <Sparkles aria-hidden className="size-5 text-pulse-violet" />
          {ready ? "Your first post, written by BuPulse" : "See your first post now"}
        </h2>
        {!ready && (
          <p className="text-sm text-muted">
            {canMake ? "Free, before your demo: BuPulse writes one post about your business from what you told us. It takes about 20 seconds." : "Your company's owner or an admin can ask BuPulse for a free first post before the demo."}
          </p>
        )}
      </div>

      {ready && (
        <article aria-label="Your first post" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <header className="flex items-center gap-3">
            <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: color ?? "var(--color-pulse-violet)" }}>
              {initials(businessName)}
            </span>
            <span className="flex flex-col">
              <strong className="text-sm">{businessName}</strong>
              <span className="text-xs text-muted">Sample post</span>
            </span>
          </header>
          {preview.headline && <p className="text-[15px] font-semibold">{preview.headline}</p>}
          <p className="whitespace-pre-line text-[15px]">{preview.caption}</p>
          {preview.hashtags.length > 0 && <p className="break-words text-sm text-pulse-blue">{preview.hashtags.join(" ")}</p>}
        </article>
      )}
      {ready && <p className="text-xs text-muted">This is a sample. In your demo we make its design and a short video from your photos, and plan your week.</p>}

      {preview?.status === "making" && !pending && <p className="text-sm text-muted">Your post is being written. Refresh the page in a moment.</p>}
      {error && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {!ready && canTry && preview?.status !== "making" && (
        <div>
          <Button type="button" onClick={make} disabled={pending} leading={<Sparkles aria-hidden className="size-4" />}>
            {pending ? "Writing your post..." : preview?.canRetry ? "Try again" : "Make my first post"}
          </Button>
        </div>
      )}
    </GlassCard>
  );
}
