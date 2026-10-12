"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Chip, Dialog, Field, GlassCard, Input, Textarea, useToast } from "@/components/ui";
import { answerQuestion, approveVoice, previousQuestion, startInterview } from "@/app/dashboard/knowledge/interview/actions";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { OTHER_MAX, SUMMARY_LIMITS, summarySchema, TOPIC_KEYS, topicLabel, type InterviewStep, type MarketingProfile, type VoiceSummary } from "@/lib/knowledge/interview";
import type { InterviewView } from "@/lib/knowledge/interview-service";
import { Progress } from "./progress";

/** Knowledge base -> Digital marketing profile: the interview, the summary to approve, and the approved voice. */
export function MarketingInterview({ view }: { view: InterviewView }) {
  if (view.status === "active" && view.steps[view.cursor]) return <QuestionCard key={`${view.cursor}:${view.steps.length}`} view={view} />;
  if (view.status === "review" && view.summary) return <SummaryEditor initial={view.summary} mode="approve" />;
  return <Overview profile={view.profile} />;
}

function useRun() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const run = (task: () => Promise<{ ok: true } | { ok: false; error: string }>, onError?: (error: string) => void) =>
    start(async () => {
      const result = await task();
      if (!result.ok) {
        if (onError) onError(result.error);
        else toast(result.error, "error");
        return;
      }
      router.refresh();
    });
  return { pending, run };
}

