"use client";

import { ArrowRight, Check, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveKnowledge } from "@/app/onboarding/actions";
import { createPersona, updatePersona } from "@/app/dashboard/knowledge/audience/actions";
import { createCompetitor, savePositioning } from "@/app/dashboard/knowledge/competitors/actions";
import { createFaq, savePolicies } from "@/app/dashboard/knowledge/faqs/actions";
import { approveVoice } from "@/app/dashboard/knowledge/interview/actions";
import { createProduct } from "@/app/dashboard/knowledge/products/actions";
import { saveProfile } from "@/app/dashboard/knowledge/profile/actions";
import { draftQuiz, quizScore } from "@/app/dashboard/knowledge/quiz/actions";
import { createReview } from "@/app/dashboard/knowledge/reviews/actions";
import { Chips, GuessTag, KeepOrDrop, QuestionHead, QuizFrame, RoundDone, ScoreRing, TextAnswer, ThisOrThat, Thinking, Tiles, useQuiz, type TileOption } from "@/components/quiz";
import { Button, GlassCard, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { DAY_SHORT, DAYS, dayRanges, timeRange, type DayKey } from "@/lib/business-info/hours";
import { AGE_LABEL, AGE_RANGES, GENDER_LABEL, ONLINE_PLACES, personaLine, type AgeRange, type Gender } from "@/lib/knowledge/audience";
import { PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/lib/knowledge/policies";
import { KIND_LABEL, type ProductKindValue } from "@/lib/knowledge/products";
import { COMMON_LANGUAGES, SIZE_LABEL, type CompanySize } from "@/lib/knowledge/profile";
import type { QuizDraft } from "@/lib/knowledge/quiz-draft";
import {
  hoursChoiceOf,
  ideaPersonaKey,
  initialAnswers,
  itemKey,
  knowledgeInputFrom,
  MAX_QUIZ_PRODUCTS,
  newCompetitorNames,
  newFaqsFrom,
  newProductNames,
  personaOfKey,
  personaSavesFrom,
  policiesFrom,
  positioningFrom,
  productDefaults,
  productInputsFrom,
  productStepId,
  profileInputFrom,
  QUIZ_ROUNDS,
  quizRound,
  quizSteps,
  reviewInputFrom,
  stepForField,
  storedPersonaKey,
  voiceSaveFrom,
  type Given,
  type HoursChoice,
  type QuizAnswers,
  type QuizRoundId,
  type QuizStored,
} from "@/lib/knowledge/quiz-map";
import { REVIEW_SOURCES, SOURCE_LABEL, type ReviewSourceValue } from "@/lib/knowledge/reviews";

// The Business info quiz (docs/QUIZ_MODE.md, "A. Business info quiz"). The page loads what is stored; this asks for
// BuPulse's guesses once (lib/knowledge/quiz-ai.ts, or the template after about 25 seconds), then plays the rounds.
// Each round saves through the section's own actions when it ends (lib/knowledge/quiz-map.ts maps the answers).

type Props = {
  rounds: QuizRoundId[];
  locked: { id: QuizRoundId; title: string; why: "role" | "plan" }[];
  stored: QuizStored;
  fallback: QuizDraft;
  likelyKind: ProductKindValue;
  reasonIdeas: string[];
  currency: string;
  country: string;
  canGrant: boolean;
  startRound: QuizRoundId | null;
  cacheKey: string;
  postsHref: string;
};

const WAIT_MS = 25_000;
const SHOW_SKIP_WAIT_MS = 6_000;
const THINKING = ["Reading your business info…", "Looking at what you sell…", "Picturing your customers…", "Writing ideas in your voice…", "Almost ready…"];

/** A draft kept for this tab, so a reload does not ask the AI again. */
function cachedDraft(key: string): QuizDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    const d = raw ? (JSON.parse(raw) as QuizDraft) : null;
    return d && Array.isArray(d.taglines) && Array.isArray(d.voices) && d.voices.length ? d : null;
  } catch {
    return null;
  }
}

export function BusinessQuiz(props: Props) {
  const [draft, setDraft] = useState<QuizDraft | null>(null);
  const [slow, setSlow] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let done = false;
    const finish = (d: QuizDraft) => {
      if (done) return;
      done = true;
      setDraft(d);
    };
    const cached = cachedDraft(props.cacheKey);
    if (cached) return finish(cached);
    const wait = setTimeout(() => finish(props.fallback), WAIT_MS);
    const hint = setTimeout(() => setSlow(true), SHOW_SKIP_WAIT_MS);
    draftQuiz()
      .then((r) => {
        if (r.ok && r.draft.source === "ai") {
          try {
            sessionStorage.setItem(props.cacheKey, JSON.stringify(r.draft));
          } catch {}
        }
        finish(r.ok ? r.draft : props.fallback);
      })
      .catch(() => finish(props.fallback))
      .finally(() => {
        clearTimeout(wait);
        clearTimeout(hint);
      });
    // No cleanup: a server refresh of the page must not cancel the 25-second fallback; `finish` runs once.
  }, [props.cacheKey, props.fallback]);

  if (!draft) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <GlassCard strong padding="none" className="flex min-h-[440px] flex-col p-5 sm:p-8">
          <Thinking lines={THINKING} />
          {slow && (
            <p className="text-center">
              <button type="button" onClick={() => setDraft(props.fallback)} className="min-h-11 cursor-pointer text-[14px] font-medium text-muted underline underline-offset-2 hover:text-text">
                Don&apos;t wait, start now
              </button>
            </p>
          )}
        </GlassCard>
      </div>
    );
  }
  return <QuizPlay {...props} draft={draft} />;
}

type Saved = { ok: true; line: string } | { ok: false; stepId: string; error: string };

