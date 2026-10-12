"use client";

import { useMemo, useOptimistic, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Globe, ListTodo, Plus } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { approvePostsAction, reschedulePostAction } from "@/app/dashboard/calendar/actions";
import { cn } from "@/lib/cn";
import { QUEUED } from "@/lib/publishing/status";
import { addDays, addMonths, dayKey, moveToDay, startOfMonth } from "@/lib/publishing/time";
import type { CalendarPost, ComposerContext } from "@/lib/publishing/types";
import { PostComposer } from "./composer";
import { formatDay, groupByDay, monthWeeks, rangeLabel, weekDays } from "./helpers";
import { PostCard } from "./post-card";
import { PostDetail } from "./post-detail";
import { TimezoneForm } from "./timezone-form";

const isPast = (date: Date) => date.getTime() <= Date.now();

type View = "week" | "month" | "queue";

const VIEWS: { value: View; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "queue", label: "Queue" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Props = { posts: CalendarPost[]; context: ComposerContext; todayKey: string; nowIso: string; /** Changing the company time zone is a settings action (Owner and Admins). */ canSetZone?: boolean };

/** The calendar: week, month and queue views in the business's time zone, with drag-to-reschedule and approvals. */
export function Calendar({ posts, context, todayKey, nowIso, canSetZone = true }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const zone = context.timezone;
  const [, startTransition] = useTransition();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(todayKey);
  const [composer, setComposer] = useState<{ post?: CalendarPost; day?: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [tzOpen, setTzOpen] = useState(false);
  const [dragging, setDragging] = useState<CalendarPost | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [live, setLive] = useState("");

  const [shown, applyChange] = useOptimistic(posts, (current, change: { type: "move"; id: string; at: string } | { type: "approve"; ids: string[] }) =>
    change.type === "move"
      ? current.map((p) => (p.id === change.id ? { ...p, scheduledAt: change.at } : p))
      : current.map((p) => (change.ids.includes(p.id) ? { ...p, status: "SCHEDULED" as const } : p)),
  );
  const byDay = useMemo(() => groupByDay(shown, zone), [shown, zone]);
  const detail = shown.find((p) => p.id === detailId) ?? null;
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const weeks = useMemo(() => monthWeeks(anchor), [anchor]);
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const rangeDays = view === "week" ? days : view === "month" ? weeks.flat() : [];
  const pendingInView = shown.filter((p) => p.status === "PENDING_APPROVAL" && p.scheduledAt && rangeDays.includes(dayKey(new Date(p.scheduledAt), zone)));
  const pendingAll = shown.filter((p) => p.status === "PENDING_APPROVAL");

  function step(direction: -1 | 1) {
    setAnchor((a) => (view === "month" ? addMonths(startOfMonth(a), direction) : addDays(a, direction * 7)));
  }

  function moveTo(post: CalendarPost, targetDay: string) {
    if (!post.scheduledAt) return;
    const at = moveToDay(new Date(post.scheduledAt), targetDay, zone);
    if (at.getTime() === new Date(post.scheduledAt).getTime()) return;
    if (isPast(at)) {
      toast("That time has already passed. Pick a time in the future.", "error");
      return;
    }
    startTransition(async () => {
      applyChange({ type: "move", id: post.id, at: at.toISOString() });
      const res = await reschedulePostAction(post.id, at.toISOString());
      if (res.ok) setLive(`Moved to ${formatDay(targetDay, { weekday: "long", month: "long", day: "numeric" })}.`);
      else toast(res.error, "error");
      router.refresh();
    });
  }

  function moveByDays(post: CalendarPost, delta: number) {
    if (!post.scheduledAt) return;
    moveTo(post, addDays(dayKey(new Date(post.scheduledAt), zone), delta));
  }

  function onDrop(e: DragEvent, targetDay: string) {
    e.preventDefault();
    const post = dragging;
    setDragging(null);
    setOverDay(null);
    if (post) moveTo(post, targetDay);
  }

  function dropProps(key: string) {
    return {
      onDragOver: (e: DragEvent) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (overDay !== key) setOverDay(key);
      },
      onDragLeave: () => setOverDay((cur) => (cur === key ? null : cur)),
      onDrop: (e: DragEvent) => onDrop(e, key),
    };
  }

  function approve(ids: string[]) {
    startTransition(async () => {
      applyChange({ type: "approve", ids });
      const res = await approvePostsAction(ids);
      if (res.ok) toast(res.approved === 1 ? "Approved 1 post." : `Approved ${res.approved} posts.`, "success");
      else toast(res.error, "error");
      router.refresh();
    });
  }

  const card = (post: CalendarPost, compact = false) => (
    <PostCard key={post.id} post={post} zone={zone} compact={compact} onOpen={(p) => setDetailId(p.id)} onMoveByDays={moveByDays} onDragStart={setDragging} />
  );

  const dayList = (keys: string[], opts: { onlyWithPosts?: boolean } = {}) => {
    const list = opts.onlyWithPosts ? keys.filter((k) => byDay.has(k)) : keys;
    if (list.length === 0) return <p className="rounded-2xl bg-soft px-4 py-8 text-center text-[15px] text-muted">Nothing scheduled here yet.</p>;
    return (
      <ul className="flex flex-col gap-4">
        {list.map((key) => (
          <li key={key} className="flex flex-col gap-2">
            <h3 className={cn("flex items-center gap-2 px-1 text-sm font-semibold", key === todayKey && "text-pulse-blue")}>
              {formatDay(key, { weekday: "long", month: "short", day: "numeric" })}
              {key === todayKey && <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px]">Today</span>}
            </h3>
            {(byDay.get(key) ?? []).length === 0 ? (
              <button type="button" onClick={() => setComposer({ day: key })} className="min-h-11 cursor-pointer rounded-xl border border-dashed border-line px-3 text-left text-[13px] text-muted hover:bg-soft">
                Nothing planned. Add a post
              </button>
            ) : (
              <div className="flex flex-col gap-2">{(byDay.get(key) ?? []).map((p) => card(p))}</div>
            )}
          </li>
        ))}
      </ul>
    );
  };

  const upcoming = shown
    .filter((p) => p.scheduledAt && (QUEUED as readonly string[]).includes(p.status) && new Date(p.scheduledAt).getTime() >= now.getTime() - 60_000)
    .sort((a, b) => (a.scheduledAt as string).localeCompare(b.scheduledAt as string));
  const upcomingByDay = groupByDay(upcoming, zone);
  const attention = shown.filter((p) => p.status === "FAILED" || p.status === "NEEDS_ACTION");
  const drafts = shown.filter((p) => p.status === "DRAFT");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <div role="group" aria-label="Calendar view" className="glass inline-flex rounded-full p-1">
          {VIEWS.map((v) => (
            <button key={v.value} type="button" aria-pressed={view === v.value} onClick={() => setView(v.value)} className={cn("inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors", view === v.value ? "bg-brand-gradient text-white" : "text-muted hover:text-text")}>
              {v.value === "queue" ? <ListTodo aria-hidden className="size-4" /> : v.value === "month" ? <CalendarDays aria-hidden className="size-4" /> : null}
              {v.label}
            </button>
          ))}
        </div>
        {view !== "queue" && (
          <div className="flex items-center gap-1">
            <button type="button" aria-label={view === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft"><ChevronLeft aria-hidden className="size-5" /></button>
            <button type="button" onClick={() => setAnchor(todayKey)} className="inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-sm font-semibold hover:bg-soft">Today</button>
            <button type="button" aria-label={view === "month" ? "Next month" : "Next week"} onClick={() => step(1)} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft"><ChevronRight aria-hidden className="size-5" /></button>
            <h2 aria-live="polite" className="ml-1 text-[17px] font-semibold tracking-tight">{rangeLabel(view, anchor)}</h2>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {context.timingNote && <span className="text-[13px] text-muted max-md:hidden">{context.timingNote}</span>}
          {canSetZone ? (
            <button type="button" onClick={() => setTzOpen(true)} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] text-muted hover:bg-soft hover:text-text">
              <Globe aria-hidden className="size-4" /> {zone.replace(/_/g, " ")}
            </button>
          ) : (
            <span className="inline-flex min-h-11 items-center gap-1.5 px-3 text-[13px] text-muted"><Globe aria-hidden className="size-4" /> {zone.replace(/_/g, " ")}</span>
          )}
          <Button size="sm" leading={<Plus aria-hidden className="size-4" />} onClick={() => setComposer({})}>Create post</Button>
        </div>
      </div>

      {zone === "UTC" && canSetZone && (
        <div className="glass flex flex-col gap-3 rounded-2xl p-4">
          <p className="text-[14px]"><span className="font-semibold">Set your time zone.</span> <span className="text-muted">Your calendar is on UTC, so posts would go out at the wrong local time. Pick where you are.</span></p>
          <TimezoneForm current={zone} />
        </div>
      )}

      {view !== "queue" && pendingInView.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-new-bg p-3.5 text-[14px]">
          <span><span className="font-semibold text-new">{pendingInView.length} {pendingInView.length === 1 ? "post is" : "posts are"} waiting for your OK</span> <span className="text-muted">this {view}.</span></span>
          <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} onClick={() => approve(pendingInView.map((p) => p.id))}>Approve all</Button>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">{live}</p>

      {view === "week" && (
        <>
          <div className="hidden grid-cols-7 gap-2 md:grid">
            {days.map((key) => (
              <section key={key} aria-label={formatDay(key, { weekday: "long", month: "long", day: "numeric" })} {...dropProps(key)} className={cn("flex min-h-[320px] min-w-0 flex-col gap-2 rounded-2xl border p-2 transition-colors", overDay === key ? "border-pulse-blue bg-ok-bg" : key === todayKey ? "border-ok/40 bg-glass-strong" : "border-line bg-glass")}>
                <header className="flex items-center justify-between px-1 pt-1">
                  <span className={cn("text-[13px] font-semibold", key === todayKey ? "text-pulse-blue" : "text-muted")}>{formatDay(key, { weekday: "short" })}</span>
                  <button type="button" aria-label={`Add a post on ${formatDay(key, { weekday: "long", month: "long", day: "numeric" })}`} onClick={() => setComposer({ day: key })} className={cn("inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-[15px] font-semibold hover:bg-soft", key === todayKey && "bg-brand-gradient text-white hover:bg-brand-gradient")}>
                    {Number(key.slice(8))}
                  </button>
                </header>
                <div className="flex flex-col gap-2">{(byDay.get(key) ?? []).map((p) => card(p))}</div>
              </section>
            ))}
          </div>
          <div className="md:hidden">{dayList(days)}</div>
        </>
      )}

      {view === "month" && (
        <>
          <div className="hidden md:block">
            <div className="grid grid-cols-7 gap-1 px-1 pb-1 text-center text-[12px] font-semibold text-muted">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {weeks.flat().map((key) => {
                const list = byDay.get(key) ?? [];
                const inMonth = key.slice(0, 7) === anchor.slice(0, 7);
                return (
                  <section key={key} aria-label={formatDay(key, { weekday: "long", month: "long", day: "numeric" })} {...dropProps(key)} className={cn("flex min-h-[116px] min-w-0 flex-col gap-1 rounded-xl border p-1.5 transition-colors", overDay === key ? "border-pulse-blue bg-ok-bg" : "border-line bg-glass", !inMonth && "opacity-50")}>
                    <button type="button" aria-label={`Add a post on ${formatDay(key, { weekday: "long", month: "long", day: "numeric" })}`} onClick={() => setComposer({ day: key })} className={cn("inline-flex size-7 cursor-pointer items-center justify-center self-start rounded-full text-[13px] font-semibold hover:bg-soft", key === todayKey && "bg-brand-gradient text-white hover:bg-brand-gradient")}>
                      {Number(key.slice(8))}
                    </button>
                    {list.slice(0, 3).map((p) => card(p, true))}
                    {list.length > 3 && (
                      <button type="button" onClick={() => { setAnchor(key); setView("week"); }} className="min-h-8 cursor-pointer px-1 text-left text-[12px] font-semibold text-pulse-blue">+{list.length - 3} more</button>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
          <div className="md:hidden">{dayList(weeks.flat().filter((k) => k.slice(0, 7) === anchor.slice(0, 7)), { onlyWithPosts: true })}</div>
        </>
      )}

      {view === "queue" && (
        <div className="flex flex-col gap-6">
          {attention.length > 0 && (
            <section aria-label="Needs your attention" className="flex flex-col gap-2">
              <h3 className="px-1 text-sm font-semibold">Needs your attention</h3>
              <div className="grid gap-2 md:grid-cols-2">{attention.map((p) => card(p))}</div>
            </section>
          )}
          {pendingAll.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-new-bg p-3.5 text-[14px]">
              <span className="font-semibold text-new">{pendingAll.length} {pendingAll.length === 1 ? "post is" : "posts are"} waiting for your OK</span>
              <Button size="sm" leading={<CheckCheck aria-hidden className="size-4" />} onClick={() => approve(pendingAll.map((p) => p.id))}>Approve all</Button>
            </div>
          )}
          <section aria-label="Upcoming posts" className="flex flex-col gap-3">
            <h3 className="px-1 text-sm font-semibold">Upcoming</h3>
            {upcoming.length === 0 ? (
              <div className="glass flex flex-col items-start gap-3 rounded-2xl p-5">
                <p className="text-[15px] text-muted">Your queue is empty. Add a post and it goes out at your next free posting time ({context.slotTimes.join(", ")}).</p>
                <Button size="sm" leading={<Plus aria-hidden className="size-4" />} onClick={() => setComposer({})}>Create post</Button>
              </div>
            ) : (
              <ul className="flex flex-col gap-4">
                {[...upcomingByDay].map(([key, list]) => (
                  <li key={key} className="flex flex-col gap-2">
                    <h4 className={cn("px-1 text-[13px] font-semibold text-muted", key === todayKey && "text-pulse-blue")}>{key === todayKey ? "Today" : formatDay(key, { weekday: "long", month: "short", day: "numeric" })}</h4>
                    <div className="grid gap-2 md:grid-cols-2">{list.map((p) => card(p))}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {drafts.length > 0 && (
            <section aria-label="Drafts" className="flex flex-col gap-2">
              <h3 className="px-1 text-sm font-semibold">Drafts</h3>
              <div className="grid gap-2 md:grid-cols-2">{drafts.map((p) => card(p))}</div>
            </section>
          )}
        </div>
      )}

      <PostComposer open={composer !== null} onOpenChange={(o) => !o && setComposer(null)} context={context} post={composer?.post} day={composer?.day} />
      <PostDetail post={detail} zone={zone} onClose={() => setDetailId(null)} onEdit={(post) => { setDetailId(null); setComposer({ post }); }} />
      <Dialog open={tzOpen} onOpenChange={setTzOpen} title="Time zone" description="The calendar, the queue and scheduled times all use this zone.">
        <TimezoneForm current={zone} onSaved={() => setTzOpen(false)} label="Save" />
      </Dialog>
    </div>
  );
}
