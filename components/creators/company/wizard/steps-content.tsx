"use client";

// Steps 6 to 8 of the campaign wizard: Content (the brief and the tasks), Rules, Pay (docs/CREATOR_CAMPAIGN_WIZARD.md).

import { ChevronDown, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { formatShortDate } from "@/components/analytics/format";
import { cn } from "@/lib/cn";
import { formatAmount, payRulesInWords, PLATFORM_LABEL, TASK_MEDIA_LABEL, type Platform } from "@/lib/creators/company-forms";
import { minRate, RATE_LEVEL_LABEL, RATE_VIEWS, rateLevel, suggestedRate, type RateLevel } from "@/lib/creators/pay-floor";
import { daysInclusive } from "@/lib/creators/periods";
import { BRIEF_EVERY } from "@/lib/creators/wizard";
import { costEstimate, MAX_RULE_LINES, MAX_WIZARD_TASKS, PAY_METHODS, payMethodOf, rulesForMethod, type PayMethod, type TaskMedia, type WizardTask } from "@/lib/creators/wizard-steps";
import { ruleChips } from "@/lib/creators/wizard-suggest";
import { ChoiceCards, MoneyInput, Question, Segmented, Stepper, toggle } from "./controls";
import type { StepProps } from "./wizard";

const later = (x: string, y: string) => (x > y ? x : y);
const SHOWN = 6;

export function ContentStep({ a, set, o, suggest, suggesting }: StepProps) {
  const draft = o.status === "DRAFT";
  const [all, setAll] = useState(a.tasks.length <= SHOWN);
  const every = BRIEF_EVERY.find((b) => b.value === (a.briefEvery ?? "MONTH"));
  const setTask = (i: number, patch: Partial<WizardTask>) => set({ tasks: a.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const addTask = () => {
    const first = draft ? a.startsOn : later(a.startsOn, o.today);
    set({ tasks: [...a.tasks, { title: "", instructions: "", startsOn: first > a.endsOn ? a.startsOn : first, endsOn: a.endsOn, postsPerDay: a.postsPerDay, platforms: a.platforms, platformMode: a.platformMode, mediaKind: a.mediaKind }] });
    setAll(true);
  };
  const shown = all ? a.tasks : a.tasks.slice(0, SHOWN);
  return (
    <div className="flex flex-col gap-7">
      <Question label="The brief" hint="What the posts should show and how. Creators read it before they apply." id="q-brief">
        <Textarea aria-labelledby="q-brief" rows={6} maxLength={4000} value={a.brief} onChange={(e) => set({ brief: e.target.value })} placeholder="Show how you enjoy our juice on a hot day. Film in a real place, with the bottle in view, and say what you love about it." />
        <div>
          <button type="button" disabled={suggesting} onClick={() => void suggest(["brief"])} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-[14px] font-semibold text-muted hover:bg-soft hover:text-text disabled:cursor-wait disabled:opacity-60">
            <Sparkles aria-hidden className="size-4 text-pulse-violet" /> {suggesting ? "Writing…" : "Rewrite the brief"}
          </button>
        </div>
      </Question>

      <Question label={`Tasks (${a.tasks.length})`} hint={draft ? `${every?.label ?? "One brief"}, from step When. Change the words of each one; Suggest again writes them all again.` : "A task creators already handed in cannot be deleted: change it instead."} id="q-tasks">
        <ol className="flex flex-col gap-3">
          {shown.map((t, i) => (
            <TaskCard key={t.id ?? `new-${i}`} n={i + 1} task={t} platforms={a.platforms} min={a.startsOn} max={a.endsOn} onChange={(p) => setTask(i, p)} onDelete={() => set({ tasks: a.tasks.filter((_, j) => j !== i) })} />
          ))}
        </ol>
        {!all && (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setAll(true)}>
            Show all {a.tasks.length} tasks
          </Button>
        )}
        {a.tasks.length < MAX_WIZARD_TASKS && (
          <Button variant="outline" size="sm" className="self-start" leading={<Plus aria-hidden className="size-4" />} onClick={addTask}>
            Add a task
          </Button>
        )}
      </Question>
    </div>
  );
}

const MEDIA_OPTIONS: { value: TaskMedia; label: string }[] = [
  { value: "VIDEO", label: TASK_MEDIA_LABEL.VIDEO },
  { value: "IMAGE", label: TASK_MEDIA_LABEL.IMAGE },
  { value: "ANY", label: "Either" },
];

function TaskCard({ n, task, platforms, min, max, onChange, onDelete }: { n: number; task: WizardTask; platforms: Platform[]; min: string; max: string; onChange: (p: Partial<WizardTask>) => void; onDelete: () => void }) {
  const [days, setDays] = useState(false);
  const locked = (task.submissions ?? 0) > 0;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-soft/60 p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-muted">
          Task {n} · {task.startsOn === task.endsOn ? formatShortDate(task.startsOn) : `${formatShortDate(task.startsOn)} to ${formatShortDate(task.endsOn)}`}
        </p>
        <button type="button" aria-label={`Delete task ${n}`} title={locked ? "Creators handed it in: it cannot be deleted" : undefined} disabled={locked} onClick={onDelete} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-glass hover:text-text disabled:cursor-not-allowed disabled:opacity-40">
          <Trash2 aria-hidden className="size-5" />
        </button>
      </div>
      <Field label="Title">
        <Input value={task.title} maxLength={120} onChange={(e) => onChange({ title: e.target.value })} placeholder="Your honest review" />
      </Field>
      <Field label="What to post">
        <Textarea rows={3} maxLength={4000} value={task.instructions} onChange={(e) => onChange({ instructions: e.target.value })} placeholder="Film a 15 to 30 second video: show the product in the first 3 seconds and say what you like about it." />
      </Field>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Stepper label={`Posts a day, task ${n}`} min={1} max={10} value={task.postsPerDay} onChange={(postsPerDay) => onChange({ postsPerDay })} unit={(v) => `${v} a day`} />
        <Segmented label={`Media, task ${n}`} value={task.mediaKind} onChange={(mediaKind) => onChange({ mediaKind })} options={MEDIA_OPTIONS} />
      </div>
      {platforms.length > 1 && (
        <div role="group" aria-label={`Networks, task ${n}`} className="flex flex-wrap gap-2">
          {platforms.map((p) => (
            <button key={p} type="button" aria-pressed={task.platforms.includes(p)} onClick={() => onChange({ platforms: toggle(task.platforms, p) })} className={cn("min-h-11 cursor-pointer rounded-full border px-4 text-[14px] font-medium", task.platforms.includes(p) ? "border-transparent bg-brand-gradient text-white" : "border-line text-text hover:bg-glass")}>
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </div>
      )}
      <button type="button" aria-expanded={days} onClick={() => setDays(!days)} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start rounded-full px-2 text-[14px] font-medium text-muted hover:text-text">
        <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", days && "rotate-180")} /> Change its days
      </button>
      {days && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From">
            <Input type="date" value={task.startsOn} min={min} max={max} onChange={(e) => e.target.value && onChange({ startsOn: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={task.endsOn} min={task.startsOn} max={max} onChange={(e) => e.target.value && onChange({ endsOn: e.target.value })} />
          </Field>
        </div>
      )}
    </li>
  );
}

function RuleList({ label, values, onChange, chips, placeholder, id }: { label: string; values: string[]; onChange: (v: string[]) => void; chips: string[]; placeholder: string; id: string }) {
  const [text, setText] = useState("");
  const options = [...values, ...chips.filter((c) => !values.some((v) => v.toLowerCase() === c.toLowerCase()))];
  const add = () => {
    const v = text.trim().replace(/\s+/g, " ").slice(0, 160);
    if (v.length >= 2 && !values.some((x) => x.toLowerCase() === v.toLowerCase()) && values.length < MAX_RULE_LINES) onChange([...values, v]);
    setText("");
  };
  return (
    <Question label={label} hint="Tap to add or take off. Add your own below." id={id}>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((c) => {
          const on = values.includes(c);
          return (
            <button key={c} type="button" aria-pressed={on} onClick={() => onChange(on ? values.filter((v) => v !== c) : values.length < MAX_RULE_LINES ? [...values, c] : values)} className={cn("inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-2xl border px-3.5 py-2 text-left text-[14px] font-medium", on ? "border-transparent bg-brand-gradient text-white" : "glass text-text")}>
              {on ? <X aria-hidden className="size-3.5 shrink-0" /> : <Plus aria-hidden className="size-3.5 shrink-0" />}
              {c}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label={`Your own: ${label}`}
          value={text}
          maxLength={160}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <Button variant="outline" onClick={add} disabled={text.trim().length < 2}>
          Add
        </Button>
      </div>
    </Question>
  );
}

export function RulesStep({ a, set, suggestion }: StepProps) {
  return (
    <div className="flex flex-col gap-7">
      <RuleList id="q-dos" label="Do's" values={a.dos} onChange={(dos) => set({ dos })} chips={ruleChips("dos", suggestion?.dos ?? [])} placeholder="Wear our T-shirt in the video" />
      <RuleList id="q-donts" label="Don'ts" values={a.donts} onChange={(donts) => set({ donts })} chips={ruleChips("donts", suggestion?.donts ?? [])} placeholder="Don't film inside the shop" />
      <Field label="Anything else? (optional)" hint="Shown before creators apply and on every task.">
        <Textarea rows={3} maxLength={4000} value={a.rules ?? ""} onChange={(e) => set({ rules: e.target.value })} placeholder="Only film in Kigali. Send us the video before you post it if you are not sure." />
      </Field>
    </div>
  );
}

const CURRENCIES = ["RWF", "USD", "KES", "UGX", "TZS", "BIF"];
const LEVEL_TONE: Record<RateLevel, string> = { LOW: "bg-danger text-white", FAIR: "bg-success text-white", GENEROUS: "bg-pulse-violet text-white", TOO_HIGH: "bg-danger text-white" };
const LEVELS: RateLevel[] = ["LOW", "FAIR", "GENEROUS", "TOO_HIGH"];
const VIEW_GUESSES = [5_000, 10_000, 50_000, 100_000];
const views = (n: number) => `${n.toLocaleString("en-US")} views`;
const short = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}K` : String(n));

export function PayStep({ a, set, o }: StepProps) {
  const draft = o.status === "DRAFT";
  const rules = a.payRules;
  const [method, setMethod] = useState<PayMethod>(payMethodOf(rules));
  const [guess, setGuess] = useState(a.viewTargetPerCreator && a.viewTargetPerCreator <= 100_000 ? a.viewTargetPerCreator : 10_000);
  const [limits, setLimits] = useState(Boolean(rules.capPerPost || rules.capPerCreator));
  const setRules = (patch: Partial<typeof rules>) => set({ payRules: { ...rules, ...patch } });
  const per = rules.rateViews ?? 1_000;
  const level = rules.ratePerThousand ? rateLevel(rules.ratePerThousand, per, a.currency) : null;
  const showViews = method === "VIEWS" || method === "MIX";
  const showFee = method === "POST" || method === "MIX";
  const showMilestones = method === "MILESTONES" || method === "MIX";
  const words = payRulesInWords({ ...rules, milestones: rules.milestones?.filter((m) => m.views > 0 && m.amount > 0) }, a.currency);
  const creators = a.requirements.creatorsWanted ?? Math.min(5, o.creatorsPerCampaign);
  const days = Math.max(1, Math.min(30, daysInclusive(a.startsOn, a.endsOn) || 30));
  const estimate = costEstimate({ rules, creators, viewsEach: guess, postsEach: a.postsPerDay * days, viewTargetPerCreator: a.viewTargetPerCreator, viewTargetCampaign: a.viewTargetCampaign, budget: a.budget });
  const money = (n: number) => formatAmount(n, a.currency);
  const milestones = rules.milestones ?? [];

  return (
    <div className="flex flex-col gap-7">
      <Question label="How do you pay?" id="q-method">
        <ChoiceCards
          label="Pay method"
          value={method}
          onChange={(m) => {
            setMethod(m);
            set({ payRules: rulesForMethod(m === "VIEWS" && !rules.ratePerThousand ? { ...rules, ratePerThousand: suggestedRate(a.currency, per), rateViews: per } : rules, m) });
          }}
          options={PAY_METHODS.map((m) => ({ value: m.value, label: m.label, hint: m.hint }))}
        />
      </Question>

      {draft && (
        <Field label="Currency" className="max-w-48">
          <Select value={a.currency} onChange={(e) => set({ currency: e.target.value })}>
            {[...new Set([a.currency, ...CURRENCIES])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {showViews && (
        <Question label="Pay per views" hint={`Creators earn this for every ${views(per)} their posts make.`} id="q-rate">
          <Segmented label="Views the price is for" value={String(per) as `${(typeof RATE_VIEWS)[number]}`} onChange={(v) => setRules({ rateViews: Number(v) as (typeof RATE_VIEWS)[number] })} options={RATE_VIEWS.map((v) => ({ value: String(v) as `${(typeof RATE_VIEWS)[number]}`, label: short(v) }))} />
          <MoneyInput label={`Price for every ${views(per)}`} currency={a.currency} value={rules.ratePerThousand} onChange={(ratePerThousand) => setRules({ ratePerThousand, rateViews: per })} placeholder={suggestedRate(a.currency, per).toLocaleString("en-US")} invalid={level === "LOW" || level === "TOO_HIGH"} suffix={`per ${short(per)} views`} />
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-4 gap-1" aria-hidden>
              {LEVELS.map((l) => (
                <span key={l} className={cn("rounded-full py-1 text-center text-[12px] font-semibold", level === l ? LEVEL_TONE[l] : "bg-soft text-muted")}>
                  {RATE_LEVEL_LABEL[l]}
                </span>
              ))}
            </div>
            <p className="text-[13px] text-muted" aria-live="polite">
              {level ? `${RATE_LEVEL_LABEL[level]}. ` : ""}At least {money(minRate(a.currency, per))} for every {views(per)}. Creators elsewhere get about this or more.
            </p>
          </div>
        </Question>
      )}

      {showFee && (
        <Field label="Fee for every post handed in" hint="Paid for each post BuPulse can count, whatever its views.">
          <MoneyInput label="Fee per post" currency={a.currency} value={rules.feePerPost} onChange={(feePerPost) => setRules({ feePerPost })} placeholder="2,000" />
        </Field>
      )}

      {showMilestones && (
        <Question label="Milestones" hint="A bonus once, when one post reaches a number of views." id="q-milestones">
          {milestones.map((m, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label="When a post reaches" className="flex-1">
                <MoneyInput label="Views" value={m.views || null} onChange={(v) => setRules({ milestones: milestones.map((x, j) => (j === i ? { ...x, views: v ?? 0 } : x)) })} placeholder="10,000" suffix="views" />
              </Field>
              <Field label="It pays" className="flex-1">
                <MoneyInput label="Bonus" currency={a.currency} value={m.amount || null} onChange={(v) => setRules({ milestones: milestones.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)) })} placeholder="5,000" />
              </Field>
              <button type="button" aria-label={`Remove milestone ${i + 1}`} onClick={() => setRules({ milestones: milestones.filter((_, j) => j !== i) })} className="mb-0.5 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
                <Trash2 aria-hidden className="size-5" />
              </button>
            </div>
          ))}
          {milestones.length < 10 && (
            <Button variant="outline" size="sm" className="self-start" leading={<Plus aria-hidden className="size-4" />} onClick={() => setRules({ milestones: [...milestones, { views: milestones.length ? milestones[milestones.length - 1].views * 5 : 10_000, amount: 0 }] })}>
              Add a milestone
            </Button>
          )}
        </Question>
      )}

      <Question label="Your budget and targets" hint="Each 30-day period. Leave empty for no limit." id="q-budget">
        <Field label="Most you pay in a period, all creators together">
          <MoneyInput label="Budget a month" currency={a.currency} value={a.budget} onChange={(budget) => set({ budget })} placeholder="No limit" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Views that earn, per creator" hint="Views past it do not earn.">
            <MoneyInput label="Views per creator" value={a.viewTargetPerCreator} onChange={(viewTargetPerCreator) => set({ viewTargetPerCreator })} placeholder="No limit" suffix="views" />
          </Field>
          <Field label="Views that earn, all creators" hint="Past it, everyone's views shrink by the same share.">
            <MoneyInput label="Views of the campaign" value={a.viewTargetCampaign} onChange={(viewTargetCampaign) => set({ viewTargetCampaign })} placeholder="No limit" suffix="views" />
          </Field>
        </div>
        <button type="button" aria-expanded={limits} onClick={() => setLimits(!limits)} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start rounded-full px-2 text-[14px] font-medium text-muted hover:text-text">
          <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", limits && "rotate-180")} /> Limits per post and per creator
        </button>
        {limits && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Most one post earns in a period">
              <MoneyInput label="Cap per post" currency={a.currency} value={rules.capPerPost} onChange={(capPerPost) => setRules({ capPerPost })} placeholder="No limit" />
            </Field>
            <Field label="Most one creator earns in a period">
              <MoneyInput label="Cap per creator" currency={a.currency} value={rules.capPerCreator} onChange={(capPerCreator) => setRules({ capPerCreator })} placeholder="No limit" />
            </Field>
          </div>
        )}
      </Question>

      {words.length > 0 && (
        <div className="rounded-2xl bg-soft p-4 text-[14px]">
          <p className="mb-1 font-semibold">Creators will read</p>
          <ul className="list-disc pl-5">
            {words.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <p className="text-[15px] font-semibold">What it could cost you</p>
        <p className="text-[14px] text-muted">If each of your {creators} {creators === 1 ? "creator" : "creators"} gets this many views in a month:</p>
        <Segmented label="Views each" value={String(guess)} onChange={(v) => setGuess(Number(v))} options={VIEW_GUESSES.map((g) => ({ value: String(g), label: short(g) }))} />
        <p className="text-[15px]" aria-live="polite">
          About <strong>{money(estimate.total)}</strong> a month in total, {money(estimate.perCreator)} per creator.
        </p>
        <p className="text-[12px] text-muted">An estimate with your rules, targets and budget. You pay what the posts really earn, every 30 days, by Mobile Money.</p>
      </div>
    </div>
  );
}
