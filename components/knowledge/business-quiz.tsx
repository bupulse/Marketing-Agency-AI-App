"use client";

import { ArrowRight, Camera, Check, ImagePlus, Images, Lock, Palette, Plus, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { draftQuiz, quizLogoFromGallery, quizScore, saveQuizRound } from "@/app/dashboard/knowledge/quiz/actions";
import { useLogoUpload } from "@/components/brand-profile/use-logo-upload";
import { ImportMenu } from "@/components/media/import-menu";
import { MediaPicker } from "@/components/media/media-picker";
import { GalleryThumb } from "@/components/media/media-thumb";
import { UploadProgress } from "@/components/media/upload-progress";
import { useGalleryUpload } from "@/components/media/use-gallery-upload";
import { useImporter } from "@/components/media/use-importer";
import { Chips, GuessTag, KeepOrDrop, QuestionHead, QuizFrame, RoundDone, ScoreRing, TextAnswer, ThisOrThat, Thinking, Tiles, useQuiz, type TileOption } from "@/components/quiz";
import { Button, GlassCard, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { extractColorsFromFile } from "@/lib/brand/image-colors";
import { LOGO_TYPES, MAX_COLORS } from "@/lib/brand/schemas";
import { UPLOAD_ACCEPT } from "@/lib/media/rules";
import type { MediaItem } from "@/lib/media/service";
import { DAY_SHORT, DAYS, dayRanges, timeRange, type DayKey } from "@/lib/business-info/hours";
import { AGE_LABEL, AGE_RANGES, GENDER_LABEL, ONLINE_PLACES, personaLine, type AgeRange, type Gender } from "@/lib/knowledge/audience";
import { PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/lib/knowledge/policies";
import { KIND_LABEL, MAX_ALBUM_PHOTOS, type ProductKindValue } from "@/lib/knowledge/products";
import { COMMON_LANGUAGES, SIZE_LABEL, type CompanySize } from "@/lib/knowledge/profile";
import type { PolicyKind, QuizDraft } from "@/lib/knowledge/quiz-draft";
import {
  alignFaqs,
  EMPTY_NOTE,
  headAddress,
  hoursChoiceOf,
  lookSaveFrom,
  loveStepId,
  MAX_QUIZ_REVIEWS,
  paletteOptions,
  photosSaveFrom,
  photoStepId,
  photoTargets,
  policyTitle,
  reviewInputsFrom,
  roundForSection,
  type LoveNote,
  type PhotoTarget,
  type QuizPhoto,
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
  policyOptions,
  positioningFrom,
  productDefaults,
  productInputsFrom,
  productStepId,
  profileInputFrom,
  QUIZ_ROUNDS,
  quizRound,
  quizSteps,
  stepForField,
  stepProblem,
  storedPersonaKey,
  voiceSaveFrom,
  type Given,
  type HoursChoice,
  type Places,
  type QuizAnswers,
  type QuizRoundId,
  type QuizStored,
} from "@/lib/knowledge/quiz-map";
import { moveGuard } from "@/lib/knowledge/quiz-move";
import type { ToDo } from "@/lib/knowledge/sections";
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
  /** "We deliver in Kigali / across Rwanda". */
  places: Places;
  canGrant: boolean;
  startRound: QuizRoundId | null;
  cacheKey: string;
  postsHref: string;
};

const SAVING: Record<QuizRoundId, string[]> = {
  you: ["Saving your profile…"],
  sell: ["Saving your products…", "Almost there…"],
  customers: ["Saving your customers…"],
  why: ["Saving what makes you different…"],
  rules: ["Saving your rules and questions…", "Almost there…"],
  find: ["Saving your hours and address…"],
  voice: ["Saving your voice…"],
  love: ["Saving your reviews…"],
  photos: ["Saving your photos…"],
  look: ["Saving your logo and colours…"],
  golive: ["Almost done…"],
};

/** A save's problem, under the question: scrolled into view and focused, so a screen reader reads it too. */
function ErrorNote({ message }: { message: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center" });
    ref.current?.focus({ preventScroll: true });
  }, [message]);
  return (
    <p ref={ref} role="alert" tabIndex={-1} className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] font-medium text-danger outline-none">
      {message}
    </p>
  );
}

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

/** After the Photos round saved, the gallery picks are in the albums too: shown with the uploads, not linked again. */
function mergePhotos(added: Record<string, QuizPhoto[]>, picked: Record<string, QuizPhoto[]>): Record<string, QuizPhoto[]> {
  const out = { ...added };
  for (const [key, list] of Object.entries(picked)) out[key] = [...(out[key] ?? []), ...list.filter((p) => !(out[key] ?? []).some((x) => x.id === p.id))];
  return out;
}

