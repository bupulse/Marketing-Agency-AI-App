"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Sparkles } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { NetworkIcon } from "@/components/publishing/network-icon";
import { formatDateTime } from "@/components/publishing/helpers";
import { previewScheduleAction, scheduleAllAction } from "@/app/dashboard/content/actions";
import type { ContentScope } from "@/lib/content-board/filters";
import type { ScheduleAllResult, SchedulablePost } from "@/lib/content-board/schedule-all";
import { toLocalInput } from "@/lib/publishing/time";
import type { Network } from "@/lib/social/types";

type Step = { kind: "loading" } | { kind: "choose"; posts: SchedulablePost[]; zone: string } | { kind: "times"; posts: SchedulablePost[]; zone: string } | { kind: "done"; result: ScheduleAllResult; posts: SchedulablePost[]; zone: string } | { kind: "error"; message: string };

/**
 * "Schedule all my posts": the posts of the current view that are not posted or scheduled yet. "Schedule for me" picks
 * the best times; "I'll choose times" lists them with a time each, prefilled with the suggestion. Reports what was
 * scheduled and what was skipped, with why.
 */
export function ScheduleAllButton({ query, scope }: { query: string; scope?: ContentScope }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [times, setTimes] = useState<Record<string, string>>({});
  // "Now" for the date pickers' bounds, read once (render must stay pure).
  const [nowMs] = useState(() => Date.now());
  const [pending, start] = useTransition();

  function openDialog() {
    setOpen(true);
    setStep({ kind: "loading" });
    start(async () => {
      const res = await previewScheduleAction(query, scope);
      if (!res.ok) return setStep({ kind: "error", message: res.error });
      setTimes(Object.fromEntries(res.posts.map((p) => [p.id, p.suggested ? toLocalInput(new Date(p.suggested), res.zone) : ""])));
      setStep({ kind: "choose", posts: res.posts, zone: res.zone });
    });
  }

  function submit(posts: SchedulablePost[], zone: string, chooseTimes: boolean) {
    const ready = posts.filter((p) => !p.blocked);
    start(async () => {
      const res = await scheduleAllAction(ready.map((p) => ({ id: p.id, local: chooseTimes ? times[p.id] || null : null })));
      if (!res.ok) return setStep({ kind: "error", message: res.error });
      const result = { scheduled: res.scheduled, skipped: [...res.skipped, ...posts.filter((p) => p.blocked).map((p) => ({ id: p.id, reason: p.blocked as string }))] };
      setStep({ kind: "done", result, posts, zone });
      toast(`Scheduled ${result.scheduled.length} of ${posts.length}.`, result.scheduled.length > 0 ? "success" : "error");
      router.refresh();
    });
  }

  const byId = (posts: SchedulablePost[], id: string) => posts.find((p) => p.id === id);

  return (
    <>
      <Button size="sm" leading={<CalendarClock aria-hidden className="size-4" />} onClick={openDialog} aria-haspopup="dialog">
        Schedule all my posts
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Schedule all my posts" description="The posts in this view that are not posted or scheduled yet." className="max-w-2xl">
        <div aria-busy={pending} className="flex flex-col gap-4">
          {step.kind === "loading" && <p className="text-[15px] text-muted">Finding your posts...</p>}
          {step.kind === "error" && <p role="alert" className="text-[15px] font-medium text-danger">{step.message}</p>}

          {step.kind === "choose" &&
            (step.posts.length === 0 ? (
              <p className="text-[15px] text-muted">Every post here is already scheduled or posted.</p>
            ) : (
              <>
                <p className="text-[15px]">
                  {step.posts.length === 1 ? "1 post" : `${step.posts.length} posts`} not posted yet.
                  {step.posts.some((p) => p.blocked) && ` ${step.posts.filter((p) => p.blocked).length} cannot go yet and will be skipped (open them to see why).`} Posts on the same account go out at least 2.5 hours apart.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" disabled={pending} onClick={() => submit(step.posts, step.zone, false)} className="glass flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-card p-4 text-left hover:bg-soft disabled:opacity-60">
                    <span className="inline-flex items-center gap-2 font-semibold"><Sparkles aria-hidden className="size-4 text-pulse-blue" /> Schedule for me</span>
                    <span className="text-[14px] text-muted">Each post at the best time for its app.</span>
                  </button>
                  <button type="button" disabled={pending} onClick={() => setStep({ kind: "times", posts: step.posts, zone: step.zone })} className="glass flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-card p-4 text-left hover:bg-soft disabled:opacity-60">
                    <span className="inline-flex items-center gap-2 font-semibold"><CalendarClock aria-hidden className="size-4 text-pulse-blue" /> I&apos;ll choose times</span>
                    <span className="text-[14px] text-muted">A time for each post, starting from our suggestion.</span>
                  </button>
                </div>
              </>
            ))}

          {step.kind === "times" && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit(step.posts, step.zone, true);
              }}
            >
              <ul className="flex flex-col divide-y divide-line">
                {step.posts.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <NetworkIcon network={p.network as Network} size={24} />
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold">{p.subject}</span>
                        <span className="block truncate text-[13px] text-muted">{p.blocked ?? p.excerpt}</span>
                      </span>
                    </div>
                    <label className="sr-only" htmlFor={`time-${p.id}`}>
                      Time for the {p.label} post about {p.subject} ({step.zone})
                    </label>
                    <input
                      id={`time-${p.id}`}
                      type="datetime-local"
                      disabled={Boolean(p.blocked)}
                      value={times[p.id] ?? ""}
                      min={toLocalInput(new Date(nowMs), step.zone)}
                      max={toLocalInput(new Date(nowMs + 90 * 86_400_000), step.zone)}
                      onChange={(e) => setTimes((t) => ({ ...t, [p.id]: e.target.value }))}
                      className="min-h-11 rounded-[14px] border border-line bg-glass px-3 text-[15px] text-text disabled:opacity-50"
                    />
                  </li>
                ))}
              </ul>
              <p className="text-[13px] text-muted">Times are in {step.zone.replace(/_/g, " ")}. An empty time means the best time.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={pending}>{pending ? "Scheduling..." : "Schedule these posts"}</Button>
                <Button type="button" variant="ghost" onClick={() => setStep({ kind: "choose", posts: step.posts, zone: step.zone })}>Back</Button>
              </div>
            </form>
          )}

          {step.kind === "done" && (
            <div role="status" className="flex flex-col gap-3">
              <p className="text-[15px] font-semibold">
                Scheduled {step.result.scheduled.length} of {step.posts.length}.
                {step.result.skipped.length > 0 && ` ${step.result.skipped.length} skipped.`}
              </p>
              {step.result.scheduled.length > 0 && (
                <ul className="flex flex-col gap-1 text-[14px]">
                  {step.result.scheduled.map((s) => (
                    <li key={s.id}>
                      {byId(step.posts, s.id)?.label} · {byId(step.posts, s.id)?.subject}: {formatDateTime(s.at, step.zone)}
                    </li>
                  ))}
                </ul>
              )}
              {step.result.skipped.length > 0 && (
                <ul className="flex flex-col gap-1 text-[14px] text-danger">
                  {step.result.skipped.map((s) => (
                    <li key={s.id}>
                      {byId(step.posts, s.id)?.label} · {byId(step.posts, s.id)?.subject}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Done</Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