function Overview({ profile }: { profile: MarketingProfile | null }) {
  const { pending, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  if (profile && editing) return <SummaryEditor initial={profile} mode="edit" onDone={() => setEditing(false)} />;

  return (
    <>
      {profile ? (
        <GlassCard as="section" aria-labelledby="voice" className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="voice" className="text-lg font-semibold tracking-[-0.02em]">
              Your brand voice
            </h2>
            <Badge tone="success">Approved · used in every post</Badge>
          </div>
          <p className="text-[15px] whitespace-pre-line">{profile.voice}</p>
          <Rules title="Do" items={profile.do} />
          <Rules title="Don't" items={profile.dont} />
          {profile.samples.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[15px] font-semibold">Sample captions</h3>
              {profile.samples.map((s, i) => (
                <blockquote key={i} className="glass rounded-2xl p-4 text-[15px] whitespace-pre-line">
                  {s}
                </blockquote>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit the voice
            </Button>
            <Button variant="outline" leading={<RotateCcw aria-hidden className="size-4" />} onClick={() => setConfirming(true)}>
              Take the interview again
            </Button>
          </div>
        </GlassCard>
      ) : (
        <GlassCard as="section" aria-labelledby="interview-intro" className="flex flex-col gap-4 p-5 sm:p-6">
          <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-brand-gradient text-white">
            <Sparkles aria-hidden className="size-5" />
          </span>
          <h2 id="interview-intro" className="text-lg font-semibold tracking-[-0.02em]">
            Set your brand voice in about 5 minutes
          </h2>
          <p className="text-[15px] text-muted">
            About {TOPIC_KEYS.length} quick multiple-choice questions on your tone, emojis, languages, goals and what never to say. Each question adapts to your earlier answers. You can skip any question, go back, and edit
            the result before you approve it. Your approved voice is then used for every post BuPulse writes.
          </p>
          <Button className="self-start" disabled={pending} trailing={<ArrowRight aria-hidden className="size-4" />} onClick={() => run(() => startInterview())}>
            Start the interview
          </Button>
        </GlassCard>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming} title="Take the interview again?" description="Your current brand voice stays in use until you approve a new one.">
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => run(() => startInterview({ startOver: true }))}>
            Start again
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** "Start over" during an interview or its review: asks first (the answers are thrown away; it counts toward the daily limit). */
function StartOver() {
  const { pending, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" disabled={pending} leading={<RotateCcw aria-hidden className="size-4" />} onClick={() => setConfirming(true)}>
        Start over
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming} title="Start the interview over?" description="Your answers so far are thrown away. You can start over 3 times a day.">
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Keep my answers
          </Button>
          <Button disabled={pending} onClick={() => run(() => startInterview({ startOver: true }))}>
            Start over
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function Rules({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <ul className="list-disc pl-5 text-[15px] text-muted">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function QuestionCard({ view }: { view: InterviewView }) {
  const { pending, run } = useRun();
  const step: InterviewStep = view.steps[view.cursor];
  const [choices, setChoices] = useState<string[]>(step.answer?.choices ?? []);
  const [other, setOther] = useState(step.answer?.other ?? "");
  const [error, setError] = useState<string | null>(null);
  const number = view.cursor + 1;
  const total = Math.max(TOPIC_KEYS.length, view.steps.length);

  function toggle(option: string) {
    setError(null);
    if (step.multi) setChoices((c) => (c.includes(option) ? c.filter((x) => x !== option) : [...c, option]));
    else {
      setChoices((c) => (c[0] === option ? [] : [option]));
      setOther("");
    }
  }

  const answer = () => run(() => answerQuestion({ index: view.cursor, choices, other }), setError);

  return (
    <GlassCard as="section" aria-labelledby="question" className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
          <span>
            Question {number} of about {total} · {topicLabel(step.topic)}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {view.mode === "fixed" && <span>Standard questions (the AI is not available right now)</span>}
            <StartOver />
          </span>
        </div>
        <Progress percent={Math.round((view.cursor / total) * 100)} label="Interview progress" />
      </div>
      <h2 id="question" className="text-xl font-semibold tracking-[-0.02em]">
        {step.question}
      </h2>
      <div role="group" aria-labelledby="question" className="flex flex-wrap gap-2">
        {step.options.map((o) => (
          <Chip key={o} selected={choices.includes(o)} onClick={() => toggle(o)} className="px-4 py-2 whitespace-normal text-left">
            {o}
          </Chip>
        ))}
      </div>
      <p className="-mt-2 text-[13px] text-muted">{step.multi ? "Pick as many as fit." : "Pick one."}</p>
      <Field label="Other (your own words)" hint={step.multi ? "Optional, with or without the options above." : "Instead of an option above."}>
        <Input
          value={other}
          maxLength={OTHER_MAX}
          onChange={(e) => {
            setOther(e.target.value);
            setError(null);
            if (!step.multi && e.target.value) setChoices([]);
          }}
        />
      </Field>
      {error && (
        <p role="alert" className="text-[14px] font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" disabled={pending || view.cursor === 0} leading={<ArrowLeft aria-hidden className="size-4" />} onClick={() => run(previousQuestion)}>
          Back
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => run(() => answerQuestion({ index: view.cursor, choices: [], other: "", skip: true }))}>
            Skip
          </Button>
          <Button disabled={pending || (!choices.length && !other.trim())} trailing={<ArrowRight aria-hidden className="size-4" />} onClick={answer}>
            {pending ? "Thinking…" : "Next"}
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

function LinesField({ label, hint, items, onChange, error, max, each, rows }: { label: string; hint?: string; items: string[]; onChange: (items: string[]) => void; error?: string; max: number; each: number; rows?: number }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[14px] font-semibold">{label}</legend>
      {hint && <p className="-mt-1 text-[13px] text-muted">{hint}</p>}
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          {rows ? (
            <Textarea aria-label={`${label} ${i + 1}`} rows={rows} value={item} maxLength={each} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} className="flex-1" />
          ) : (
            <Input aria-label={`${label} ${i + 1}`} value={item} maxLength={each} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} className="flex-1" />
          )}
          <Button variant="ghost" size="sm" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </div>
      ))}
      {items.length < max && (
        <Button variant="ghost" size="sm" className="self-start" leading={<Plus aria-hidden className="size-4" />} onClick={() => onChange([...items, ""])}>
          Add
        </Button>
      )}
      {error && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** The brand-voice summary: written by the AI (or from the answers), edited and approved by the owner. */
function SummaryEditor({ initial, mode, onDone }: { initial: VoiceSummary; mode: "approve" | "edit"; onDone?: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [values, setValues] = useState<VoiceSummary>({ voice: initial.voice, do: initial.do, dont: initial.dont, samples: initial.samples });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const back = useRun();

  function submit() {
    const tidy = { ...values, do: values.do.filter((x) => x.trim()), dont: values.dont.filter((x) => x.trim()), samples: values.samples.filter((x) => x.trim()) };
    const check = summarySchema.safeParse(tidy);
    if (!check.success) return setErrors(fieldErrorMap(check.error));
    start(async () => {
      const result = await approveVoice(tidy, mode);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { voice: result.error });
        return;
      }
      toast(mode === "approve" ? "Brand voice approved. Every new post now follows it." : "Brand voice saved.", "success");
      onDone?.();
      router.refresh();
    });
  }

  return (
    <GlassCard as="section" aria-labelledby="summary" className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="summary" className="text-lg font-semibold tracking-[-0.02em]">
            {mode === "approve" ? "Your brand voice, ready to approve" : "Edit your brand voice"}
          </h2>
          {mode === "approve" && <StartOver />}
        </div>
        <p className="text-[14px] text-muted">Change anything that does not sound like you. BuPulse follows this for every post once approved.</p>
      </div>
      <Field label="The voice" required error={errors.voice}>
        <Textarea rows={4} value={values.voice} maxLength={SUMMARY_LIMITS.voice} onChange={(e) => setValues((v) => ({ ...v, voice: e.target.value }))} />
      </Field>
      <LinesField label="Do" items={values.do} onChange={(x) => setValues((v) => ({ ...v, do: x }))} error={errors.do} max={SUMMARY_LIMITS.lines} each={SUMMARY_LIMITS.line} />
      <LinesField label="Don't" items={values.dont} onChange={(x) => setValues((v) => ({ ...v, dont: x }))} error={errors.dont} max={SUMMARY_LIMITS.lines} each={SUMMARY_LIMITS.line} />
      <LinesField
        label="Sample captions"
        hint="Examples of the voice. They guide the tone; they are never posted as they are."
        items={values.samples}
        onChange={(x) => setValues((v) => ({ ...v, samples: x }))}
        error={errors.samples}
        max={SUMMARY_LIMITS.samples}
        each={SUMMARY_LIMITS.sample}
        rows={3}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {mode === "approve" ? (
          <Button variant="ghost" disabled={pending || back.pending} leading={<ArrowLeft aria-hidden className="size-4" />} onClick={() => back.run(previousQuestion)}>
            Back to the questions
          </Button>
        ) : (
          <Button variant="ghost" disabled={pending} onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button disabled={pending} leading={<Check aria-hidden className="size-4" />} onClick={submit}>
          {mode === "approve" ? "Approve this voice" : "Save the voice"}
        </Button>
      </div>
    </GlassCard>
  );
}