function QuizPlay({ rounds, locked, stored: storedAtStart, draft, likelyKind, reasonIdeas, currency, country, places: where, canGrant, startRound, postsHref }: Props & { draft: QuizDraft }) {
  // The policy tiles that fit this business (a salon is not asked about food returns).
  const places = useMemo(() => ({ ...where, type: draft.businessType }), [where, draft.businessType]);
  // Read once: the page's props refresh after every save (the actions revalidate), the quiz's state must not.
  const [first] = useState(() => initialAnswers(storedAtStart, draft, { likelyKind, reasonIdeas, places: { ...where, type: draft.businessType } }));
  const [answers, setAnswers] = useState<QuizAnswers>(first.answers);
  const [stored, setStored] = useState<QuizStored>(storedAtStart);
  const [guessed, setGuessed] = useState<Set<string>>(() => new Set(first.guessed));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedLines, setSavedLines] = useState<Partial<Record<QuizRoundId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [todo, setTodo] = useState<ToDo[]>([]);
  const router = useRouter();
  const [savedReviews, setSavedReviews] = useState<string[]>([]);

  // 📸 Photos: uploads and imports go straight into the product's album, with the gallery's own upload and Import menu.
  // Each remembers the photo question it was started from, so a late finish lands on the right product.
  const uploadKey = useRef<string | null>(null);
  const importKey = useRef<string | null>(null);
  const addPhotos = useCallback((key: string | null, items: MediaItem[]) => {
    if (!key || !items.length) return;
    setAnswers((a) => ({ ...a, photos: { ...a.photos, added: { ...a.photos.added, [key]: [...(a.photos.added[key] ?? []), ...items.map(toQuizPhoto)] } } }));
  }, []);
  const uploader = useGalleryUpload(useCallback((items: MediaItem[]) => addPhotos(uploadKey.current, items), [addPhotos]));
  const importer = useImporter(useCallback((items: MediaItem[]) => addPhotos(importKey.current, items), [addPhotos]));
  // 🎨 Your look: the brand form's own logo upload.
  const logo = useLogoUpload();
  const [logoBusy, setLogoBusy] = useState(false);
  const mediaBusy = uploader.state.active || importer.state.active || logo.uploading || logoBusy;

  // The products asked about are the ones new at the start, frozen: once saved they keep their question, so the round
  // keeps its length. (Read from the live props, the saved products dropped out after the page refreshed, the steps
  // shrank and the quiz, which keeps its place by number, landed questions further on.)
  const [startProducts] = useState(() => storedAtStart.products);
  const steps = useMemo(() => quizSteps(rounds, answers, { ...stored, products: startProducts }, { canGrant }), [rounds, answers, stored, startProducts, canGrant]);
  const startIndex = startRound ? Math.max(0, steps.findIndex((s) => s.round === startRound)) : 0;
  const quiz = useQuiz(steps, { index: startIndex });
  const roundList = useMemo(() => QUIZ_ROUNDS.filter((r) => rounds.includes(r.id)), [rounds]);

  // The latest answers and quiz for the tiles' delayed move (a tap moves on 250 ms later).
  const latest = useRef({ answers, stored, quiz });
  useEffect(() => {
    latest.current = { answers, stored, quiz };
  });

  function set<K extends Exclude<keyof QuizAnswers, "love">>(round: K, patch: Partial<QuizAnswers[K]>, stepId?: string) {
    setAnswers((a) => ({ ...a, [round]: { ...a[round], ...patch } }));
    touched(stepId ?? latest.current.quiz.step?.id);
  }
  /** One review slot of Love notes. */
  function setNote(i: number, patch: Partial<LoveNote>) {
    setAnswers((a) => ({ ...a, love: a.love.map((n, j) => (j === i ? { ...n, ...patch } : n)) }));
    touched(latest.current.quiz.step?.id);
  }
  /** An answer changed: it is no longer BuPulse's guess, and its error goes. */
  function touched(id: string | undefined) {
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
    // Each round is one request (saveQuizRound): the same schemas and services as the section forms.
    switch (round) {
      case "you": {
        if (!s.profile) return { ok: true, line: "" };
        const input = profileInputFrom(s.profile, a.you, given);
        if (JSON.stringify(input) === JSON.stringify(s.profile)) return { ok: true, line: "Nothing changed: your profile is as it was." };
        const r = await saveQuizRound({ round: "you", profile: input });
        if (!r.ok) return fieldError("you", "you.tagline", r);
        setStored((x) => ({ ...x, profile: { ...x.profile!, ...input, yearFounded: String(input.yearFounded ?? ""), size: input.size ?? "" } as QuizStored["profile"] }));
        return { ok: true, line: "Your tagline, story, mission and values are saved." };
      }
      case "sell": {
        const items = productInputsFrom(s.products, a.sell, draft.products, currency, given);
        if (!items.length) return { ok: true, line: "Nothing new to add this time." };
        const r = await saveQuizRound({ round: "sell", products: items.map((i) => i.input) });
        if (!r.ok) {
          const name = items[r.item ?? 0]?.name ?? items[0].name;
          return { ok: false, stepId: productStepId(name), error: Object.values(r.fieldErrors ?? {})[0] ?? r.error };
        }
        const added = items.map((i) => i.name);
        // The ids: each new product's photo question needs its album.
        const ids = Object.fromEntries((r.products ?? []).map((p) => [itemKey(p.name), p.id]));
        setStored((x) => ({ ...x, products: [...x.products, ...added], productIds: { ...x.productIds, ...ids } }));
        return { ok: true, line: `${added.length === 1 ? `${added[0]} is` : `${added.length} products are`} saved.${rounds.includes("photos") ? ` Next, a photo of ${added.length === 1 ? "it" : "each"}: that makes ${added.length === 1 ? "it" : "them"} ready for posts.` : ""}` };
      }
      case "photos": {
        const targets = photoTargets({ ...s, products: startProducts }, a);
        const save = photosSaveFrom(targets, a.photos, given);
        const count = targets.filter((t) => (a.photos.added[t.key]?.length ?? 0) + (given(photoStepId(t.key)) ? (a.photos.picked[t.key]?.length ?? 0) : 0) > 0).length;
        if (save.links.length || save.activate.length) {
          const r = await saveQuizRound({ round: "photos", ...save });
          if (!r.ok) return { ok: false, stepId: steps.find((x) => x.round === "photos")?.id ?? "photos", error: r.error };
          setAnswers((x) => ({ ...x, photos: { added: mergePhotos(x.photos.added, x.photos.picked), picked: {} } }));
        }
        return { ok: true, line: count ? `${count === 1 ? "1 product has" : `${count} products have`} a photo now: ready for posts.` : "No photos this time. You can add them on the Products page." };
      }
      case "look": {
        if (!s.look) return { ok: true, line: "" };
        const save = lookSaveFrom(s.look, a.look, given);
        if (!save) return { ok: true, line: "Nothing changed this time." };
        const r = await saveQuizRound({ round: "look", ...save });
        if (!r.ok) return fieldError("look", "look.logo", r);
        setStored((x) => ({ ...x, look: { logoPath: save.logoPath, logoUrl: a.look.logoUrl ?? x.look?.logoUrl ?? null, colors: save.brandColors } }));
        return { ok: true, line: "Your logo and colours are saved. Your designs use them." };
      }
      case "golive":
        return { ok: true, line: "" };
      case "customers": {
        const saves = personaSavesFrom(s.personas, draft.personas, a.customers, given);
        if (!saves.length) return { ok: true, line: "Nothing new to save." };
        const r = await saveQuizRound({ round: "customers", personas: saves.map((x) => (x.id ? { id: x.id, input: x.input } : { input: x.input })) });
        if (!r.ok) return fieldError("customers", "customers.pick", r);
        saves.forEach((save, i) => {
          const id = r.ids?.[i];
          if (save.id) {
            setStored((x) => ({ ...x, personas: x.personas.map((p) => (p.id === save.id ? { ...p, ...(save.input as typeof p) } : p)) }));
          } else if (id) {
            const persona = { ...(save.input as QuizStored["personas"][number]), id };
            const key = a.customers.picked.find((k) => k.startsWith("idea:") && draft.personas[Number(k.slice(5))]?.name === save.input.name);
            setStored((x) => ({ ...x, personas: [...x.personas, persona] }));
            // Played again, the card is the stored persona now: it is updated, not created twice.
            if (key) setAnswers((x) => ({ ...x, customers: { ...x.customers, picked: x.customers.picked.map((k) => (k === key ? storedPersonaKey(id) : k)) } }));
          }
        });
        return { ok: true, line: `Saved: ${saves.map((x) => x.input.name).join(" and ")}.` };
      }
      case "why": {
        const names = newCompetitorNames(s.competitors, a.why, given);
        const positioning = positioningFrom(s.positioning, a.why, given);
        if (!names.length && !positioning) return { ok: true, line: "Nothing changed this time." };
        const r = await saveQuizRound({ round: "why", competitors: names, positioning });
        if (!r.ok) return fieldError("why", r.part === "positioning" ? "why.differentiators" : "why.competitors", r);
        setStored((x) => ({
          ...x,
          competitors: [...x.competitors, ...names],
          ...(positioning ? { positioning: { differentiators: positioning.differentiators ?? [], statement: positioning.statement || null } } : {}),
        }));
        return { ok: true, line: [names.length && `${names.length} competitor${names.length === 1 ? "" : "s"}`, positioning && "what makes you different"].filter(Boolean).join(" and ").replace(/^./, (c) => c.toUpperCase()) + " saved." };
      }
      case "rules": {
        const policies = policiesFrom(s.policies, a.rules, given, places);
        const faqs = newFaqsFrom(s.faqs, a.rules, given, { ...places, address: headAddress(s.brand?.locations ?? []) });
        if (!policies && !faqs.length) return { ok: true, line: "Nothing changed this time." };
        const r = await saveQuizRound({ round: "rules", policies, faqs });
        if (!r.ok) {
          if (r.part === "faqs") {
            const faq = faqs[r.item ?? 0];
            return { ok: false, stepId: "rules.faqs", error: `${faq ? `“${faq.question}”: ` : ""}${Object.values(r.fieldErrors ?? {})[0] ?? r.error}` };
          }
          return fieldError("rules", "rules.payment", r);
        }
        setStored((x) => ({ ...x, ...(policies ? { policies } : {}), faqs: [...x.faqs, ...faqs.map((f) => f.question)] }));
        return { ok: true, line: [policies && "Your payment and delivery rules", faqs.length && `${faqs.length} common question${faqs.length === 1 ? "" : "s"}`].filter(Boolean).join(" and ") + " saved. Your chat assistant uses them." };
      }
      case "find": {
        if (!s.brand) return { ok: true, line: "" };
        const input = knowledgeInputFrom(s.brand, a.find, given, country);
        if (!input) return { ok: true, line: "Nothing changed this time." };
        const r = await saveQuizRound({ round: "find", knowledge: input });
        if (!r.ok) {
          const [field, message] = Object.entries(r.fieldErrors ?? {})[0] ?? [];
          return { ok: false, stepId: field ? stepForField("find", field, "find.hours") : "find.hours", error: message ?? r.error };
        }
        setStored((x) => ({ ...x, brand: { ...x.brand!, openingHours: input.openingHours ?? [], locations: input.locations as NonNullable<QuizStored["brand"]>["locations"], contacts: input.contacts as NonNullable<QuizStored["brand"]>["contacts"] } }));
        return { ok: true, line: "Your opening hours, phone and address are saved. Your chat assistant and your posts use them." };
      }
      case "voice": {
        const save = voiceSaveFrom(s.voice, draft.voices, a.voice, given);
        if (!save) return { ok: true, line: "Nothing changed this time." };
        const r = await saveQuizRound({ round: "voice", summary: save.summary, answers: save.answers });
        if (!r.ok) return { ok: false, stepId: "voice.pick", error: Object.values(r.fieldErrors ?? {})[0] ?? r.error };
        setStored((x) => ({ ...x, voice: save.summary, voiceAnswers: save.answers }));
        const label = draft.voices.find((v) => v.id === a.voice.pick)?.label;
        return { ok: true, line: label && a.voice.pick !== "keep" ? `Your posts will now sound ${label.toLowerCase()}.` : "Your brand voice is saved." };
      }
      case "love": {
        const items = reviewInputsFrom(a.love, given).filter((x) => !savedReviews.includes(x.input.quote));
        if (!items.length) return { ok: true, line: reviewInputsFrom(a.love, given).length ? "Those reviews are already saved." : "No review this time. You can add one any time." };
        const r = await saveQuizRound({ round: "love", reviews: items.map((x) => x.input) });
        if (!r.ok) {
          const slot = items[r.item ?? 0]?.slot ?? 0;
          const [field, message] = Object.entries(r.fieldErrors ?? {})[0] ?? [];
          const part = field && /^source/.test(field) ? "source" : field && /^canPublish/.test(field) ? "consent" : "quote";
          return { ok: false, stepId: loveStepId(part, slot), error: message ?? r.error };
        }
        setSavedReviews((x) => [...x, ...items.map((i) => i.input.quote)]);
        const quoted = items.filter((i) => i.input.canPublish).length;
        return { ok: true, line: `${items.length === 1 ? "1 review is" : `${items.length} reviews are`} saved.${quoted ? ` BuPulse may quote ${quoted === 1 ? "it" : quoted === items.length ? "them" : `${quoted} of them`} in posts.` : ""}` };
      }
    }
    return { ok: true, line: "" };
  }

  // Every move names the question it was made for (lib/knowledge/quiz-move.ts): a stale one does nothing.
  const [guard] = useState(moveGuard);
  const onScreen = quiz.step?.id ?? null;
  useEffect(() => guard.seen(onScreen), [guard, onScreen]);

  async function move(how: "answer" | "skip", stepId: string | null | undefined) {
    const q = latest.current.quiz;
    const step = q.step;
    if (!step || !stepId || !guard.begin(stepId, step.id)) return;
    let moved = false;
    try {
      if (how === "answer") {
        const problem = stepProblem(step.id, latest.current.answers, draft.products, currency);
        if (problem) {
          setErrors((e) => ({ ...e, [step.id]: problem }));
          return;
        }
      }
      let now = q;
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
        now = latest.current.quiz;
        if (!result.ok) {
          const { stepId: at, error } = result;
          setErrors((e) => ({ ...e, [at]: error }));
          if (at !== now.step?.id) now.goTo(at);
          return;
        }
        const line = result.line;
        setSavedLines((x) => ({ ...x, [step.round]: line }));
        // The owner may have opened another round while it saved: move on only from the same question.
        if (!guard.stillOn(stepId, now.step?.id ?? null)) return;
      }
      moved = true;
      if (how === "answer") now.next();
      else now.skip();
    } finally {
      guard.end(moved);
    }
  }
  const moveRef = useRef(move);
  useEffect(() => {
    moveRef.current = move;
  });
  // A tap on a tile moves on 250 ms later, for the question it was tapped on only.
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tapTimer.current), []);
  const tapThenMove = () => {
    const id = latest.current.quiz.step?.id;
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => moveRef.current("answer", id), 250);
  };

  // The score, recomputed on the server once the last round is saved.
  useEffect(() => {
    if (!quiz.finished || score !== null) return;
    quizScore()
      .then((r) => {
        setScore(r.ok ? r.percent : 0);
        if (r.ok) setTodo(r.todo);
        // The saves were silent (no revalidation: it re-rendered this slow page inside every save). Once, at the end,
        // in the background: refresh the router so the shared layout and the back/forward cache show the new data.
        router.refresh();
      })
      .catch(() => setScore(0));
  }, [quiz.finished, score, router]);

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

  const frameQuiz = { ...quiz, skip: () => void move("skip", onScreen) };

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
            {todo.length > 0 && (
              <section aria-labelledby="quiz-todo" className="flex w-full max-w-md flex-col gap-2 text-left">
                <h3 id="quiz-todo" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
                  To reach 100%
                </h3>
                <ul className="flex flex-col gap-2">
                  {todo.map((t) => {
                    // Back into the round that fixes it, when the quiz has one (Go live's account needs its own page).
                    const round = t.key === "channels" ? null : roundForSection(t.key, { next: t.label }, rounds);
                    const row = "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 text-left text-[15px] font-medium no-underline hover:border-pulse-blue/40";
                    return (
                      <li key={t.key}>
                        {round ? (
                          <button
                            type="button"
                            onClick={() => {
                              // Finishing again recomputes the score.
                              setScore(null);
                              setTodo([]);
                              quiz.goToRound(round);
                            }}
                            className={row}
                          >
                            <span className="min-w-0 flex-1">{t.label}</span>
                            <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
                          </button>
                        ) : (
                          <Link href={t.href} className={row}>
                            <span className="min-w-0 flex-1">{t.label}</span>
                            <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
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
  const error = errors[step.id];
  // The error sits under the question, at the top of the card (never behind the bottom bar), and is scrolled to.
  const head = (title: string, hint?: string) => (
    <div className="flex flex-col gap-2">
      <QuestionHead kicker={kicker} title={title} hint={hint} />
      {guess && <GuessTag className="w-fit" />}
      {error && <ErrorNote message={error} />}
    </div>
  );

  const body = (
    <Question
      id={step.id}
      head={head}
      answers={answers}
      set={set}
      setNote={setNote}
      media={{
        uploader,
        importer,
        upload: (key, files, destination) => {
          uploadKey.current = key;
          void uploader.start(files, destination);
        },
        importFor: (key) => {
          importKey.current = key;
        },
        logo,
        setLogoBusy,
        busy: mediaBusy,
      }}
      stored={stored}
      places={places}
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
        primary={{ label: step.id === "golive.connect" ? "Finish" : last ? "Save" : "Next", onClick: () => void move("answer", step.id), busy, disabled: mediaBusy }}
        fullForm={{ href: round.href, label: `Open the full ${round.title.toLowerCase()} form` }}
      >
        {busy ? <Thinking lines={SAVING[round.id]} /> : body}
      </QuizFrame>
      {lockedNote}
    </div>
  );
}

// ---- One question ----------------------------------------------------------------------------------------------------

type Media = {
  uploader: ReturnType<typeof useGalleryUpload>;
  importer: ReturnType<typeof useImporter>;
  /** Uploads files into an album, for the photo question `key`. */
  upload: (key: string, files: File[], destination: string) => void;
  /** The Import menu's next imports belong to the photo question `key`. */
  importFor: (key: string) => void;
  logo: ReturnType<typeof useLogoUpload>;
  setLogoBusy: (busy: boolean) => void;
  /** An upload or import is running: the quiz waits for it before moving on. */
  busy: boolean;
};

type QuestionProps = {
  id: string;
  head: (title: string, hint?: string) => React.ReactNode;
  answers: QuizAnswers;
  set: <K extends Exclude<keyof QuizAnswers, "love">>(round: K, patch: Partial<QuizAnswers[K]>, stepId?: string) => void;
  setNote: (i: number, patch: Partial<LoveNote>) => void;
  media: Media;
  stored: QuizStored;
  places: Places;
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

function Question({ id, head, answers: a, set, setNote, media, stored, places, startProducts, draft, likelyKind, reasonIdeas, currency, onTap }: QuestionProps) {
  if (id.startsWith("photos.")) {
    const target = photoTargets({ ...stored, products: startProducts }, a).find((t) => photoStepId(t.key) === id);
    return target ? <PhotoQuestion target={target} head={head} a={a} set={set} media={media} /> : null;
  }
  const slot = /^love\.(quote|source|consent)\.(\d)$/.exec(id);
  if (slot) return <LoveQuestion part={slot[1] as "quote" | "source" | "consent"} i={Number(slot[2])} head={head} a={a} setNote={setNote} onTap={onTap} />;
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
    case "you.vision":
      return (
        <>
          {head("Where do you want to be in a few years?", "Your vision, in one sentence.")}
          <TextAnswer label="Vision" value={a.you.vision} onChange={(vision) => set("you", { vision })} suggestions={draft.visions} maxLength={500} multiline />
        </>
      );
    case "you.website":
      return (
        <>
          {head("Where can people find you online?", "Your website, or your main social page. Skip it if you have neither.")}
          <TextAnswer label="Website or social page" value={a.you.website} onChange={(website) => set("you", { website })} inputMode="url" placeholder="e.g. yourbusiness.rw or instagram.com/yourbusiness" maxLength={200} />
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
              for (const n of picked) if (!details[itemKey(n)]) details[itemKey(n)] = productDefaults(n, draft.products, likelyKind, reasonIdeas);
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
    case "rules.returns":
    case "rules.warranty":
    case "rules.booking": {
      const kind = id.slice(6) as PolicyKind;
      return <PolicyQuestion kind={kind} title={policyTitle(kind, places.type)} head={head} a={a} set={set} places={places} onTap={onTap} />;
    }

    // 🎨 Your look
    case "look.logo":
      return <LogoQuestion head={head} a={a} set={set} media={media} />;
    case "look.colors":
      return <ColorsQuestion head={head} a={a} set={set} stored={stored} draft={draft} />;

    // 🚀 Go live
    case "golive.connect":
      return (
        <>
          {head("Connect Instagram, Facebook and more", "So BuPulse can post for you. Your quiz answers are saved.")}
          {stored.connected ? (
            <p className="flex items-center gap-2 rounded-2xl bg-success-bg px-4 py-3 text-[15px] font-medium text-success">
              <Check aria-hidden className="size-4" />
              You have a connected account. You can add more any time.
            </p>
          ) : (
            <p className="text-[15px] text-muted">It takes a minute: you sign in to your account and allow BuPulse to post. Then come back here or carry on from your dashboard.</p>
          )}
          <Button href="/dashboard/connections" size="lg" variant={stored.connected ? "outline" : "primary"} trailing={<ArrowRight aria-hidden className="size-4" />}>
            {stored.connected ? "See my accounts" : "Connect an account"}
          </Button>
        </>
      );
    case "rules.faqs":
      return (
        <>
          {head("Questions customers often ask", "Keep the ones you hear, and change the answers to yours. Your chat assistant answers with them.")}
          <KeepOrDrop
            label="Common questions"
            items={alignFaqs(a.rules, { ...places, address: headAddress(stored.brand?.locations ?? []) }).map((f) => ({ id: f.id, text: f.question, sub: f.answer }))}
            kept={a.rules.faqKept}
            withSub
            maxLength={200}
            subMaxLength={1000}
            addLabel="Add a question"
            onChange={(faqKept) => set("rules", { faqKept })}
            onEdit={(fid, patch) => set("rules", { faqs: a.rules.faqs.map((f) => (f.id === fid ? { ...f, question: patch.text, answer: patch.sub ?? f.answer } : f)), faqEdited: [...(a.rules.faqEdited ?? []), fid] })}
            onAdd={(item) => {
              const fid = `own-${Date.now()}`;
              set("rules", { faqs: [...a.rules.faqs, { id: fid, question: item.text, answer: item.sub ?? "" }], faqKept: [...a.rules.faqKept, fid], faqEdited: [...(a.rules.faqEdited ?? []), fid] });
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
  const d = a.sell.details[key] ?? productDefaults(name, draft.products, likelyKind, reasonIdeas);
  const priceId = useId();
  // No number typed is "Ask for price"; typing one turns it off. The field is never disabled, so the typing never
  // falls through to the tiles.
  const askForPrice = !d.price.trim();
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
            <Input id={priceId} aria-label={`Price in ${currency}`} inputMode="decimal" placeholder="e.g. 15000" maxLength={20} value={d.price} onChange={(e) => patch({ price: e.target.value, onRequest: !e.target.value.trim() })} className="pr-16" />
            <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-muted">
              {currency}
            </span>
          </div>
          <button
            type="button"
            aria-pressed={askForPrice}
            onClick={() => (askForPrice ? document.getElementById(priceId)?.focus() : patch({ price: "", onRequest: true }))}
            className={cn("inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-[14px] font-medium", askForPrice ? "border-transparent bg-brand-gradient text-white" : "border-line bg-surface")}
          >
            {askForPrice && <Check aria-hidden className="size-3.5" />}
            Ask for price
          </button>
        </div>
        <p className="text-[13px] text-muted">{askForPrice ? "No price shown: customers ask you. Type a number to show it." : `Shown as ${d.price.trim()} ${currency}.`}</p>
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

/** A policy as tiles of common answers (each a policy sentence), and "Something else" for the owner's own words. */
function PolicyQuestion({ kind, title, head, a, set, places, onTap }: { kind: PolicyKind; title: string; head: QuestionProps["head"]; a: QuizAnswers; set: QuestionProps["set"]; places: Places; onTap: () => void }) {
  const answer = a.rules[kind];
  const options = policyOptions(kind, places);
  return (
    <>
      {head(title, "Tap the closest answer. You can change the words on the FAQs & policies page.")}
      <Tiles
        label={title}
        options={options.map((o) => ({ value: o.value, label: o.label, emoji: o.emoji }))}
        value={answer.choice || null}
        onPick={(choice) => {
          set("rules", { [kind]: { ...answer, choice } });
          if (choice !== "other") onTap();
        }}
        columns={2}
      />
      {answer.choice === "other" && (
        <TextAnswer label={`${title} In your own words`} value={answer.text} onChange={(text) => set("rules", { [kind]: { choice: "other", text } })} placeholder="In your own words" maxLength={1000} multiline />
      )}
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

// ---- 📸 Photos ---------------------------------------------------------------------------------------------------------

const toQuizPhoto = (m: Pick<MediaItem, "id" | "url" | "kind" | "posterUrl">): QuizPhoto => ({ id: m.id, url: m.url, kind: m.kind, posterUrl: m.posterUrl });

/**
 * A photo or video of one product, the way its album card adds them (components/knowledge/album-card.tsx): upload from
 * the phone, pick from the gallery (MediaPicker), or the Import menu. Uploads and imports land in the album at once;
 * gallery picks are linked when the round saves.
 */
function PhotoQuestion({ target, head, a, set, media }: { target: PhotoTarget; head: QuestionProps["head"]; a: QuizAnswers; set: QuestionProps["set"]; media: Media }) {
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const { uploader, importer, importFor } = media;
  const shown = [...(a.photos.added[target.key] ?? []), ...(a.photos.picked[target.key] ?? [])];
  const room = Math.max(0, MAX_ALBUM_PHOTOS - shown.length);
  const destination = target.productId ? `product:${target.productId}` : null;
  // The Import menu's imports belong to the product on screen.
  useEffect(() => importFor(target.key), [importFor, target.key]);

  return (
    <>
      {head(`Show us ${target.name}`, "A real photo or a short video makes the best posts. Photos up to 10 MB; videos up to 60 seconds.")}
      {!destination ? (
        <p className="rounded-2xl bg-soft px-4 py-3 text-[15px] text-muted">{target.name} was not saved in What you sell, so it has no album yet. Skip this one, or go back and finish it.</p>
      ) : (
        <>
          <input
            ref={input}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label={`Upload photos or videos of ${target.name}`}
            onChange={(e) => {
              if (e.target.files?.length) media.upload(target.key, Array.from(e.target.files).slice(0, room), destination);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={media.busy || room === 0}
            onClick={() => input.current?.click()}
            className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-pulse-blue/50 bg-pulse-blue/5 px-6 py-6 text-center hover:bg-pulse-blue/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Camera aria-hidden className="size-8 text-pulse-blue" />
            <span className="text-[17px] font-semibold">Upload from your phone</span>
            <span className="text-[13px] text-muted">Photos or videos</span>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={media.busy || room === 0} leading={<Images aria-hidden className="size-4" />} onClick={() => setPicking(true)}>
              From your photos
            </Button>
            <ImportMenu importer={importer} destinations={[{ key: destination, label: target.name, group: "Products" }]} defaultDestination={destination} />
          </div>
          <UploadProgress state={uploader.state} onDismiss={uploader.dismiss} />
          <UploadProgress state={importer.state} onDismiss={importer.dismiss} verb="Importing" />
          {shown.length > 0 && (
            <ul aria-label={`Photos of ${target.name}`} className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {shown.map((p, i) => (
                <li key={p.id} className="aspect-square overflow-hidden rounded-xl bg-soft">
                  <GalleryThumb item={p} alt={`${target.name}, ${p.kind === "video" ? "video" : "photo"} ${i + 1}`} />
                </li>
              ))}
            </ul>
          )}
          <MediaPicker
            open={picking}
            onOpenChange={setPicking}
            multiple
            videos
            saveTo={destination ?? undefined}
            max={Math.max(room, 1)}
            title={`Photos or videos of ${target.name}`}
            confirmLabel={(n) => `Add ${n || ""}`.trim()}
            onPick={(picked) => {
              const have = a.photos.picked[target.key] ?? [];
              const add = picked.filter((p) => !shown.some((x) => x.id === p.id)).map((p) => ({ id: p.id, url: p.url, kind: p.mimeType.startsWith("video/") ? "video" : "photo" }));
              set("photos", { picked: { ...a.photos.picked, [target.key]: [...have, ...add] } });
            }}
          />
        </>
      )}
    </>
  );
}

// ---- 🎨 Your look -------------------------------------------------------------------------------------------------------

/** The colours of a gallery photo, read in the browser like an uploaded logo's (none when it cannot be read). */
async function colorsOf(url: string, type: string): Promise<string[]> {
  try {
    const blob = await (await fetch(url)).blob();
    return await extractColorsFromFile(new File([blob], "logo", { type: blob.type || type }));
  } catch {
    return [];
  }
}

function LogoQuestion({ head, a, set, media }: { head: QuestionProps["head"]; a: QuizAnswers; set: QuestionProps["set"]; media: Media }) {
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const look = a.look;
  // A new logo's colours become the colours, unless the owner already chose their own.
  const withColors = (colors: string[]) => (colors.length && look.palette !== "own" ? { logoColors: colors, colors, palette: "logo" } : { logoColors: colors });

  async function onFile(file: File) {
    setMessage(null);
    const r = await media.logo.upload(file);
    if (!r.ok) return setMessage({ tone: "error", text: r.error });
    set("look", { logoPath: r.path, logoUrl: r.preview, ...withColors(r.colors) });
    setMessage({ tone: "info", text: r.colors.length ? "Logo added. We took your colours from it." : "Logo added." });
  }

  return (
    <>
      {head("Your logo", "It goes on your designs. A square PNG with a clear background works best.")}
      <div className="flex flex-wrap items-center gap-4">
        <div className="glass flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-3xl">
          {look.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- private signed URL or local blob
            <img src={look.logoUrl} alt="Your logo" className="max-h-full max-w-full object-contain p-2" />
          ) : (
            <ImagePlus aria-hidden className="size-8 text-muted" />
          )}
        </div>
        <div className="flex flex-col items-start gap-2">
          <input
            ref={input}
            type="file"
            accept={LOGO_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload your logo"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
          <Button size="lg" disabled={media.busy} leading={<Upload aria-hidden className="size-4" />} onClick={() => input.current?.click()}>
            {media.logo.uploading ? "Uploading…" : look.logoUrl ? "Upload another" : "Upload your logo"}
          </Button>
          <Button variant="outline" size="sm" disabled={media.busy} leading={<Images aria-hidden className="size-4" />} onClick={() => setPicking(true)}>
            From your photos
          </Button>
          <p className="text-[13px] text-muted">PNG, JPG or WebP, up to 5 MB.</p>
        </div>
      </div>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-[14px] font-medium text-danger" : "text-[14px] text-muted"}>
          {message.text}
        </p>
      )}
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        title="Choose your logo"
        onPick={async ([photo]) => {
          if (!photo) return;
          setMessage(null);
          media.setLogoBusy(true);
          try {
            const [r, colors] = await Promise.all([quizLogoFromGallery(photo.id), colorsOf(photo.url, photo.mimeType)]);
            if (!r.ok) return setMessage({ tone: "error", text: r.error });
            set("look", { logoPath: r.path, logoUrl: r.url, ...withColors(colors) });
            setMessage({ tone: "info", text: colors.length ? "Logo added. We took your colours from it." : "Logo added." });
          } finally {
            media.setLogoBusy(false);
          }
        }}
      />
    </>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

function ColorsQuestion({ head, a, set, stored, draft }: { head: QuestionProps["head"]; a: QuizAnswers; set: QuestionProps["set"]; stored: QuizStored; draft: QuizDraft }) {
  const look = a.look;
  const options = paletteOptions(look, stored.look ?? { logoPath: null, logoUrl: null, colors: [] }, draft.palettes);
  const own = look.palette === "own";
  const swatches = (colors: string[]) => (
    <span aria-hidden className="flex gap-1">
      {colors.map((c, i) => (
        <span key={i} className="size-8 rounded-full border border-line" style={{ background: c }} />
      ))}
    </span>
  );
  const setColor = (i: number, value: string) => set("look", { palette: "own", colors: look.colors.map((c, j) => (j === i ? value.toUpperCase() : c)) });
  return (
    <>
      {head("Pick your brand colours", "Your designs use them. Tap a set, or make your own.")}
      <div role="radiogroup" aria-label="Brand colours" className="grid gap-2.5 sm:grid-cols-2">
        {[...options, { id: "own", label: "My own colours", colors: own ? look.colors : [] }].map((o) => {
          const on = look.palette === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set("look", o.id === "own" ? { palette: "own", colors: look.colors.length ? look.colors : ["#2F6BFF"] } : { palette: o.id, colors: o.colors })}
              className={cn("flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 p-3.5 text-left", on ? "border-pulse-blue bg-pulse-blue/8" : "border-line bg-surface hover:border-pulse-blue/40")}
            >
              <span className="text-[15px] font-semibold">{o.label}</span>
              {o.colors.length ? swatches(o.colors) : <Palette aria-hidden className="size-6 text-muted" />}
            </button>
          );
        })}
      </div>
      {own && (
        <div className="flex flex-wrap items-center gap-3">
          {look.colors.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <input type="color" aria-label={`Colour ${i + 1}`} value={HEX.test(c) ? c.toLowerCase() : "#000000"} onChange={(e) => setColor(i, e.target.value)} className="size-11 cursor-pointer rounded-xl border border-line bg-transparent p-1" />
              {look.colors.length > 1 && (
                <button type="button" aria-label={`Remove colour ${i + 1}`} onClick={() => set("look", { colors: look.colors.filter((_, j) => j !== i) })} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft">
                  <X aria-hidden className="size-4" />
                </button>
              )}
            </span>
          ))}
          {look.colors.length < MAX_COLORS && (
            <Button variant="outline" size="sm" leading={<Plus aria-hidden className="size-4" />} onClick={() => set("look", { colors: [...look.colors, "#111827"] })}>
              Add a colour
            </Button>
          )}
        </div>
      )}
    </>
  );
}

// ---- 💬 Love notes ------------------------------------------------------------------------------------------------------

function LoveQuestion({ part, i, head, a, setNote, onTap }: { part: "quote" | "source" | "consent"; i: number; head: QuestionProps["head"]; a: QuizAnswers; setNote: QuestionProps["setNote"]; onTap: () => void }) {
  const note = a.love[i] ?? EMPTY_NOTE;
  if (part === "quote") {
    return (
      <>
        {i === 0
          ? head("Got a nice message from a customer?", "Paste it here, word for word. No message yet? Skip this.")
          : head(`Another one? (${i + 1} of ${MAX_QUIZ_REVIEWS})`, "Three reviews customers agreed to share make this part complete. No more? Skip.")}
        <Textarea aria-label="What the customer said" rows={4} maxLength={1000} placeholder="“Best service in town, thank you!”" value={note.quote} onChange={(e) => setNote(i, { quote: e.target.value })} />
        {note.quote.trim() && <Input aria-label="Customer's name or initials" maxLength={80} placeholder="Their name or initials, e.g. Aline K." value={note.customerName} onChange={(e) => setNote(i, { customerName: e.target.value })} />}
      </>
    );
  }
  if (part === "source") {
    const options: TileOption<ReviewSourceValue>[] = REVIEW_SOURCES.map((v) => ({ value: v, label: SOURCE_LABEL[v], emoji: SOURCE_EMOJI[v] }));
    return (
      <>
        {head("Where did it come from?")}
        <Tiles
          label="Where it came from"
          options={options}
          value={note.source || null}
          onPick={(source) => {
            setNote(i, { source });
            onTap();
          }}
          columns={3}
        />
      </>
    );
  }
  return (
    <>
      {head("Did they agree to be quoted?", "BuPulse quotes a review in public posts only when they agreed.")}
      <ThisOrThat
        label="Agreed to be quoted"
        left={{ value: "yes", label: "Yes, they agreed", emoji: "👍" }}
        right={{ value: "no", label: "Not asked yet", emoji: "🤔" }}
        value={note.canPublish ? "yes" : "no"}
        onPick={(v) => {
          setNote(i, { canPublish: v === "yes" });
          onTap();
        }}
      />
    </>
  );
}
