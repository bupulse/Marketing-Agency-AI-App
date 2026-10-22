"use client";

// Creator campaign quick mode (docs/QUIZ_MODE.md, "C. Creator campaign quick mode"): nine quiz cards over the same
// draft as the 12-step wizard. Card 1 makes the draft (createDraftAction: the AI fills every step), each later card
// saves its wizard step(s) with saveStepAction, and "We prepared the rest" opens a detailed step and comes back. The
// detailed wizard ("Detailed setup") is one tap away on every card.
//
// Speed (owner feedback, 22 October 2026): Next moves on at once and the card's steps save in the background, one after
// another, without re-rendering the page. A refused save brings the owner back to its card with the problem. Only Files
// (the folders and their counts) and Ready (the go-live list) wait for the saves and read the draft from the server.

import { ArrowRight, Check, Globe, LoaderCircle, Pencil, Rocket, TriangleAlert, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createDraftAction, finishSetupAction, saveStepAction, setCampaignStatusAction } from "@/app/dashboard/creators/actions";
import { NetworkIcon } from "@/components/connections/network-icon";
import { Chips, Confetti, QuestionHead, QuizFrame, RoundDone, Slider, TextAnswer, Thinking, Tiles, useQuiz, type TileOption } from "@/components/quiz";
import { Button, Chip, Field, GlassCard, Input, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatAmount, payRulesInWords, type Platform } from "@/lib/creators/company-forms";
import { paysAnything } from "@/lib/creators/pay";
import { rateLevel, suggestedRate, type RateLevel } from "@/lib/creators/pay-floor";
import { daysInclusive } from "@/lib/creators/periods";
import {
  budgetPresets,
  cardInputs,
  CARD_DETAILED,
  LENGTH_CHIPS,
  lengthChipOf,
  PLACE_CHIPS,
  PREPARED,
  progressAt,
  QUICK_ROUNDS,
  QUICK_STEPS,
  quickDates,
  rateRange,
  SIZES,
  sizeOf,
  sliderPay,
  START_CHIPS,
  startChipOf,
  withRate,
  withSize,
  type LengthChip,
  type QuickCard,
  type StartChip,
} from "@/lib/creators/quick";
import { NICHES } from "@/lib/creators/requirements";
import { BRIEF_EVERY, CAMPAIGN_GOALS, POST_FORMATS, stepNumber, WIZARD_STEPS, type BriefEvery, type CampaignGoal, type WizardStepId } from "@/lib/creators/wizard";
import { checkStep, costEstimate, ideaExamplesFor, readinessChecklist, stepInput, type StepInput, type WizardAnswers } from "@/lib/creators/wizard-steps";
import { POINTS } from "@/lib/quiz/flow";
import type { Network } from "@/lib/social/types";
import { FilesStep } from "../wizard/files-step";
import { stepLines } from "../wizard/review-step";
import type { WizardOptions } from "../wizard/wizard";

const GOALS: TileOption<CampaignGoal>[] = CAMPAIGN_GOALS.map((g) => ({ value: g.value, label: g.label, hint: g.hint, emoji: { VIEWS: "👀", SALES: "🛍️", VISITS: "📍", FOLLOWERS: "➕", DOWNLOADS: "📲" }[g.value] }));
const CADENCE: TileOption<BriefEvery>[] = BRIEF_EVERY.map((b) => ({ value: b.value, label: b.label, emoji: { MONTH: "1️⃣", WEEK: "📆", DAY: "☀️" }[b.value] }));
const NETWORK_ICONS: readonly string[] = ["instagram", "facebook", "tiktok", "youtube", "linkedin"];
const AUTO_NEXT_MS = 250;
/** The cards that read the draft from the server (folders, counts, the go-live list); the others only change the URL. */
const SERVER_CARDS: readonly QuickCard[] = ["files", "ready"];
const OFFLINE = "We could not save that. Check your connection and try again.";
const VIEWS_EACH = 10_000;

const VERDICT: Record<RateLevel, { text: string; tone: "low" | "ok" | "great" | "high" }> = {
  LOW: { text: "Too low: creators earn more elsewhere", tone: "low" },
  FAIR: { text: "Fair", tone: "ok" },
  GENEROUS: { text: "Generous: creators will love it", tone: "great" },
  TOO_HIGH: { text: "Too high: is that a typing mistake?", tone: "high" },
};

