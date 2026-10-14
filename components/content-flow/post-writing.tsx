"use client";

/**
 * A post's words, in its detail (docs/CONTENT.md, "Caption, script and headlines"): the 30-second video script and the
 * three ad headlines BuPulse wrote with the caption, each with Copy; "Generate again" for the whole post or one piece
 * (1 text generation each, what is left shown when it runs low); and Versions, where every edit, new take and restore
 * is kept and any earlier one can be restored as the newest.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, RefreshCw, RotateCcw } from "lucide-react";
import { loadPostWritingAction, regeneratePostAction, restorePostVersionAction, type PostWritingResult } from "@/app/dashboard/content/post-actions";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { formatDateTime } from "@/components/publishing/helpers";
import { CopyButton } from "@/components/studio/copy-button";
import { Badge, Button, Skeleton } from "@/components/ui";
import type { PostWritingView, VersionView } from "@/lib/content-flow/post-writing";
import { textNearLimit, timeAgo, type RewritePart } from "@/lib/content-flow/versions";
import { cn } from "@/lib/cn";
import type { UsageBlockReason } from "@/lib/usage";

const DONE: Record<RewritePart, string> = {
  post: "Written again.",
  caption: "New caption written.",
  script: "New video script written.",
  headlines: "New ad headlines written.",
};

const ARIA: Record<RewritePart, string> = {
  post: "Generate the whole post again",
  caption: "Generate the caption again",
  script: "Generate the video script again",
  headlines: "Generate the ad headlines again",
};

export function PostWriting({ postId, zone, copyCaption }: { postId: string; zone: string; copyCaption?: string | null }) {
  const router = useRouter();
  const [view, setView] = useState<PostWritingView | null>(null);
  const [error, setError] = useState<{ text: string; quiet: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState<UsageBlockReason | null>(null);
  // Said in the panel, not in a toast: the post's dialog stays open over the page.
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean; where: "writing" | "versions" } | null>(null);

  useEffect(() => {
    let live = true;
    void loadPostWritingAction(postId).then((res) => {
      if (!live) return;
      if (res.ok) setView(res.view);
      else setError({ text: res.error, quiet: res.quiet === true });
    });
    return () => {
      live = false;
    };
  }, [postId, attempt]);

  // The buttons wait only for the action; the page behind (the post's preview) refreshes on its own afterwards.
  async function run(key: string, action: () => Promise<PostWritingResult>, done: (res: Extract<PostWritingResult, { ok: true }>) => string) {
    if (busy) return;
    const where = key.startsWith("restore:") ? "versions" : "writing";
    setBusy(key);
    setFeedback(null);
    const res: PostWritingResult = await action().catch(() => ({ ok: false as const, error: "That did not work. Please try again." }));
    setBusy(null);
    if (!res.ok) {
      if (res.blocked) {
        setBlocked(res.blocked);
        if (res.blocked === "limit_reached") setView((v) => (v?.usage ? { ...v, usage: { ...v.usage, left: 0 } } : v));
      }
      setFeedback({ text: res.error, ok: false, where });
      return;
    }
    setView(res.view);
    setFeedback({ text: done(res), ok: true, where });
    router.refresh();
  }

  const pending = busy !== null;

  if (!view) {
    if (error) {
      if (error.quiet) return null;
      return (
        <p className="flex flex-wrap items-center gap-2 text-[14px] text-muted">
          {error.text}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </p>
      );
    }
    return (
      <div aria-busy="true" aria-label="Loading the script and headlines" className="flex flex-col gap-2.5 rounded-2xl border border-line p-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }
  if (!view.written && view.versions.length === 0) return null;

  const left = view.usage?.left ?? null;
  const out = left === 0;
  const can = (part: RewritePart) => view.parts.includes(part);
  const regenerate = (part: RewritePart) => void run(part, () => regeneratePostAction(postId, part), () => `${DONE[part]} The one before is in Versions.`);
  const again = (part: RewritePart, label = "Generate again") =>
    can(part) && (
      <Button
        variant="outline"
        size="sm"
        disabled={pending || out}
        aria-label={ARIA[part]}
        title="Uses 1 text generation."
        leading={<RefreshCw aria-hidden className={cn("size-4", busy === part && "animate-spin motion-reduce:animate-none")} />}
        onClick={() => regenerate(part)}
      >
        {busy === part ? "Writing…" : label}
      </Button>
    );

  return (
    <div className="flex flex-col gap-4">
      {view.written && (
        <section aria-labelledby={`writing-${postId}`} className="flex flex-col gap-4 rounded-2xl border border-line p-4">
          <div className="flex flex-col gap-0.5">
            <h3 id={`writing-${postId}`} className="text-[15px] font-semibold">
              Caption, script and headlines
            </h3>
            <p className="text-[13px] text-muted">Written in {view.language}, in your brand voice.</p>
          </div>

          {(can("caption") || copyCaption) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col">
                <p className="text-[14px] font-semibold">Caption and hashtags</p>
                <p className="text-[13px] text-muted">As in the preview above.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {copyCaption && <CopyButton text={copyCaption} variant="outline" ariaLabel="Copy the caption and hashtags" />}
                {again("caption")}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px] font-semibold">30-second video script</p>
              <div className="flex flex-wrap gap-2">
                {view.videoScript.trim() && <CopyButton text={view.videoScript} variant="outline" ariaLabel="Copy the video script" />}
                {again("script", view.videoScript.trim() ? "Generate again" : "Write one")}
              </div>
            </div>
            {view.videoScript.trim() ? (
              <p className="rounded-2xl bg-soft p-3.5 text-[14px] break-words whitespace-pre-wrap">{view.videoScript}</p>
            ) : (
              <p className="text-[14px] text-muted">No video script yet.</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px] font-semibold">Ad headlines</p>
              {again("headlines", view.adHeadlines.length ? "Generate again" : "Write them")}
            </div>
            {view.adHeadlines.length > 0 ? (
              <ol aria-label="Ad headlines" className="flex flex-col gap-2">
                {view.adHeadlines.map((h, i) => (
                  <li key={`${i}-${h}`} className="flex items-center justify-between gap-2 rounded-2xl bg-soft py-1.5 pr-1.5 pl-3.5 text-[14px]">
                    <span className="min-w-0 break-words">{h}</span>
                    <CopyButton text={h} ariaLabel={`Copy headline ${i + 1}`} className="shrink-0" />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[14px] text-muted">No ad headlines yet.</p>
            )}
          </div>

          {view.parts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
              {again("post", "Generate the whole post again")}
              <p role="status" className={cn("text-[13px]", out ? "font-medium text-danger" : "text-muted")}>
                {out
                  ? "No text generations left this month."
                  : `Each one uses 1 text generation.${left !== null && view.usage && textNearLimit(left, view.usage.limit) ? ` ${left} left this month.` : ""}`}
              </p>
              {out && (
                <Link href="/dashboard/billing" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-pulse-blue">
                  See plans
                </Link>
              )}
            </div>
          )}
          {feedback?.where === "writing" && <Feedback ok={feedback.ok} text={feedback.text} />}
        </section>
      )}

      <Versions view={view} zone={zone} open={open} onToggle={() => setOpen((o) => !o)} busy={busy} pending={pending} feedback={feedback?.where === "versions" ? feedback : null} onRestore={(v) => void run(`restore:${v.id}`, () => restorePostVersionAction(postId, v.id), (res) => res.message ?? "Restored.")} />

      {blocked && <UpgradeDialog open onOpenChange={(o) => !o && setBlocked(null)} reason={blocked} limit={view.usage?.limit} />}
    </div>
  );
}

function Feedback({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p role={ok ? "status" : "alert"} className={cn("rounded-2xl px-3.5 py-2.5 text-[14px] font-medium", ok ? "bg-success-bg text-success" : "bg-danger-bg text-danger")}>
      {text}
    </p>
  );
}

function Versions({ view, zone, open, onToggle, busy, pending, feedback, onRestore }: { view: PostWritingView; zone: string; open: boolean; onToggle: () => void; busy: string | null; pending: boolean; feedback: { ok: boolean; text: string } | null; onRestore: (v: VersionView) => void }) {
  const now = new Date();
  return (
    <section aria-label="Versions" className="flex flex-col gap-3">
      <Button variant="outline" size="sm" className="w-fit" aria-expanded={open} aria-controls={`versions-${view.postId}`} leading={<History aria-hidden className="size-4" />} onClick={onToggle}>
        {view.versions.length ? `Versions (${view.versions.length})` : "Versions"}
      </Button>
      {open && (
        <div id={`versions-${view.postId}`} className="flex flex-col gap-2">
          {feedback && <Feedback ok={feedback.ok} text={feedback.text} />}
          {view.versions.length === 0 ? (
            <p className="text-[14px] text-muted">No earlier versions yet. Every edit, new take and restore keeps the one before it here.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {view.versions.map((v) => (
                <VersionItem key={v.id} version={v} when={timeAgo(v.at, now) ?? formatDateTime(v.at, zone)} canRestore={view.canRestore} restoring={busy === `restore:${v.id}`} pending={pending} onRestore={() => onRestore(v)} />
              ))}
            </ol>
          )}
          {view.versions.length > 0 && <p className="text-[13px] text-muted">Restoring brings a version back as the newest one. Nothing is lost: the current one stays in this list.</p>}
        </div>
      )}
    </section>
  );
}

function VersionItem({ version: v, when, canRestore, restoring, pending, onRestore }: { version: VersionView; when: string; canRestore: boolean; restoring: boolean; pending: boolean; onRestore: () => void }) {
  const [more, setMore] = useState(false);
  return (
    <li className={cn("flex flex-col gap-2 rounded-2xl border p-3.5", v.current ? "border-success/40 bg-success-bg/40" : "border-line")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
            Version {v.number}
            {v.current && <Badge tone="success">Current</Badge>}
          </p>
          <p className="text-[13px] text-muted">
            {v.label} · {when}
            {v.by ? ` · by ${v.by}` : ""}
          </p>
        </div>
        {!v.current && canRestore && (
          <Button variant="outline" size="sm" disabled={pending} aria-label={`Restore version ${v.number}`} leading={<RotateCcw aria-hidden className={cn("size-4", restoring && "animate-spin motion-reduce:animate-none")} />} onClick={onRestore}>
            {restoring ? "Restoring…" : "Restore"}
          </Button>
        )}
      </div>
      {v.title && <p className="text-[14px] font-semibold">{v.title}</p>}
      {more ? (
        <div className="flex flex-col gap-2 text-[14px]">
          <p className="break-words whitespace-pre-wrap">{v.text || "(no text)"}</p>
          {v.hashtags.length > 0 && <p className="break-words text-pulse-blue">{v.hashtags.join(" ")}</p>}
          {v.videoScript.trim() && (
            <div>
              <p className="text-[13px] font-semibold text-muted">Video script</p>
              <p className="break-words whitespace-pre-wrap">{v.videoScript}</p>
            </div>
          )}
          {v.adHeadlines.length > 0 && (
            <div>
              <p className="text-[13px] font-semibold text-muted">Ad headlines</p>
              <ul className="list-disc pl-5">
                {v.adHeadlines.map((h, i) => (
                  <li key={`${i}-${h}`}>{h}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="line-clamp-3 text-[14px] break-words whitespace-pre-wrap">{v.preview || "(no text)"}</p>
      )}
      <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)} className="min-h-11 w-fit cursor-pointer text-[14px] font-semibold text-pulse-blue">
        {more ? "Show less" : "Show all of it"}
      </button>
    </li>
  );
}