function QuizPlay({ rounds, locked, stored: storedAtStart, draft, likelyKind, reasonIdeas, currency, country, canGrant, startRound, postsHref }: Props & { draft: QuizDraft }) {
  const first = useMemo(() => initialAnswers(storedAtStart, draft, { likelyKind }), [storedAtStart, draft, likelyKind]);
  const [answers, setAnswers] = useState<QuizAnswers>(first.answers);
  const [stored, setStored] = useState<QuizStored>(storedAtStart);
  const [guessed, setGuessed] = useState<Set<string>>(() => new Set(first.guessed));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedLines, setSavedLines] = useState<Partial<Record<QuizRoundId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [savedReviews, setSavedReviews] = useState<string[]>([]);

  // The products asked about are the ones new at the start: once saved they keep their question, so the round keeps
  // its length and the quiz does not jump ahead.
  const startProducts = storedAtStart.products;
  const steps = useMemo(() => quizSteps(rounds, answers, { ...stored, products: startProducts }, { canGrant }), [rounds, answers, stored, startProducts, canGrant]);
  const startIndex = startRound ? Math.max(0, steps.findIndex((s) => s.round === startRound)) : 0;
  const quiz = useQuiz(steps, { index: startIndex });
  const roundList = useMemo(() => QUIZ_ROUNDS.filter((r) => rounds.includes(r.id)), [rounds]);

  // The latest answers and quiz for the tiles' delayed move (a tap moves on 250 ms later).
  const latest = useRef({ answers, stored, quiz });
  useEffect(() => {
    latest.current = { answers, stored, quiz };
  });

  function set<K extends keyof QuizAnswers>(round: K, patch: Partial<QuizAnswers[K]>, stepId?: string) {
    setAnswers((a) => ({ ...a, [round]: { ...a[round], ...patch } }));
    const id = stepId ?? latest.current.quiz.step?.id;
    if (id) {
      setGuessed((g) => {
        if (!g.has(id)) return g;
        const next = new Set(g);
        next.delete(id);
        return next;
      });
      setErrors((e) => {
        if (!(id in e)) return e;
        const next = { ...e };
        delete next[id];
        return next;
      });
    }
  }

  // ---- Saving a round ----------------------------------------------------------------------------------------------

  const fieldError = (round: QuizRoundId, fallback: string, r: { error: string; fieldErrors?: Record<string, string> }): Saved => {
    const [field, message] = Object.entries(r.fieldErrors ?? {})[0] ?? [];
    if (!field) return { ok: false, stepId: fallback, error: r.error };
    // A field the quiz does not ask (the sector, the website…) shows on the round's first question, with the way out.
    const asked = stepForField(round, field, "");
    return { ok: false, stepId: asked || fallback, error: asked ? message! : `${message} You can fix it in the full form (link below).` };
  };

  async function saveRound(round: QuizRoundId, given: Given): Promise<Saved> {
    const a = latest.current.answers;
    const s = latest.current.stored;
    switch (round) {
      case "you": {
        if (!s.profile) return { ok: true, line: "" };
        const input = profileInputFrom(s.profile, a.you, given);
        if (JSON.stringify(input) === JSON.stringify(s.profile)) return { ok: true, line: "Nothing changed: your profile is as it was." };
        const r = await saveProfile(input);
        if (!r.ok) return fieldError("you", "you.tagline", r);
        setStored((x) => ({ ...x, profile: { ...x.profile!, ...input, yearFounded: String(input.yearFounded ?? ""), size: input.size ?? "" } as QuizStored["profile"] }));
        return { ok: true, line: "Your tagline, story, mission and values are saved." };
      }
      case "sell": {
        const items = productInputsFrom(s.products, a.sell, draft.products, currency, given);
        const added: string[] = [];
        for (const { name, input } of items) {
          const r = await createProduct(input);
          if (!r.ok) {
            if (added.length) setStored((x) => ({ ...x, products: [...x.products, ...added] }));
            const [, message] = Object.entries(r.fieldErrors ?? {})[0] ?? [];
            return { ok: false, stepId: productStepId(name), error: message ?? r.error };
          }
          added.push(name);
        }
        if (!added.length) return { ok: true, line: "Nothing new to add this time." };
        setStored((x) => ({ ...x, products: [...x.products, ...added] }));
        return { ok: true, line: `${added.length === 1 ? `${added[0]} is` : `${added.length} products are`} saved as a draft. Add a photo on the Products page to make ${added.length === 1 ? "it" : "them"} ready for posts.` };
      }
      case "customers": {
        const saves = personaSavesFrom(s.personas, draft.personas, a.customers, given);
        const names: string[] = [];
        for (const save of saves) {
          if (save.id) {
            const r = await updatePersona(save.id, save.input);
            if (!r.ok) return fieldError("customers", "customers.pick", r);
            const id = save.id;
            setStored((x) => ({ ...x, personas: x.personas.map((p) => (p.id === id ? { ...p, ...(save.input as typeof p) } : p)) }));
          } else {
            const r = await createPersona(save.input);
            if (!r.ok) return fieldError("customers", "customers.pick", r);
            const persona = { ...(save.input as QuizStored["personas"][number]), id: r.personaId };
            const key = a.customers.picked.find((k) => k.startsWith("idea:") && draft.personas[Number(k.slice(5))]?.name === save.input.name);
            setStored((x) => ({ ...x, personas: [...x.personas, persona] }));
            // Played again, the card is the stored persona now: it is updated, not created twice.
            if (key) setAnswers((x) => ({ ...x, customers: { ...x.customers, picked: x.customers.picked.map((k) => (k === key ? storedPersonaKey(r.personaId) : k)) } }));
          }
          names.push(save.input.name);
        }
        return { ok: true, line: names.length ? `Saved: ${names.join(" and ")}.` : "Nothing new to save." };
      }
      case "why": {
        const names = newCompetitorNames(s.competitors, a.why, given);
        const added: string[] = [];
        for (const name of names) {
          const r = await createCompetitor({ name });
          if (!r.ok) {
            setStored((x) => ({ ...x, competitors: [...x.competitors, ...added] }));
            return fieldError("why", "why.competitors", r);
          }
          added.push(name);
        }
        setStored((x) => ({ ...x, competitors: [...x.competitors, ...added] }));
        const positioning = positioningFrom(s.positioning, a.why, given);
        if (positioning) {
          const r = await savePositioning(positioning);
          if (!r.ok) return fieldError("why", "why.differentiators", r);
          setStored((x) => ({ ...x, positioning: { differentiators: positioning.differentiators ?? [], statement: positioning.statement || null } }));
        }
        if (!added.length && !positioning) return { ok: true, line: "Nothing changed this time." };
        return { ok: true, line: [added.length && `${added.length} competitor${added.length === 1 ? "" : "s"}`, positioning && "what makes you different"].filter(Boolean).join(" and ").replace(/^./, (c) => c.toUpperCase()) + " saved." };
      }
      case "rules": {
        const policies = policiesFrom(s.policies, a.rules, given);
        if (policies) {
          const r = await savePolicies(policies);
          if (!r.ok) return fieldError("rules", "rules.payment", r);
          setStored((x) => ({ ...x, policies }));
        }
        const faqs = newFaqsFrom(s.faqs, a.rules, given);
        const added: string[] = [];
        for (const faq of faqs) {
          const r = await createFaq(faq);
          if (!r.ok) {
            setStored((x) => ({ ...x, faqs: [...x.faqs, ...added] }));
            return { ok: false, stepId: "rules.faqs", error: `“${faq.question}”: ${Object.values(r.fieldErrors ?? {})[0] ?? r.error}` };
          }
          added.push(faq.question);
        }
        setStored((x) => ({ ...x, faqs: [...x.faqs, ...added] }));
        if (!policies && !added.length) return { ok: true, line: "Nothing changed this time." };
        return { ok: true, line: [policies && "Your payment and delivery rules", added.length && `${added.length} common question${added.length === 1 ? "" : "s"}`].filter(Boolean).join(" and ") + " saved. Your chat assistant uses them." };
      }
      case "find": {
        if (!s.brand) return { ok: true, line: "" };
        const input = knowledgeInputFrom(s.brand, a.find, given, country);
        if (!input) return { ok: true, line: "Nothing changed this time." };
        const r = await saveKnowledge(input);
        if (!r.ok) {
          const [field, message] = Object.entries(r.fieldErrors ?? {})[0] ?? [];
          return { ok: false, stepId: field ? stepForField("find", field, "find.hours") : "find.hours", error: message ?? r.error ?? "We could not save that. Please try again." };
        }
        setStored((x) => ({ ...x, brand: { ...x.brand!, openingHours: input.openingHours ?? [], locations: input.locations as NonNullable<QuizStored["brand"]>["locations"], contacts: input.contacts as NonNullable<QuizStored["brand"]>["contacts"] } }));
        return { ok: true, line: "Your opening hours, phone and address are saved. Your chat assistant and your posts use them." };
      }
      case "voice": {
        const save = voiceSaveFrom(s.voice, draft.voices, a.voice, given);
        if (!save) return { ok: true, line: "Nothing changed this time." };
        const r = await approveVoice(save.summary, "quiz", save.answers);
        if (!r.ok) return { ok: false, stepId: "voice.pick", error: Object.values(r.fieldErrors ?? {})[0] ?? r.error };
        setStored((x) => ({ ...x, voice: save.summary, voiceAnswers: save.answers }));
        const label = draft.voices.find((v) => v.id === a.voice.pick)?.label;
        return { ok: true, line: label && a.voice.pick !== "keep" ? `Your posts will now sound ${label.toLowerCase()}.` : "Your brand voice is saved." };
      }
      case "love": {
        const input = reviewInputFrom(a.love, given);
        if (!input || savedReviews.includes(input.quote)) return { ok: true, line: input ? "That review is already saved." : "No review this time. You can add one any time." };
        const r = await createReview(input);
        if (!r.ok) return fieldError("love", "love.quote", r);
        setSavedReviews((x) => [...x, input.quote]);
        return { ok: true, line: `${input.customerName}'s words are saved.${input.canPublish ? " BuPulse may quote them in posts." : ""}` };
      }
    }
  }

  async function move(how: "answer" | "skip") {
    const q = latest.current.quiz;
    const step = q.step;
    if (!step || busy) return;
    if (q.stepInRound === q.stepsInRound) {
      const skipped = new Set(q.progress.skipped);
      if (how === "skip") skipped.add(step.id);
      else skipped.delete(step.id);
      setBusy(true);
      let result: Saved;
      try {
        result = await saveRound(step.round as QuizRoundId, (id) => !skipped.has(id));
      } catch {
        result = { ok: false, stepId: step.id, error: "We could not save that. Check your connection and try again." };
      }
      setBusy(false);
      if (!result.ok) {
        const { stepId, error } = result;
        setErrors((e) => ({ ...e, [stepId]: error }));
        if (stepId !== step.id) q.goTo(stepId);
        return;
      }
      const line = result.line;
      setSavedLines((x) => ({ ...x, [step.round]: line }));
    }
    if (how === "answer") q.next();
    else q.skip();
  }
  const moveRef = useRef(move);
  useEffect(() => {
    moveRef.current = move;
  });
  const tapThenMove = () => setTimeout(() => moveRef.current("answer"), 250);

  // The score, recomputed on the server once the last round is saved.
  useEffect(() => {
    if (!quiz.finished || score !== null) return;
    quizScore()
      .then((r) => setScore(r.ok ? r.percent : 0))
      .catch(() => setScore(0));
  }, [quiz.finished, score]);

  const lockedNote = locked.length > 0 && (
    <p className="flex items-start justify-center gap-1.5 text-center text-[13px] text-muted">
      <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {[
          locked.some((l) => l.why === "role") && `${locked.filter((l) => l.why === "role").map((l) => l.title).join(", ")}: your company's owner or admins fill ${locked.filter((l) => l.why === "role").length === 1 ? "this" : "these"} in.`,
          locked.some((l) => l.why === "plan") && `${locked.filter((l) => l.why === "plan").map((l) => l.title).join(", ")}: not in your plan.`,
        ]
          .filter(Boolean)
          .join(" ")}
      </span>
    </p>
  );

  const frameQuiz = { ...quiz, skip: () => void move("skip") };

  // ---- Finish ------------------------------------------------------------------------------------------------------

  if (quiz.finished) {
    return (
      <div className="flex flex-col gap-4">
        <QuizFrame rounds={roundList} steps={steps} quiz={frameQuiz} primary={null}>
          <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Quiz done · {quiz.points} points</p>
            {score === null ? <Thinking lines={["Adding up your score…"]} /> : <ScoreRing percent={score} label="BuPulse knows your business" />}
            <h2 className="text-[26px] font-semibold tracking-[-0.025em]">BuPulse knows your business {score ?? "…"}%</h2>
            <p className="max-w-md text-[15px] text-muted">Your posts now know your prices, your customers and your voice. The more you add, the more they sound like you.</p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button href={postsHref} size="lg" trailing={<ArrowRight aria-hidden className="size-4" />}>
                Make my first posts
              </Button>
              <Button href="/dashboard/knowledge" size="lg" variant="ghost">
                Back to Business info
              </Button>
            </div>
          </div>
        </QuizFrame>
        {lockedNote}
      </div>
    );
  }

  // ---- Between rounds ----------------------------------------------------------------------------------------------

  if (quiz.roundDone) {
    const i = roundList.findIndex((r) => r.id === quiz.roundDone);
    const nextStep = steps[quiz.index];
    return (
      <div className="flex flex-col gap-4">
        <QuizFrame rounds={roundList} steps={steps} quiz={frameQuiz} primary={null}>
          <RoundDone round={roundList[i]} next={nextStep ? quizRound(nextStep.round as QuizRoundId) : null} points={quiz.points} saved={savedLines[quiz.roundDone as QuizRoundId]} onContinue={quiz.continueRound} />
        </QuizFrame>
        {lockedNote}
      </div>
    );
  }

  const step = quiz.step!;
  const round = quizRound(step.round as QuizRoundId);
  const last = quiz.stepInRound === quiz.stepsInRound;
  const kicker = `${round.emoji} ${round.title} · ${quiz.stepInRound} of ${quiz.stepsInRound}`;
  const guess = guessed.has(step.id);
  const head = (title: string, hint?: string) => (
    <div className="flex flex-col gap-2">
      <QuestionHead kicker={kicker} title={title} hint={hint} />
      {guess && <GuessTag className="w-fit" />}
    </div>
  );

  const body = (
    <Question
      id={step.id}
      head={head}
      answers={answers}
      set={set}
      stored={stored}
      startProducts={startProducts}
      draft={draft}
      likelyKind={likelyKind}
      reasonIdeas={reasonIdeas}
      currency={currency}
      onTap={tapThenMove}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <QuizFrame
        rounds={roundList}
        steps={steps}
        quiz={frameQuiz}
        primary={{ label: last ? "Save" : "Next", onClick: () => void move("answer"), busy }}
        fullForm={{ href: round.href, label: `Open the full ${round.title.toLowerCase()} form` }}
      >
        {body}
        {errors[step.id] && (
          <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] font-medium text-danger">
            {errors[step.id]}
          </p>
        )}
      </QuizFrame>
      {lockedNote}
    </div>
  );
}

