"use client";

import { CalendarRange, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createTasksAction, deleteTaskAction, updateTaskAction } from "@/app/dashboard/creators/actions";
import { formatShortDate } from "@/components/analytics/format";
import { Badge, Button, Dialog, Field, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { firstProblem, PLATFORM_LABEL, TASK_MEDIA, TASK_MEDIA_LABEL, taskSchema, taskSpans, type Platform, type TaskInput, type TaskRepeat } from "@/lib/creators/company-forms";
import type { TaskRow } from "@/lib/creators/campaigns";
import { addDaysYmd } from "@/lib/demo/slots";

type Campaign = { id: string; startsOn: string; endsOn: string; platforms: string[]; status: string };

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);
const span = (t: { startsOn: string; endsOn: string }) => (t.startsOn === t.endsOn ? formatShortDate(t.startsOn) : `${formatShortDate(t.startsOn)} to ${formatShortDate(t.endsOn)}`);

function TaskForm({ campaign, today, task, onDone }: { campaign: Campaign; today: string; task: TaskRow | null; onDone: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const first = later(campaign.startsOn, today) > campaign.endsOn ? campaign.startsOn : later(campaign.startsOn, today);
  const [title, setTitle] = useState(task?.title ?? "");
  const [instructions, setInstructions] = useState(task?.instructions ?? "");
  const [startsOn, setStartsOn] = useState(task?.startsOn ?? campaign.startsOn);
  const [endsOn, setEndsOn] = useState(task?.endsOn ?? campaign.endsOn);
  const [repeat, setRepeat] = useState<TaskRepeat>("none");
  const [postsPerDay, setPostsPerDay] = useState(String(task?.postsPerDay ?? 1));
  const [platforms, setPlatforms] = useState<string[]>(task?.platforms ?? campaign.platforms);
  const [platformMode, setPlatformMode] = useState<"ALL" | "ANY">(task?.platformMode ?? "ANY");
  const [mediaKind, setMediaKind] = useState<(typeof TASK_MEDIA)[number]>(task?.mediaKind ?? "VIDEO");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const input: TaskInput = { title, instructions, startsOn, endsOn, postsPerDay: Number(postsPerDay), platforms: platforms as Platform[], platformMode, mediaKind };
  const made = task ? 1 : taskSpans(startsOn, endsOn, repeat).length;
  const preset = (from: string, days: number | null) => {
    setStartsOn(from);
    setEndsOn(days === null ? campaign.endsOn : earlier(addDaysYmd(from, days - 1), campaign.endsOn));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const checked = taskSchema.safeParse(input);
    if (!checked.success) return setError(firstProblem(checked.error));
    setError(null);
    setBusy(true);
    const r = task ? await updateTaskAction(campaign.id, task.id, input) : await createTasksAction(campaign.id, input, repeat);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast(task ? "Task saved." : made === 1 ? "Task added." : `${made} tasks added.`, "success");
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Title" required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Show our juice at the beach" />
      </Field>
      <Field label="What to post" required hint="Say what the video or photo shows, how long, and anything to say or avoid.">
        <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4} maxLength={4000} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Days</legend>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => preset(campaign.startsOn, null)}>Whole campaign</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => preset(first, 7)}>One week</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => preset(first, 1)}>One day</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day">
            <Input type="date" value={startsOn} min={campaign.startsOn} max={campaign.endsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label="Last day">
            <Input type="date" value={endsOn} min={startsOn} max={campaign.endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>
        <p className="text-[13px] text-muted">The task repeats on every day of it: each day, creators hand in its posts.</p>
      </fieldset>
      {!task && (
        <Field label="Make" hint={made > 1 ? `Makes ${made} tasks with the same words; you can change each one after.` : undefined}>
          <Select value={repeat} onChange={(e) => setRepeat(e.target.value as TaskRepeat)}>
            <option value="none">One task for these days</option>
            <option value="week">One task per week</option>
            <option value="day">One task per day</option>
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Posts a day">
          <Input type="number" min={1} max={10} step={1} value={postsPerDay} onChange={(e) => setPostsPerDay(e.target.value)} />
        </Field>
        <Field label="Kind">
          <Select value={mediaKind} onChange={(e) => setMediaKind(e.target.value as (typeof TASK_MEDIA)[number])}>
            {TASK_MEDIA.map((m) => (
              <option key={m} value={m}>{TASK_MEDIA_LABEL[m]}</option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Platforms</legend>
        <div className="flex flex-wrap gap-2">
          {campaign.platforms.map((p) => (
            <button key={p} type="button" aria-pressed={platforms.includes(p)} onClick={() => setPlatforms(platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p])} className={cn("min-h-11 cursor-pointer rounded-full border px-4 text-[15px] font-medium", platforms.includes(p) ? "border-transparent bg-brand-gradient text-white" : "border-line hover:bg-soft")}>
              {PLATFORM_LABEL[p as Platform] ?? p}
            </button>
          ))}
        </div>
        {platforms.length > 1 && (
          <div className="flex flex-col gap-1 text-[15px]">
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="mode" className="size-5" checked={platformMode === "ANY"} onChange={() => setPlatformMode("ANY")} />
              One post on any of them
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="mode" className="size-5" checked={platformMode === "ALL"} onChange={() => setPlatformMode("ALL")} />
              A post on every one of them
            </label>
          </div>
        )}
      </fieldset>
      {error && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[15px] font-medium text-danger">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : task ? "Save task" : made > 1 ? `Add ${made} tasks` : "Add task"}
      </Button>
    </form>
  );
}

/** The campaign's tasks: what creators post, day by day. */
export function TaskManager({ campaign, tasks, today }: { campaign: Campaign; tasks: TaskRow[]; today: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<TaskRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<TaskRow | null>(null);
  const [busy, setBusy] = useState(false);
  const ended = campaign.status === "ENDED";

  async function remove(t: TaskRow) {
    setBusy(true);
    const r = await deleteTaskAction(campaign.id, t.id);
    setBusy(false);
    setDeleting(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Task deleted.", "success");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="max-w-2xl text-[15px] text-muted">A task covers a span of days and repeats on each of them: one for the whole month, one per week or one per day.</p>
        {!ended && (
          <Button leading={<Plus aria-hidden className="size-4" />} onClick={() => setEditing("new")}>
            Add a task
          </Button>
        )}
      </div>
      {tasks.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 p-8 text-center">
          <CalendarRange aria-hidden className="size-10 text-pulse-blue" />
          <p className="text-[17px] font-semibold">No tasks yet</p>
          <p className="max-w-md text-[15px] text-muted">Add at least one before going live. The quickest: one task for the whole campaign, with what to post every day.</p>
        </GlassCard>
      ) : (
        <GlassCard padding="none" className="divide-y divide-line">
          {tasks.map((t) => {
            const now = t.startsOn <= today && today <= t.endsOn;
            return (
              <div key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{t.title}</span>
                    {now && <Badge tone="success">Today</Badge>}
                    {t.submissions > 0 && <Badge tone="neutral">{t.submissions} handed in</Badge>}
                  </span>
                  <span className="text-[13px] text-muted">
                    {span(t)} · {t.postsPerDay} {t.postsPerDay === 1 ? "post" : "posts"} a day · {TASK_MEDIA_LABEL[t.mediaKind]} ·{" "}
                    {t.platforms.length > 1 ? `${t.platformMode === "ALL" ? "on each of" : "on any of"} ${t.platforms.map((p) => PLATFORM_LABEL[p as Platform] ?? p).join(", ")}` : (PLATFORM_LABEL[t.platforms[0] as Platform] ?? t.platforms[0])}
                  </span>
                  <p className="line-clamp-2 text-[14px] text-muted">{t.instructions}</p>
                </div>
                {!ended && (
                  <div className="flex gap-1">
                    <button type="button" aria-label={`Edit ${t.title}`} onClick={() => setEditing(t)} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
                      <Pencil aria-hidden className="size-4" />
                    </button>
                    <button type="button" aria-label={`Delete ${t.title}`} disabled={t.submissions > 0} title={t.submissions > 0 ? "Already handed in: change it instead" : undefined} onClick={() => setDeleting(t)} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-danger disabled:opacity-40">
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </GlassCard>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? "Add a task" : "Edit the task"}>
        {editing !== null && <TaskForm key={editing === "new" ? "new" : editing.id} campaign={campaign} today={today} task={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this task?" description={deleting ? `"${deleting.title}" (${span(deleting)}) goes away for every creator.` : undefined}>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => deleting && remove(deleting)}>Delete</Button>
          <Button variant="outline" onClick={() => setDeleting(null)}>Keep it</Button>
        </div>
      </Dialog>
    </div>
  );
}