/** A card's answers before they are sent: the slider's suggested price when no pay is set yet. */
function prepare(card: QuickCard, a: WizardAnswers): WizardAnswers {
  if (card === "pay" && !paysAnything(a.payRules)) return { ...a, payRules: withRate(a.payRules, suggestedRate(a.currency, a.payRules.rateViews ?? 1_000)) };
  return a;
}

/** The first problem with a card's answers, in words (the same checks as the server). */
function cardProblem(card: QuickCard, a: WizardAnswers, today: string, savedStart: string): string | null {
  if (card === "idea" && !a.idea.trim() && !a.name.trim()) return "Write one line about the campaign.";
  if (card === "when" && a.startsOn < today && a.startsOn !== savedStart) return "The first day cannot be in the past.";
  for (const { step, input } of cardInputs(card, prepare(card, a))) {
    const r = checkStep(step, input);
    if (!r.ok) return r.error;
  }
  return null;
}

export function QuickCampaign({ card, initial, options: o, detailedHref }: { card: QuickCard; initial: WizardAnswers; options: WizardOptions; detailedHref: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const quiz = useQuiz(QUICK_STEPS, progressAt(card));
  const [a, setA] = useState(initial);
  const [busy, setBusy] = useState<null | "save" | "create" | "live">(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [looksGood, setLooksGood] = useState<WizardStepId[]>([]);
  const [syncing, startSync] = useTransition();
  /** Card saves still running in the background, and the card the server last read the draft for. */
  const [pending, setPending] = useState(0);
  const [loadedFor, setLoadedFor] = useState<QuickCard>(card);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const failed = useRef(false);
  const shown = useRef(card);
  const id = o.campaignId;
  const here = (quiz.step?.id ?? "ready") as QuickCard;

  const set = (patch: Partial<WizardAnswers>) => {
    setError(null);
    setA((cur) => ({ ...cur, ...patch }));
  };

  // The URL follows the card, so a reload or a "Change" return lands here. Files and Ready wait for the saves, then the
  // server reads the draft again; the other cards only change the address (no request).
  useEffect(() => {
    if (!id || shown.current === here) return;
    shown.current = here;
    const url = `/dashboard/creators/${id}/quick?card=${here}`;
    if (!SERVER_CARDS.includes(here)) return window.history.replaceState(null, "", url);
    let gone = false;
    void queue.current.then(() => {
      if (gone) return;
      setLoadedFor(here);
      startSync(() => router.replace(url, { scroll: false }));
    });
    return () => {
      gone = true;
    };
  }, [id, here, router]);

  // Leaving while a card is still saving asks first.
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  async function createDraft() {
    const input = stepInput("idea", a);
    const checked = checkStep("idea", input);
    if (!checked.ok) return setError(checked.error);
    setBusy("create");
    const r = await createDraftAction(input as StepInput<"idea">);
    if (!r.ok) {
      setBusy(null);
      return setError(r.error);
    }
    toast(r.ai ? "Your campaign is drafted. Check each card and change what you like." : "Your draft is ready with our starting ideas.", "success");
    router.push(`/dashboard/creators/${r.id}/quick?card=goal`);
  }

  /**
   * Queues the card's wizard steps to save in the background, after the ones before (the same checks run first, so a
   * refusal is rare: a rate limit, a lost connection). A refused save brings the owner back to that card with the
   * problem. False when the answers do not pass the checks.
   */
  function save(c: QuickCard, answers: WizardAnswers): boolean {
    if (!id) return false;
    const inputs = cardInputs(c, prepare(c, answers));
    for (const { step, input } of inputs) {
      const r = checkStep(step, input);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
    }
    if (c === "pay") setA(prepare(c, answers));
    setPending((n) => n + 1);
    queue.current = queue.current.then(async () => {
      let problem: string | null = null;
      for (const { step, input } of inputs) {
        const r = await saveStepAction(id, step, input, { quiet: true }).catch(() => ({ ok: false as const, error: OFFLINE }));
        if (!r.ok) {
          problem = r.error;
          break;
        }
      }
      setPending((n) => n - 1);
      if (problem) {
        failed.current = true;
        setError(problem);
        quiz.goTo(c);
      }
    });
    return true;
  }

  /** Waits for the background saves; false when one was refused (its card is on screen with the problem). */
  async function flush(): Promise<boolean> {
    failed.current = false;
    await queue.current;
    return !failed.current;
  }

  function next(answers = a) {
    setError(null);
    if (here === "idea" && !id) return void createDraft();
    if (save(here, answers)) quiz.next();
  }

  /**
   * "Change": that step of detailed setup, coming back to this card. A step past the furthest reached is saved first
   * (as the server has it), so the wizard opens it.
   */
  async function change(step: WizardStepId) {
    if (!id) return;
    const n = stepNumber(step);
    setBusy("save");
    if (!(await flush())) return setBusy(null);
    if (n > o.reached) {
      const r = await saveStepAction(id, step, stepInput(step, initial), { quiet: true });
      if (!r.ok) {
        setBusy(null);
        return setError(r.error);
      }
    }
    router.push(`/dashboard/creators/${id}/setup?step=${n}&back=${here}`);
  }

  async function goLive() {
    if (!id) return;
    setBusy("live");
    if (!(await flush())) return setBusy(null);
    const r = await setCampaignStatusAction(id, "LIVE");
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setLive(true);
  }

  async function saveDraft() {
    if (!id) return;
    setBusy("save");
    if (!(await flush())) return setBusy(null);
    const r = await finishSetupAction(id);
    if (!r.ok) {
      setBusy(null);
      return setError(r.error);
    }
    toast("Saved as a draft. It goes live when you say so.", "success");
    router.push(`/dashboard/creators/${id}`);
  }

  if (live && id) return <LiveCelebration name={a.name} href={`/dashboard/creators/${id}`} points={quiz.points + POINTS.answer + POINTS.round} />;

  const problem = here === "ready" ? null : cardProblem(here, a, o.today, initial.startsOn);
  const facts = { products: o.products, knowledgeCampaigns: o.knowledgeCampaigns, counts: o.counts, hasCover: Boolean(a.look.coverAssetId) };
  const checklist = readinessChecklist({ brief: initial.brief, dos: initial.dos, donts: initial.donts, tasks: initial.tasks.length, images: o.counts.images, videos: o.counts.videos, exampleLinks: a.files.exampleLinks.length });
  // The server read the draft for the card on screen (the URL follows the card): its folders and go-live list are current.
  const fresh = card === here && loadedFor === here && !syncing && pending === 0;
  const blockers = o.problems;
  const roundDone = quiz.roundDone ? QUICK_ROUNDS.find((r) => r.id === quiz.roundDone) : null;
  const kicker = `${QUICK_ROUNDS.find((r) => r.id === quiz.round)?.title ?? ""} · ${quiz.stepInRound} of ${quiz.stepsInRound}`;
  const primary =
    busy === "create" || roundDone || quiz.finished
      ? null
      : here === "ready"
        ? { label: "Go live", onClick: () => void goLive(), disabled: !fresh || blockers.length > 0 || busy !== null, busy: busy === "live" }
        : { label: here === "idea" && !id ? "Write my campaign" : "Next", onClick: () => next(), disabled: Boolean(problem) || busy !== null, busy: busy === "save" };
  // Card 1's examples name the products picked ("Film yourself trying our Passion Juice"), else the server's from the first products.
  const pickedNames = o.products.filter((p) => a.productIds.includes(p.id)).map((p) => p.label);
  const examples = pickedNames.length ? ideaExamplesFor(o.industry, pickedNames) : o.ideaExamples;
  const detailed = id ? `${detailedHref}?step=${stepNumber(CARD_DETAILED[here])}` : detailedHref;

  return (
    <QuizFrame rounds={QUICK_ROUNDS} steps={QUICK_STEPS} quiz={quiz} primary={primary} canSkip={here !== "idea" && here !== "ready"} fullForm={{ href: detailed, label: "Open detailed setup" }}>
      {busy === "create" ? (
        <Thinking lines={["Reading your idea…", "Picking the right creators…", "Writing the brief and the tasks…", "Setting a fair pay…"]} />
      ) : roundDone ? (
        <RoundDone round={roundDone} next={QUICK_ROUNDS[QUICK_ROUNDS.indexOf(roundDone) + 1] ?? null} points={quiz.points} saved="Your draft waits in Creator campaigns if you stop here." onContinue={quiz.continueRound} />
      ) : here === "idea" ? (
        <>
          <QuestionHead kicker={kicker} title="What's the campaign about?" hint="One line is enough. BuPulse fills in the rest from it and your Business info." />
          <TextAnswer label="Your idea in one line" value={a.idea} onChange={(idea) => set({ idea })} suggestions={examples} maxLength={300} placeholder="Or write your own" />
          {o.products.length > 0 && <ProductChips options={o.products} selected={a.productIds} onChange={(productIds) => set({ productIds })} />}
        </>
      ) : here === "goal" ? (
        <>
          <QuestionHead kicker={kicker} title="What do you want from it?" hint="Tap one." />
          <Tiles
            label="Goal"
            options={GOALS}
            value={a.goal}
            guess={initial.goal}
            onPick={(goal) => {
              set({ goal });
              window.setTimeout(() => next({ ...a, goal }), AUTO_NEXT_MS);
            }}
          />
        </>
      ) : here === "creators" ? (
        <CreatorsCard a={a} set={set} initial={initial} kicker={kicker} />
      ) : here === "where" ? (
        <WhereCard a={a} set={set} o={o} initial={initial} kicker={kicker} />
      ) : here === "when" ? (
        <WhenCard a={a} set={set} today={o.today} initial={initial} kicker={kicker} />
      ) : here === "pay" ? (
        <PayCard a={a} set={set} o={o} kicker={kicker} onDetailed={() => void change("pay")} />
      ) : here === "prepared" ? (
        <>
          <QuestionHead kicker={kicker} title="We prepared the rest" hint="BuPulse wrote these from your idea. Tap Change to open one in detailed setup." />
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {PREPARED.map((p) => {
              const ok = looksGood.includes(p.step);
              return (
                <li key={p.step} className={cn("flex flex-col gap-2 rounded-2xl border-2 p-3.5", ok ? "border-success/50 bg-success-bg/40" : "border-line bg-surface")}>
                  <p className="flex items-center gap-2 text-[15px] font-semibold">
                    <span aria-hidden>{p.emoji}</span> {p.title}
                  </p>
                  <ul className="flex flex-col gap-0.5 text-[14px] text-muted">
                    {stepLines(p.step, a, facts).map((l, j) => (
                      <li key={j} className={j === 0 ? "text-text" : undefined}>
                        {l}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto flex gap-2">
                    <button
                      type="button"
                      aria-pressed={ok}
                      onClick={() => setLooksGood((list) => (ok ? list.filter((s) => s !== p.step) : [...list, p.step]))}
                      className={cn("inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-semibold", ok ? "bg-success text-white" : "bg-soft text-text")}
                    >
                      {ok && <Check aria-hidden className="size-4" />} Looks good
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => void change(p.step)} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-[14px] font-semibold disabled:opacity-60">
                      <Pencil aria-hidden className="size-4" /> Change
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : here === "files" ? (
        <>
          <QuestionHead kicker={kicker} title="Add your files" hint="The one must-do: your logo and product photos, and an example video or a link to a post you like." />
          {o.folders || fresh ? (
            <FilesStep a={a} set={set} o={o} suggestion={null} suggest={async () => {}} suggesting={false} />
          ) : (
            <p role="status" className="flex items-center gap-2 text-[15px] text-muted">
              <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Making your campaign&apos;s folders…
            </p>
          )}
        </>
      ) : here === "ready" ? (
        <>
          <QuestionHead kicker={kicker} title="Ready to go?" hint="Go live and creators can apply, or keep it as a draft." />
          <div className="flex flex-col gap-3 rounded-3xl border-2 border-pulse-blue/40 bg-surface p-4 sm:p-5">
            <p className="text-[18px] font-semibold">{a.name}</p>
            <dl className="grid gap-2 text-[14px] sm:grid-cols-2">
              {(["goal", "creators", "where", "when", "pay"] as const).map((s) => (
                <div key={s} className="flex flex-col">
                  <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{WIZARD_STEPS[stepNumber(s) - 1].title}</dt>
                  <dd>{stepLines(s, a, facts).slice(0, 2).join(" · ")}</dd>
                </div>
              ))}
            </dl>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[14px]">
                <span aria-hidden className={cn("inline-flex size-5 items-center justify-center rounded-full", c.done ? "bg-success text-white" : "bg-soft")}>{c.done && <Check className="size-3.5" />}</span>
                <span className={c.done ? "" : "text-muted"}>
                  {c.label}
                  <span className="sr-only">{c.done ? ": done" : ": missing"}</span>
                </span>
              </li>
            ))}
          </ul>
          {blockers.length > 0 && fresh && (
            <div role="status" className="flex flex-col gap-1 rounded-2xl bg-danger-bg px-4 py-3 text-[14px] text-danger">
              <p className="flex items-center gap-2 font-semibold">
                <TriangleAlert aria-hidden className="size-4 shrink-0" /> Before it can go live:
              </p>
              <ul className="list-disc pl-6">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          <Button variant="outline" className="self-start" disabled={busy !== null} onClick={() => void saveDraft()}>
            Save as draft
          </Button>
        </>
      ) : null}
      {error && busy !== "create" && !roundDone && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] font-medium text-danger">
          {error}
        </p>
      )}
      {!error && problem && here !== "idea" && !roundDone && <p className="text-[13px] text-muted">{problem}</p>}
    </QuizFrame>
  );
}

type CardProps = { a: WizardAnswers; set: (patch: Partial<WizardAnswers>) => void; kicker: string };

/** Product chips by name (a name used twice gets " (2)"), for the idea card. */
function ProductChips({ options, selected, onChange }: { options: { id: string; label: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const seen = new Map<string, number>();
  const chips = options.map((p) => {
    const n = (seen.get(p.label.toLowerCase()) ?? 0) + 1;
    seen.set(p.label.toLowerCase(), n);
    return { id: p.id, label: n > 1 ? `${p.label} (${n})` : p.label };
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[14px] font-semibold">
        Which products? <span className="font-normal text-muted">Optional</span>
      </p>
      <Chips
        label="Products"
        options={chips.filter((c, i) => i < 24 || selected.includes(c.id)).map((c) => c.label)}
        values={chips.filter((c) => selected.includes(c.id)).map((c) => c.label)}
        onChange={(labels) => onChange(chips.filter((c) => labels.includes(c.label)).map((c) => c.id))}
        max={30}
      />
    </div>
  );
}

function CreatorsCard({ a, set, initial, kicker }: CardProps & { initial: WizardAnswers }) {
  const r = a.requirements;
  const req = (patch: Partial<typeof r>) => set({ requirements: { ...r, ...patch } });
  return (
    <>
      <QuestionHead kicker={kicker} title="Who should post for you?" hint="Creators who don't match can still apply. You see who matches first." />
      <Tiles label="How big" options={SIZES.map((s) => ({ value: s.value, label: s.label, hint: s.hint, emoji: s.emoji }))} value={sizeOf(r.minFollowers)} guess={sizeOf(initial.requirements.minFollowers)} onPick={(size) => set({ requirements: withSize(r, size) })} />
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">
          Where do they live? <span className="font-normal text-muted">None picked: anywhere</span>
        </p>
        <Chips label="Places" options={PLACE_CHIPS} suggested={initial.requirements.locations} values={r.locations} onChange={(locations) => req({ locations })} max={20} addPlaceholder="A district or a town" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">What do they post about?</p>
        <Chips label="Topics" options={NICHES} suggested={initial.requirements.niches} values={r.niches} onChange={(niches) => req({ niches: niches.filter((n) => (NICHES as readonly string[]).includes(n)) })} max={10} />
      </div>
    </>
  );
}

function WhereCard({ a, set, o, initial, kicker }: CardProps & { o: WizardOptions; initial: WizardAnswers }) {
  const label = (v: string) => POST_FORMATS.find((f) => f.value === v)?.label ?? v;
  return (
    <>
      <QuestionHead kicker={kicker} title="Where should they post?" hint="BuPulse counts the views on these." />
      <div role="group" aria-label="Networks" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {o.networks.map((n) => {
          const on = a.platforms.includes(n.network as Platform);
          return (
            <button
              key={n.network}
              type="button"
              aria-pressed={on}
              disabled={n.soon}
              onClick={() => set({ platforms: on ? a.platforms.filter((p) => p !== n.network) : [...a.platforms, n.network as Platform] })}
              className={cn(
                "relative flex min-h-16 cursor-pointer items-center gap-2.5 rounded-2xl border-2 px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed",
                on ? "border-pulse-blue bg-pulse-blue/8" : "border-line bg-surface hover:border-pulse-blue/40",
                n.soon && "opacity-60 hover:border-line",
              )}
            >
              {NETWORK_ICONS.includes(n.network) ? <NetworkIcon network={n.network as Network} className="size-6 shrink-0" /> : <Globe aria-hidden className="size-6 shrink-0 text-muted" />}
              <span className="flex min-w-0 flex-col">
                <span className="text-[14px] font-semibold">{n.label}</span>
                {n.soon && <span className="text-[11px] font-semibold text-muted">Coming soon</span>}
              </span>
              {on && <Check aria-hidden className="absolute right-2.5 top-2.5 size-4 text-pulse-blue" />}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">What kind of posts?</p>
        <Chips
          label="Post types"
          options={POST_FORMATS.map((f) => f.label)}
          suggested={initial.formats.map(label)}
          values={a.formats.map(label)}
          onChange={(labels) => set({ formats: POST_FORMATS.filter((f) => labels.includes(f.label)).map((f) => f.value) })}
        />
      </div>
      {a.mentions.length > 0 && <p className="text-[13px] text-muted">Captions must have {a.mentions.join(" or ")}. Change it in detailed setup.</p>}
    </>
  );
}

/** One choice as a row of chips (several rows fit on one card; tiles would share the number keys). */
function ChoiceRow<T extends string>({ options, value, onPick, label }: { options: readonly { value: T; label: string }[]; value: T; onPick: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((c) => (
        <Chip key={c.value} selected={value === c.value} onClick={() => onPick(c.value)} className="px-4 py-2.5 text-[14px]">
          {c.label}
        </Chip>
      ))}
    </div>
  );
}

function WhenCard({ a, set, today, initial, kicker }: CardProps & { today: string; initial: WizardAnswers }) {
  const [start, setStart] = useState<StartChip>(startChipOf(a.startsOn, today));
  const [length, setLength] = useState<LengthChip>(lengthChipOf(a.startsOn, a.endsOn));
  const apply = (s: StartChip, l: LengthChip, current = { startsOn: a.startsOn, endsOn: a.endsOn }) => set(quickDates(s, l, today, current));
  const days = daysInclusive(a.startsOn, a.endsOn);
  return (
    <>
      <QuestionHead kicker={kicker} title="When does it run?" hint={days >= 1 ? `${days} ${days === 1 ? "day" : "days"}. Creators are paid every 30 days.` : undefined} />
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">First day</p>
        <ChoiceRow
          label="First day"
          options={START_CHIPS}
          value={start}
          onPick={(s) => {
            setStart(s);
            apply(s, length);
          }}
        />
        {start === "PICK" && <Input type="date" aria-label="First day" value={a.startsOn} min={today} onChange={(e) => e.target.value && apply("PICK", length, { startsOn: e.target.value, endsOn: e.target.value > a.endsOn ? e.target.value : a.endsOn })} />}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">How long?</p>
        <ChoiceRow
          label="How long"
          options={LENGTH_CHIPS}
          value={length}
          onPick={(l) => {
            setLength(l);
            apply(start, l);
          }}
        />
        {length === "PICK" && <Input type="date" aria-label="Last day" value={a.endsOn} min={a.startsOn} onChange={(e) => e.target.value && set({ endsOn: e.target.value })} />}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">How often do creators get a new brief?</p>
        <Tiles label="New brief" columns={1} options={CADENCE} value={a.briefEvery ?? "MONTH"} guess={initial.briefEvery} onPick={(briefEvery) => set({ briefEvery })} />
      </div>
    </>
  );
}

function PayCard({ a, set, o, kicker, onDetailed }: CardProps & { o: WizardOptions; onDetailed: () => void }) {
  const rules = a.payRules;
  const per = rules.rateViews ?? 1_000;
  const money = (n: number) => formatAmount(n, a.currency);
  const creators = a.requirements.creatorsWanted ?? Math.min(5, o.creatorsPerCampaign);
  const days = Math.max(1, Math.min(30, daysInclusive(a.startsOn, a.endsOn) || 30));
  const [own, setOwn] = useState(a.budget !== null && !budgetPresets(a.currency).includes(a.budget));
  const presets = budgetPresets(a.currency);
  const slider = sliderPay(rules) || !paysAnything(rules);
  const rate = rules.ratePerThousand ?? suggestedRate(a.currency, per);
  const range = rateRange(a.currency, per, rate);
  const priced = slider ? withRate(rules, rate) : rules;
  const estimate = costEstimate({ rules: priced, creators, viewsEach: VIEWS_EACH, postsEach: a.postsPerDay * days, viewTargetPerCreator: a.viewTargetPerCreator, viewTargetCampaign: a.viewTargetCampaign, budget: a.budget });
  const marks = [
    { value: range.min, label: "Lowest" },
    { value: suggestedRate(a.currency, per), label: "Fair" },
    { value: range.min * 3, label: "Generous" },
  ].filter((m) => m.value <= range.max);
  return (
    <>
      <QuestionHead kicker={kicker} title="How much do creators earn?" hint={`For every ${per.toLocaleString("en-US")} views their posts make. You pay what the posts really earn, every 30 days.`} />
      {slider ? (
        <Slider label={`Price for every ${per.toLocaleString("en-US")} views`} min={range.min} max={range.max} step={range.step} value={rate} onChange={(v) => set({ payRules: withRate(rules, v) })} format={money} verdict={VERDICT[rateLevel(rate, per, a.currency)]} marks={marks} />
      ) : (
        <div className="flex flex-col gap-1 rounded-2xl bg-soft p-4 text-[14px]">
          <p className="font-semibold">Creators will read</p>
          <ul className="list-disc pl-5">
            {payRulesInWords(rules, a.currency).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <button type="button" onClick={onDetailed} className="mt-1 cursor-pointer self-start font-medium underline underline-offset-2">
            Change it in detailed setup
          </button>
        </div>
      )}
      <p className="rounded-2xl border border-line px-4 py-3 text-[14px]" aria-live="polite">
        If each of your {creators} {creators === 1 ? "creator" : "creators"} gets {VIEWS_EACH.toLocaleString("en-US")} views in a month: about <strong>{money(estimate.total)}</strong> in total.
      </p>
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">The most you pay in 30 days, all creators together</p>
        <div role="group" aria-label="Budget" className="flex flex-wrap gap-2">
          <Chip selected={a.budget === null && !own} onClick={() => (setOwn(false), set({ budget: null }))} className="px-4 py-2.5 text-[14px]">
            No limit
          </Chip>
          {presets.map((p) => (
            <Chip key={p} selected={a.budget === p && !own} onClick={() => (setOwn(false), set({ budget: p }))} className="px-4 py-2.5 text-[14px]">
              {money(p)}
            </Chip>
          ))}
          <Chip selected={own} onClick={() => setOwn(true)} className="px-4 py-2.5 text-[14px]">
            Your own
          </Chip>
        </div>
        {own && (
          <Field label={`Budget in ${a.currency}`}>
            <Input inputMode="numeric" value={a.budget ? String(a.budget) : ""} onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d]/g, ""));
              set({ budget: n >= 1 ? Math.min(n, 1_000_000_000) : null });
            }} placeholder={presets[1].toLocaleString("en-US")} />
          </Field>
        )}
      </div>
    </>
  );
}

function LiveCelebration({ name, href, points }: { name: string; href: string; points: number }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <GlassCard strong padding="none" className="relative flex min-h-[440px] flex-col items-center justify-center gap-4 overflow-hidden p-6 text-center sm:p-8">
        <Confetti />
        <Rocket aria-hidden className="size-14 text-pulse-violet" />
        <h2 className="text-[26px] font-semibold tracking-[-0.025em]">{name} is live!</h2>
        <p className="max-w-md text-[15px] text-muted">Creators can apply now. Share your link and pick the ones you like.</p>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-soft px-4 py-2 text-[15px] font-bold tabular-nums">
          <Zap aria-hidden className="size-4 text-pulse-violet" />
          {points} points
        </p>
        <Button size="lg" href={href} trailing={<ArrowRight aria-hidden className="size-4" />}>
          Open your campaign
        </Button>
      </GlassCard>
    </div>
  );
}