// ---- One question ----------------------------------------------------------------------------------------------------

type QuestionProps = {
  id: string;
  head: (title: string, hint?: string) => React.ReactNode;
  answers: QuizAnswers;
  set: <K extends keyof QuizAnswers>(round: K, patch: Partial<QuizAnswers[K]>, stepId?: string) => void;
  stored: QuizStored;
  /** The products stored when the quiz began (each new one has its question). */
  startProducts: string[];
  draft: QuizDraft;
  likelyKind: ProductKindValue;
  reasonIdeas: string[];
  currency: string;
  onTap: () => void;
};

const SIZE_EMOJI: Record<CompanySize, string> = { solo: "🙋", "2-5": "👥", "6-20": "🏢", "21-50": "🏬", "51-200": "🏭", "200+": "🌍" };
const AGE_EMOJI: Record<AgeRange, string> = { any: "🌈", "under-18": "🧒", "18-24": "🎓", "25-34": "💼", "35-44": "👪", "45-54": "🧑‍🦳", "55-64": "👵", "65+": "🧓" };
const GENDER_EMOJI: Record<Gender, string> = { female: "👩", male: "👨", any: "🧑" };
const SOURCE_EMOJI: Record<ReviewSourceValue, string> = { GOOGLE: "🔎", WHATSAPP: "💬", IN_PERSON: "🤝", FACEBOOK: "📘", INSTAGRAM: "📸", EMAIL: "✉️", OTHER: "✨" };
const KIND_EMOJI: Record<ProductKindValue, string> = { PHYSICAL: "📦", DIGITAL: "💻", SERVICE: "🛠️" };
const HOURS_LABEL: Record<Exclude<HoursChoice, "keep" | "custom">, { label: string; hint: string; emoji: string }> = {
  weekdays: { label: "Mon–Fri, 8 am to 6 pm", hint: "Closed at the weekend", emoji: "🗓️" },
  monSat: { label: "Mon–Sat, 8 am to 8 pm", hint: "Closed on Sunday", emoji: "🛍️" },
  everyday: { label: "Every day, 8 am to 8 pm", hint: "Open 7 days", emoji: "☀️" },
  always: { label: "Open 24/7", hint: "Day and night", emoji: "🌙" },
};

function Question({ id, head, answers: a, set, stored, startProducts, draft, likelyKind, reasonIdeas, currency, onTap }: QuestionProps) {
  if (id.startsWith("sell.item.")) {
    const name = newProductNames(startProducts, a.sell.picked).find((n) => productStepId(n) === id) ?? "";
    return <ProductQuestion name={name} head={head} a={a} set={set} draft={draft} likelyKind={likelyKind} reasonIdeas={reasonIdeas} currency={currency} />;
  }
  switch (id) {
    // 🏠 You
    case "you.tagline":
      return (
        <>
          {head("Which tagline fits you best?", "A short line people remember. Tap one or write your own.")}
          <TextAnswer label="Tagline" value={a.you.tagline} onChange={(tagline) => set("you", { tagline })} suggestions={draft.taglines} maxLength={120} />
        </>
      );
    case "you.about":
      return (
        <>
          {head("Is this what you do?", "Change any word. Your posts start from this.")}
          <TextAnswer label="What you do" value={a.you.about} onChange={(about) => set("you", { about })} suggestions={draft.about && draft.about !== a.you.about ? [draft.about] : []} maxLength={3000} multiline />
        </>
      );
    case "you.size": {
      const options: TileOption<CompanySize>[] = (Object.keys(SIZE_LABEL) as CompanySize[]).map((v) => ({ value: v, label: SIZE_LABEL[v], emoji: SIZE_EMOJI[v] }));
      return (
        <>
          {head("How big is your team?")}
          <Tiles
            label="Team size"
            options={options}
            value={a.you.size || null}
            onPick={(size) => {
              set("you", { size });
              onTap();
            }}
            columns={2}
          />
        </>
      );
    }
    case "you.year":
      return (
        <>
          {head("When did you start?", "The year is enough. Skip it if you're not sure.")}
          <Input aria-label="Year founded" inputMode="numeric" maxLength={4} placeholder="e.g. 2019" value={a.you.yearFounded} onChange={(e) => set("you", { yearFounded: e.target.value.replace(/\D/g, "").slice(0, 4) })} className="text-center text-[28px] font-bold tabular-nums" />
        </>
      );
    case "you.languages":
      return (
        <>
          {head("Which languages do you talk to customers in?", "Pick all that apply.")}
          <Chips label="Languages" options={COMMON_LANGUAGES} suggested={draft.languages} values={a.you.languages} onChange={(languages) => set("you", { languages })} max={10} addPlaceholder="Another language" addMax={40} />
        </>
      );
    case "you.values":
      return (
        <>
          {head("What do you stand for?", "Pick up to 8 values.")}
          <Chips label="Values" options={[]} suggested={draft.values} values={a.you.values} onChange={(values) => set("you", { values })} max={8} addPlaceholder="Your own value" addMax={60} />
        </>
      );
    case "you.mission":
      return (
        <>
          {head("Which mission sounds like you?", "Why your business exists, in one sentence.")}
          <TextAnswer label="Mission" value={a.you.mission} onChange={(mission) => set("you", { mission })} suggestions={draft.missions} maxLength={500} multiline />
        </>
      );

    // 🛍️ What you sell
    case "sell.pick": {
      const ideas = draft.products.filter((i) => !stored.products.some((n) => itemKey(n) === itemKey(i.name))).map((i) => i.name);
      const room = MAX_QUIZ_PRODUCTS;
      return (
        <>
          {head("Which of these do you sell?", stored.products.length ? `Already in Business info: ${stored.products.slice(0, 4).join(", ")}${stored.products.length > 4 ? ` and ${stored.products.length - 4} more` : ""}. Add what's missing.` : "Tap what you sell, or add your own.")}
          <Chips
            label="Products and services"
            options={[]}
            suggested={ideas}
            values={a.sell.picked}
            max={room}
            addPlaceholder="A product or service"
            addMax={80}
            onChange={(picked) => {
              const details = { ...a.sell.details };
              for (const n of picked) if (!details[itemKey(n)]) details[itemKey(n)] = productDefaults(n, draft.products, likelyKind);
              set("sell", { picked, details });
            }}
          />
        </>
      );
    }

    // 👥 Your customers
    case "customers.pick":
      return <PersonaCards head={head} a={a} set={set} stored={stored} draft={draft} />;
    case "customers.age": {
      const options: TileOption<AgeRange>[] = AGE_RANGES.map((v) => ({ value: v, label: AGE_LABEL[v], emoji: AGE_EMOJI[v] }));
      return (
        <>
          {head("How old are they, mostly?")}
          <Tiles
            label="Age"
            options={options}
            value={a.customers.ageRange || null}
            onPick={(ageRange) => {
              set("customers", { ageRange });
              onTap();
            }}
            columns={3}
          />
        </>
      );
    }
    case "customers.gender":
      return (
        <>
          {head("Mostly women, men, or anyone?")}
          <Tiles
            label="Gender"
            options={(["female", "male", "any"] as Gender[]).map((v) => ({ value: v, label: GENDER_LABEL[v], emoji: GENDER_EMOJI[v] }))}
            value={a.customers.gender || null}
            onPick={(gender) => {
              set("customers", { gender });
              onTap();
            }}
            columns={3}
          />
        </>
      );
    case "customers.online":
      return (
        <>
          {head("Where do they spend time online?", "Pick all that apply.")}
          <Chips label="Online places" options={ONLINE_PLACES} suggested={personaIdeasFor(draft, "channels")} values={a.customers.channels} onChange={(channels) => set("customers", { channels })} max={8} addPlaceholder="Another place" addMax={160} />
        </>
      );
    case "customers.needs":
      return (
        <>
          {head("What do they need from you?")}
          <Chips label="Needs" options={[]} suggested={personaIdeasFor(draft, "needs")} values={a.customers.needs} onChange={(needs) => set("customers", { needs })} max={8} addPlaceholder="Something they need" addMax={160} />
        </>
      );
    case "customers.pains":
      return (
        <>
          {head("What bugs them?", "What frustrates them about other places.")}
          <Chips label="Frustrations" options={[]} suggested={personaIdeasFor(draft, "pains")} values={a.customers.pains} onChange={(pains) => set("customers", { pains })} max={8} addPlaceholder="Something that bugs them" addMax={160} />
        </>
      );
    case "customers.triggers":
      return (
        <>
          {head("What makes them buy?")}
          <Chips label="Buying triggers" options={[]} suggested={personaIdeasFor(draft, "triggers")} values={a.customers.triggers} onChange={(triggers) => set("customers", { triggers })} max={8} addPlaceholder="What makes them buy" addMax={160} />
        </>
      );

    // ⭐ Why you
    case "why.competitors":
      return (
        <>
          {head("Who else do customers consider?", stored.competitors.length ? `Already saved: ${stored.competitors.slice(0, 4).join(", ")}. Add others, or skip.` : "Kinds of places or names. Add your own.")}
          <Chips label="Competitors" options={[]} suggested={draft.competitors.filter((c) => !stored.competitors.some((x) => itemKey(x) === itemKey(c)))} values={a.why.competitors} onChange={(competitors) => set("why", { competitors })} max={8} addPlaceholder="A competitor's name" addMax={120} />
        </>
      );
    case "why.differentiators":
      return (
        <>
          {head("Why do people choose you?", "Pick what's true. Your posts lead with these.")}
          <Chips label="What makes you different" options={stored.positioning.differentiators} suggested={draft.differentiators} values={a.why.differentiators} onChange={(differentiators) => set("why", { differentiators })} max={10} addPlaceholder="Your own reason" addMax={160} />
        </>
      );
    case "why.statement":
      return (
        <>
          {head("Which sentence sums you up?")}
          <TextAnswer label="Positioning statement" value={a.why.statement} onChange={(statement) => set("why", { statement })} suggestions={draft.positioning} maxLength={600} multiline />
        </>
      );

    // 📋 Rules
    case "rules.payment": {
      const label = (m: PaymentMethod) => PAYMENT_LABEL[m];
      const byLabel = new Map(PAYMENT_METHODS.map((m) => [label(m), m]));
      return (
        <>
          {head("How do people pay you?", "Pick all that apply.")}
          <Chips label="Payment methods" options={PAYMENT_METHODS.map(label)} suggested={draft.policies.payment.map(label)} values={a.rules.payment.map(label)} onChange={(values) => set("rules", { payment: values.flatMap((v) => (byLabel.has(v) ? [byLabel.get(v)!] : [])) })} />
        </>
      );
    }
    case "rules.delivery":
      return (
        <>
          {head("Do you deliver?", "Tap the closest answer, then add your details (areas, cost, how long).")}
          <TextAnswer label="Delivery" value={a.rules.delivery} onChange={(delivery) => set("rules", { delivery })} suggestions={draft.policies.delivery} maxLength={1000} multiline />
        </>
      );
    case "rules.returns":
      return (
        <>
          {head("What about returns and refunds?")}
          <TextAnswer label="Returns and refunds" value={a.rules.returns} onChange={(returns) => set("rules", { returns })} suggestions={draft.policies.returns} maxLength={1000} multiline />
        </>
      );
    case "rules.booking":
      return (
        <>
          {head("How do people book?")}
          <TextAnswer label="Booking" value={a.rules.booking} onChange={(booking) => set("rules", { booking })} suggestions={draft.policies.booking} maxLength={1000} multiline />
        </>
      );
    case "rules.faqs":
      return (
        <>
          {head("Questions customers often ask", "Keep the ones you hear, and change the answers to yours. Your chat assistant answers with them.")}
          <KeepOrDrop
            label="Common questions"
            items={a.rules.faqs.map((f) => ({ id: f.id, text: f.question, sub: f.answer }))}
            kept={a.rules.faqKept}
            withSub
            maxLength={200}
            subMaxLength={1000}
            addLabel="Add a question"
            onChange={(faqKept) => set("rules", { faqKept })}
            onEdit={(fid, patch) => set("rules", { faqs: a.rules.faqs.map((f) => (f.id === fid ? { ...f, question: patch.text, answer: patch.sub ?? f.answer } : f)) })}
            onAdd={(item) => {
              const fid = `own-${Date.now()}`;
              set("rules", { faqs: [...a.rules.faqs, { id: fid, question: item.text, answer: item.sub ?? "" }], faqKept: [...a.rules.faqKept, fid] });
            }}
          />
        </>
      );

    // 📍 Find us
    case "find.hours":
      return <HoursQuestion head={head} a={a} set={set} stored={stored} onTap={onTap} />;
    case "find.phone":
      return (
        <>
          {head("Your phone or WhatsApp number", "Customers tap it to call or chat with you.")}
          <TextAnswer label="Phone or WhatsApp" value={a.find.phone} onChange={(phone) => set("find", { phone })} inputMode="tel" placeholder="e.g. 0788 000 000" maxLength={30} />
        </>
      );
    case "find.address":
      return (
        <>
          {head("Where are you?", "Your street or building, the area and the city.")}
          <TextAnswer label="Address" value={a.find.address} onChange={(address) => set("find", { address })} placeholder="e.g. KN 4 Ave, Kiyovu, Kigali" maxLength={300} />
        </>
      );

    // 🎙️ Your voice
    case "voice.tone":
      return (
        <>
          {head("How should your posts sound?")}
          <ThisOrThat
            label="Friendly or formal"
            left={{ value: "friendly", label: "Friendly", hint: "Like talking to a friend", emoji: "😊" }}
            right={{ value: "formal", label: "Formal", hint: "Polite and professional", emoji: "🎩" }}
            value={a.voice.tone || null}
            onPick={(tone) => {
              const match = tone === "formal" ? draft.voices[1]?.id : draft.voices[0]?.id;
              set("voice", { tone, ...(!stored.voice && match ? { pick: match } : {}) });
              onTap();
            }}
          />
        </>
      );
    case "voice.emojis":
      return (
        <>
          {head("Emojis in your posts?")}
          <ThisOrThat
            label="Emojis"
            left={{ value: "yes", label: "Yes, a few", hint: "One or two per post", emoji: "🎉" }}
            right={{ value: "no", label: "No emojis", hint: "Words only", emoji: "🚫" }}
            value={a.voice.emojis || null}
            onPick={(emojis) => {
              set("voice", { emojis });
              onTap();
            }}
          />
        </>
      );
    case "voice.length":
      return (
        <>
          {head("Short or detailed?")}
          <ThisOrThat
            label="Post length"
            left={{ value: "short", label: "Short", hint: "Two or three lines", emoji: "✂️" }}
            right={{ value: "detailed", label: "Detailed", hint: "All the details", emoji: "📝" }}
            value={a.voice.length || null}
            onPick={(length) => {
              set("voice", { length });
              onTap();
            }}
          />
        </>
      );
    case "voice.pick":
      return <VoicePick head={head} a={a} set={set} stored={stored} draft={draft} />;

    // 💬 Love notes
    case "love.quote":
      return (
        <>
          {head("Got a nice message from a customer?", "Paste it here, word for word. No message yet? Skip this.")}
          <Textarea aria-label="What the customer said" rows={4} maxLength={1000} placeholder="“Best service in town, thank you!”" value={a.love.quote} onChange={(e) => set("love", { quote: e.target.value })} />
          {a.love.quote.trim() && <Input aria-label="Customer's name or initials" maxLength={80} placeholder="Their name or initials, e.g. Aline K." value={a.love.customerName} onChange={(e) => set("love", { customerName: e.target.value })} />}
        </>
      );
    case "love.source": {
      const options: TileOption<ReviewSourceValue>[] = REVIEW_SOURCES.map((v) => ({ value: v, label: SOURCE_LABEL[v], emoji: SOURCE_EMOJI[v] }));
      return (
        <>
          {head("Where did it come from?")}
          <Tiles
            label="Where it came from"
            options={options}
            value={a.love.source || null}
            onPick={(source) => {
              set("love", { source });
              onTap();
            }}
            columns={3}
          />
        </>
      );
    }
    case "love.consent":
      return (
        <>
          {head("Did they agree to be quoted?", "BuPulse quotes a review in public posts only when they agreed.")}
          <ThisOrThat
            label="Agreed to be quoted"
            left={{ value: "yes", label: "Yes, they agreed", emoji: "👍" }}
            right={{ value: "no", label: "Not asked yet", emoji: "🤔" }}
            value={a.love.canPublish ? "yes" : "no"}
            onPick={(v) => {
              set("love", { canPublish: v === "yes" });
              onTap();
            }}
          />
        </>
      );
  }
  return null;
}

/** Every idea from the AI's personas for one list, the main card's first. */
function personaIdeasFor(draft: QuizDraft, key: "channels" | "needs" | "pains" | "triggers"): string[] {
  const out: string[] = [];
  for (const p of draft.personas) for (const v of p[key]) if (!out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  return out.slice(0, 10);
}

function ProductQuestion({ name, head, a, set, draft, likelyKind, reasonIdeas, currency }: { name: string; head: QuestionProps["head"]; a: QuizAnswers; set: QuestionProps["set"]; draft: QuizDraft; likelyKind: ProductKindValue; reasonIdeas: string[]; currency: string }) {
  const key = itemKey(name);
  const d = a.sell.details[key] ?? productDefaults(name, draft.products, likelyKind);
  const patch = (p: Partial<typeof d>) => set("sell", { details: { ...a.sell.details, [key]: { ...d, ...p } } });
  const idea = draft.products.find((i) => itemKey(i.name) === key);
  const ideas = [...(idea?.reasons ?? []), ...reasonIdeas].filter((r, i, all) => all.findIndex((x) => x.toLowerCase() === r.toLowerCase()) === i).slice(0, 4);
  return (
    <>
      {head(`Tell us about ${name}`, "What it is, its price and why people buy it.")}
      <Tiles label="What kind is it?" options={(["PHYSICAL", "SERVICE", "DIGITAL"] as ProductKindValue[]).map((v) => ({ value: v, label: KIND_LABEL[v], emoji: KIND_EMOJI[v] }))} value={d.kind} onPick={(kind) => patch({ kind })} columns={3} />
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">Price</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Input aria-label={`Price in ${currency}`} inputMode="decimal" placeholder="e.g. 15000" maxLength={20} value={d.onRequest ? "" : d.price} disabled={d.onRequest} onChange={(e) => patch({ price: e.target.value, onRequest: false })} className="pr-16" />
            <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-muted">
              {currency}
            </span>
          </div>
          <button
            type="button"
            aria-pressed={d.onRequest}
            onClick={() => patch({ onRequest: !d.onRequest })}
            className={cn("inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-[14px] font-medium", d.onRequest ? "border-transparent bg-brand-gradient text-white" : "border-line bg-surface")}
          >
            {d.onRequest && <Check aria-hidden className="size-3.5" />}
            Ask for price
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">Best reason to buy it</p>
        <TextAnswer label="Best reason to buy it" value={d.reason} onChange={(reason) => patch({ reason })} suggestions={ideas} maxLength={160} />
      </div>
    </>
  );
}

function PersonaCards({ head, a, set, stored, draft }: { head: QuestionProps["head"]; a: QuizAnswers; set: QuestionProps["set"]; stored: QuizStored; draft: QuizDraft }) {
  const cards = [
    ...stored.personas.map((p) => ({ key: storedPersonaKey(p.id), name: p.name, line: personaLine({ ...p, occupation: p.occupation || null, gender: p.gender || null, incomeBand: p.incomeBand || null, language: p.language || null }), saved: true })),
    ...draft.personas
      .map((p, i) => ({ key: ideaPersonaKey(i), name: p.name, line: personaLine({ ...p, incomeBand: null, objections: [], language: null }), saved: false }))
      .filter((c) => !stored.personas.some((p) => itemKey(p.name) === itemKey(c.name))),
  ];
  const picked = a.customers.picked;
  function toggle(key: string) {
    const next = picked.includes(key) ? picked.filter((k) => k !== key) : picked.length >= 2 ? [picked[0], key] : [...picked, key];
    const focus = next[0] && next[0] !== picked[0] ? personaOfKey(next[0], stored.personas, draft.personas) : null;
    set("customers", {
      picked: next,
      ...(focus ? { ageRange: (focus.ageRange || "") as AgeRange | "", gender: (focus.gender || "") as Gender | "", channels: focus.channels, needs: focus.needs, pains: focus.pains, triggers: focus.triggers } : {}),
    });
  }
  return (
    <>
      {head("Who buys from you most?", "Pick one or two. The next questions are about the first one.")}
      <div role="group" aria-label="Customer personas" className="grid gap-2.5">
        {cards.map((c) => {
          const on = picked.includes(c.key);
          const n = picked.indexOf(c.key) + 1;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c.key)}
              className={cn("flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition-[border-color,background-color] duration-200", on ? "border-pulse-blue bg-pulse-blue/8" : "border-line bg-surface hover:border-pulse-blue/40")}
            >
              <span aria-hidden className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold", on ? "bg-brand-gradient text-white" : "bg-soft text-2xl")}>
                {on ? n : "👤"}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold">
                  {c.name}
                  {c.saved && <span className="rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success">Saved</span>}
                </span>
                {c.line && <span className="text-[13px] text-muted">{c.line}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function HoursQuestion({ head, a, set, stored, onTap }: { head: QuestionProps["head"]; a: QuizAnswers; set: QuestionProps["set"]; stored: QuizStored; onTap: () => void }) {
  const saved = stored.brand?.openingHours ?? [];
  const options: TileOption<HoursChoice>[] = [
    ...(a.find.hours === "keep" || hoursChoiceOf(saved) === "keep"
      ? [{ value: "keep" as const, label: "Keep my hours", hint: saved.map((s) => `${dayRanges(s.days)} ${timeRange(s)}`).join(" · "), emoji: "✅" }]
      : []),
    ...(Object.keys(HOURS_LABEL) as (keyof typeof HOURS_LABEL)[]).map((v) => ({ value: v, ...HOURS_LABEL[v] })),
    { value: "custom", label: "Something else", hint: "Pick the days and times", emoji: "✏️" },
  ];
  const c = a.find.custom;
  const patch = (p: Partial<typeof c>) => set("find", { hours: "custom", custom: { ...c, ...p, allDay: false } });
  return (
    <>
      {head("When are you open?")}
      <Tiles
        label="Opening hours"
        options={options}
        value={a.find.hours || null}
        onPick={(hours) => {
          set("find", { hours });
          if (hours !== "custom") onTap();
        }}
        columns={2}
      />
      {a.find.hours === "custom" && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-line p-3.5">
          <div role="group" aria-label="Days open" className="flex flex-wrap gap-1.5">
            {DAYS.map((d: DayKey) => {
              const on = c.days.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => patch({ days: on ? c.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || c.days.includes(x)) })} className={cn("min-h-11 min-w-12 cursor-pointer rounded-full border px-3 text-[14px] font-semibold", on ? "border-transparent bg-brand-gradient text-white" : "border-line bg-surface")}>
                  {DAY_SHORT[d]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Input type="time" aria-label="Opens at" value={c.open} onChange={(e) => patch({ open: e.target.value })} />
            <span className="text-muted">to</span>
            <Input type="time" aria-label="Closes at" value={c.close} onChange={(e) => patch({ close: e.target.value })} />
          </div>
        </div>
      )}
    </>
  );
}

function VoicePick({ head, a, set, stored, draft }: { head: QuestionProps["head"]; a: QuizAnswers; set: QuestionProps["set"]; stored: QuizStored; draft: QuizDraft }) {
  const options = [
    ...(stored.voice ? [{ id: "keep", label: "My voice now", emoji: "✅", sample: stored.voice.samples[0] ?? stored.voice.voice }] : []),
    ...draft.voices.map((v) => ({ id: v.id, label: v.label, emoji: v.emoji, sample: v.sample })),
  ];
  return (
    <>
      {head("Which post sounds like you?", "Tap the one you'd post yourself.")}
      <div role="radiogroup" aria-label="Sample posts" className="grid gap-2.5">
        {options.map((o) => {
          const on = a.voice.pick === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set("voice", { pick: o.id })}
              className={cn("flex cursor-pointer flex-col gap-2 rounded-2xl border-2 p-4 text-left transition-[border-color,background-color] duration-200", on ? "border-pulse-blue bg-pulse-blue/8" : "border-line bg-surface hover:border-pulse-blue/40")}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
                <span aria-hidden>{o.emoji}</span>
                {o.label}
                {on && <Check aria-hidden className="ml-auto size-4 text-pulse-blue" />}
              </span>
              <span className="whitespace-pre-line text-[15px] leading-relaxed">{o.sample}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
