"use client";

// The own campaign quiz (docs/QUIZ_MODE.md, "B. Own campaign quiz"): six cards instead of the long form. The kind, one
// line and the products, the dates, the deal, the highlights, then the name and description BuPulse wrote. It saves
// through the same createCampaign action and schema as the full form, so the campaign is the same record.

import { ArrowRight, CalendarDays, Gift, Sparkles, Tag, Zap } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { createCampaign, suggestOwnCampaignAction } from "@/app/dashboard/knowledge/campaigns/actions";
import { Chips, Confetti, GuessTag, KeepOrDrop, QuestionHead, QuizFrame, RoundDone, TextAnswer, Thinking, Tiles, useQuiz, type KeepItem, type TileOption } from "@/components/quiz";
import { Button, Field, GlassCard, Input, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { campaignFromQuiz, datesForChip, lineIdeas, templateOwnSuggestion, WHEN_GUESS, whenChipsFor, type OwnQuizAnswers, type OwnSuggestion, type WhenChip } from "@/lib/knowledge/campaign-quiz";
import { CAMPAIGN_LIMITS, CAMPAIGN_TYPE_LABEL, campaignInputSchema, formatDateRange, MAX_CAMPAIGN_PRODUCTS, MAX_HIGHLIGHTS, type CampaignTypeValue } from "@/lib/knowledge/campaigns";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { POINTS, type QuizRound, type QuizStep } from "@/lib/quiz/flow";

export type QuizProduct = { id: string; name: string; price: string | null };

const ROUNDS: QuizRound[] = [
  { id: "idea", title: "Idea", emoji: "💡", blurb: "What it is" },
  { id: "details", title: "Details", emoji: "📅", blurb: "When, the deal, the highlights" },
  { id: "launch", title: "Your campaign", emoji: "🎉", blurb: "Check and add it" },
];

const STEPS: QuizStep[] = [
  { id: "kind", round: "idea" },
  { id: "about", round: "idea" },
  { id: "when", round: "details" },
  { id: "deal", round: "details" },
  { id: "highlights", round: "details" },
  { id: "final", round: "launch" },
];

const KINDS: TileOption<CampaignTypeValue>[] = [
  { value: "OFFER", label: "Offer", emoji: "🎁", hint: "A deal or a discount for a while" },
  { value: "EVENT", label: "Event", emoji: "📅", hint: "A day, a place: open day, tasting, show" },
  { value: "LAUNCH", label: "Launch", emoji: "🚀", hint: "Something new: a product, a branch, a menu" },
  { value: "PROMOTION", label: "Promotion", emoji: "📣", hint: "A push for something you sell, no discount" },
  { value: "OTHER", label: "Other", emoji: "✨", hint: "Anything else worth telling people" },
];

/** Which card shows a field's error from the schema. */
const CARD_OF: Record<string, string> = { type: "kind", startsOn: "when", endsOn: "when", priceInfo: "deal", highlights: "highlights", productIds: "about", name: "final", description: "final" };

const AUTO_NEXT_MS = 250;

export function OwnCampaignQuiz({ products, initialProductIds, today, businessName, fullFormHref }: { products: QuizProduct[]; initialProductIds: string[]; today: string; businessName: string; fullFormHref: string }) {
  const { toast } = useToast();
  const quiz = useQuiz(STEPS);
  const [a, setA] = useState<OwnQuizAnswers>({ type: "OFFER", line: "", productIds: initialProductIds, when: WHEN_GUESS.OFFER, pickStartsOn: "", pickEndsOn: "", deal: "", highlights: [], name: "", description: "" });
  const [suggestion, setSuggestion] = useState<OwnSuggestion | null>(null);
  const [items, setItems] = useState<KeepItem[]>([]);
  const [kept, setKept] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const touched = useRef({ when: false, deal: false, name: false, description: false, highlights: false });
  const asked = useRef<string | null>(null);
  const nextId = useRef(0);

  const set = (patch: Partial<OwnQuizAnswers>, field?: keyof typeof touched.current) => {
    setError(null);
    if (field) touched.current[field] = true;
    setA((cur) => ({ ...cur, ...patch }));
  };

  // Product chips by name; a name used twice gets " (2)" so each chip is one product.
  const chips = useMemo(() => {
    const seen = new Map<string, number>();
    return products.map((p) => {
      const n = (seen.get(p.name.toLowerCase()) ?? 0) + 1;
      seen.set(p.name.toLowerCase(), n);
      return { id: p.id, label: n > 1 ? `${p.name} (${n})` : p.name };
    });
  }, [products]);
  const shownChips = chips.filter((c, i) => i < 24 || a.productIds.includes(c.id));
  const picked = products.filter((p) => a.productIds.includes(p.id));

  const input = campaignFromQuiz({ ...a, highlights: items.filter((i) => kept.includes(i.id)).map((i) => i.text) }, today);
  const check = campaignInputSchema.safeParse(input);
  const fieldErrors = check.success ? {} : fieldErrorMap(check.error);
  const dates = datesForChip(a.when, today, { startsOn: a.pickStartsOn, endsOn: a.pickEndsOn });

  function apply(s: OwnSuggestion) {
    setSuggestion(s);
    const t = touched.current;
    setA((cur) => ({
      ...cur,
      when: t.when || (cur.type === "EVENT" && s.when === "NONE") ? cur.when : s.when,
      deal: t.deal ? cur.deal : (s.deals[0] ?? ""),
      name: t.name ? cur.name : s.name,
      description: t.description ? cur.description : s.description,
    }));
    if (!t.highlights) {
      const list = s.highlights.map((text) => ({ id: `h${nextId.current++}`, text }));
      setItems(list);
      setKept(list.map((i) => i.id));
    }
  }

  /** "What's it about?" Next: one AI call (again only when the kind, line or products changed). */
  async function afterAbout() {
    quiz.next();
    const key = JSON.stringify([a.type, a.line.trim(), a.productIds]);
    if (asked.current === key) return;
    asked.current = key;
    setThinking(true);
    const r = await suggestOwnCampaignAction({ type: a.type, line: a.line, productIds: a.productIds });
    setThinking(false);
    apply(r.ok ? r.suggestion : templateOwnSuggestion({ type: a.type, line: a.line, businessName, products: picked.map((p) => ({ name: p.name, price: p.price })) }));
  }

  function pickKind(type: CampaignTypeValue) {
    set({ type, ...(type === "EVENT" && a.when === "NONE" ? { when: WHEN_GUESS.EVENT } : {}), ...(!touched.current.when ? { when: WHEN_GUESS[type] } : {}) });
    window.setTimeout(quiz.next, AUTO_NEXT_MS);
  }

  function pickWhen(when: WhenChip) {
    set({ when }, "when");
    if (when !== "PICK") window.setTimeout(quiz.next, AUTO_NEXT_MS);
  }

  async function save() {
    if (!check.success) {
      const first = Object.keys(fieldErrors)[0];
      setError(fieldErrors[first] ?? "Check your answers.");
      if (first && CARD_OF[first] && CARD_OF[first] !== "final") quiz.goTo(CARD_OF[first]);
      return;
    }
    setSaving(true);
    const r = await createCampaign(input);
    setSaving(false);
    if (!r.ok) {
      const first = Object.keys(r.fieldErrors ?? {})[0];
      setError(first ? (r.fieldErrors?.[first] ?? r.error) : r.error);
      if (first && CARD_OF[first] && CARD_OF[first] !== "final") quiz.goTo(CARD_OF[first]);
      return;
    }
    toast("Campaign added.", "success");
    setSaved({ id: r.campaignId, name: input.name });
  }

  if (saved) return <Celebration name={saved.name} href={`/dashboard/knowledge/campaigns/${saved.id}`} points={quiz.points + POINTS.answer + POINTS.round} />;

  const id = quiz.step?.id;
  const kicker = `${ROUNDS.find((r) => r.id === quiz.round)?.title ?? ""} · ${quiz.stepInRound} of ${quiz.stepsInRound}`;
  const roundDone = quiz.roundDone ? ROUNDS.find((r) => r.id === quiz.roundDone) : null;
  const primary = thinking || roundDone || quiz.finished ? null : id === "about" ? { onClick: () => void afterAbout() } : id === "final" ? { label: "Add campaign", onClick: () => void save(), busy: saving } : id === "when" ? { onClick: quiz.next, disabled: Boolean(fieldErrors.startsOn || fieldErrors.endsOn) } : { onClick: quiz.next };

  return (
    <QuizFrame rounds={ROUNDS} steps={STEPS} quiz={quiz} primary={primary} canSkip={id !== "kind" && id !== "about" && id !== "final"} fullForm={{ href: fullFormHref }}>
      {thinking ? (
        <Thinking lines={["Reading your idea…", picked.length ? `Looking at ${picked[0].name}…` : "Looking at your business…", "Writing a name and the highlights…"]} />
      ) : roundDone ? (
        <RoundDone
          round={roundDone}
          next={ROUNDS[ROUNDS.indexOf(roundDone) + 1] ?? null}
          points={quiz.points}
          saved={roundDone.id === "idea" ? (suggestion?.source === "ai" ? "BuPulse wrote ideas from your line. Keep them or change them." : "Here are some starting ideas. Change anything you like.") : "Nearly there. One last look and it's added."}
          onContinue={quiz.continueRound}
        />
      ) : id === "kind" ? (
        <>
          <QuestionHead kicker={kicker} title="What kind of campaign?" hint="Tap one. You can change it later." />
          <Tiles label="Campaign kind" options={KINDS} value={a.type} guess="OFFER" onPick={pickKind} />
        </>
      ) : id === "about" ? (
        <>
          <QuestionHead kicker={kicker} title="What's it about?" hint="One line is enough. Tap an idea or write your own, with the price or discount if there is one." />
          <TextAnswer label="What the campaign is about" value={a.line} onChange={(line) => set({ line })} suggestions={lineIdeas(a.type, picked[0]?.name ?? null)} maxLength={300} placeholder="For example: 20% off all juices this weekend" />
          {chips.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[14px] font-semibold">Which products? <span className="font-normal text-muted">Optional</span></p>
              <Chips
                label="Products in this campaign"
                options={shownChips.map((c) => c.label)}
                values={chips.filter((c) => a.productIds.includes(c.id)).map((c) => c.label)}
                onChange={(labels) => set({ productIds: chips.filter((c) => labels.includes(c.label)).map((c) => c.id) })}
                max={MAX_CAMPAIGN_PRODUCTS}
              />
            </div>
          )}
        </>
      ) : id === "when" ? (
        <>
          <QuestionHead kicker={kicker} title="When does it run?" hint={a.type === "EVENT" ? "An event needs a date." : "Pick one. No dates is fine too."} />
          <Tiles
            label="When"
            columns={3}
            options={whenChipsFor(a.type).map((w) => {
              const d = w.value === "PICK" || w.value === "NONE" ? null : datesForChip(w.value, today);
              return { value: w.value, label: w.label, emoji: w.emoji, hint: d ? formatDateRange(d.startsOn, d.endsOn) : undefined };
            })}
            value={a.when}
            guess={suggestion?.when ?? WHEN_GUESS[a.type]}
            onPick={pickWhen}
          />
          {a.when === "PICK" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Starts" error={fieldErrors.startsOn}>
                <Input type="date" value={a.pickStartsOn} onChange={(e) => set({ pickStartsOn: e.target.value }, "when")} />
              </Field>
              <Field label="Ends" hint="Optional" error={fieldErrors.endsOn}>
                <Input type="date" value={a.pickEndsOn} min={a.pickStartsOn || undefined} onChange={(e) => set({ pickEndsOn: e.target.value }, "when")} />
              </Field>
            </div>
          )}
          {a.when !== "PICK" && (fieldErrors.startsOn || fieldErrors.endsOn) && (
            <p role="alert" className="text-[14px] font-medium text-danger">
              {fieldErrors.startsOn || fieldErrors.endsOn}
            </p>
          )}
        </>
      ) : id === "deal" ? (
        <>
          <QuestionHead kicker={kicker} title="What's the deal?" hint="Exactly as customers should read it. BuPulse only uses prices you gave." />
          <DealPicker value={a.deal} ideas={suggestion?.deals ?? []} guess={suggestion?.deals[0] ?? ""} onChange={(deal) => set({ deal }, "deal")} />
        </>
      ) : id === "highlights" ? (
        <>
          <QuestionHead kicker={kicker} title="What should people know?" hint="Keep the ones you like, drop the rest, or add your own." />
          <KeepOrDrop
            label="Highlights"
            items={items}
            kept={kept}
            maxLength={CAMPAIGN_LIMITS.highlight}
            onChange={(k) => {
              touched.current.highlights = true;
              setKept(k.slice(0, MAX_HIGHLIGHTS));
            }}
            onEdit={(hid, patch) => {
              touched.current.highlights = true;
              setItems((list) => list.map((i) => (i.id === hid ? { ...i, text: patch.text } : i)));
            }}
            onAdd={
              kept.length < MAX_HIGHLIGHTS
                ? (patch) => {
                    touched.current.highlights = true;
                    const item = { id: `h${nextId.current++}`, text: patch.text };
                    setItems((list) => [...list, item]);
                    setKept((k) => [...k, item.id]);
                  }
                : undefined
            }
            addLabel="Add a highlight"
          />
          {fieldErrors.highlights && (
            <p role="alert" className="text-[14px] font-medium text-danger">
              {fieldErrors.highlights}
            </p>
          )}
        </>
      ) : id === "final" ? (
        <>
          <QuestionHead kicker={kicker} title="Here's your campaign" hint="Tap the name or the words to change them." />
          <div className="flex flex-col gap-4 rounded-3xl border-2 border-pulse-blue/40 bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-soft px-3 py-1 text-[12px] font-semibold">{CAMPAIGN_TYPE_LABEL[a.type]}</span>
              {suggestion && a.name === suggestion.name && <GuessTag label="BuPulse wrote it" />}
            </div>
            <Field label="Name" error={fieldErrors.name}>
              <Input value={a.name} maxLength={CAMPAIGN_LIMITS.name} onChange={(e) => set({ name: e.target.value }, "name")} placeholder="Give it a name" className="text-[18px] font-semibold" />
            </Field>
            <Field label="Description" error={fieldErrors.description}>
              <Textarea rows={4} value={a.description} maxLength={CAMPAIGN_LIMITS.description} onChange={(e) => set({ description: e.target.value }, "description")} />
            </Field>
            <ul className="flex flex-col gap-1.5 text-[14px]">
              <Line icon={<CalendarDays aria-hidden className="size-4" />}>{dates.startsOn ? formatDateRange(dates.startsOn, dates.endsOn) : "No dates"}</Line>
              <Line icon={<Tag aria-hidden className="size-4" />}>{a.deal.trim() || "No price or discount"}</Line>
              <Line icon={<Sparkles aria-hidden className="size-4" />}>{kept.length ? `${kept.length} ${kept.length === 1 ? "highlight" : "highlights"}` : "No highlights"}</Line>
              {picked.length > 0 && <Line icon={<Gift aria-hidden className="size-4" />}>{picked.map((p) => p.name).join(", ")}</Line>}
            </ul>
          </div>
        </>
      ) : null}
      {error && !thinking && !roundDone && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] font-medium text-danger">
          {error}
        </p>
      )}
    </QuizFrame>
  );
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-muted">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="text-text">{children}</span>
    </li>
  );
}

const NO_DEAL = "No price or discount";

/** The deal: BuPulse's ideas (each from the owner's line or a stored price), "No price or discount", or the owner's words. */
function DealPicker({ value, ideas, guess, onChange }: { value: string; ideas: string[]; guess: string; onChange: (v: string) => void }) {
  const none = value.trim() === "";
  return (
    <div className="flex flex-col gap-3">
      <TextAnswer label="The price or the deal" value={value} onChange={onChange} suggestions={ideas} maxLength={CAMPAIGN_LIMITS.priceInfo} placeholder={ideas.length ? "Or write your own" : "For example: 20% off all juices"} />
      <button
        type="button"
        aria-pressed={none}
        onClick={() => onChange("")}
        className={cn(
          "flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 py-3 text-left text-[15px] transition-[border-color,background-color] duration-200",
          none ? "border-pulse-blue bg-pulse-blue/8 font-medium" : "border-line bg-surface hover:border-pulse-blue/40",
        )}
      >
        <span aria-hidden>🙅</span>
        {NO_DEAL}
        {guess === "" && <GuessTag />}
      </button>
      {ideas.length === 0 && <p className="text-[13px] text-muted">No price in your line or your products, so BuPulse did not make one up.</p>}
    </div>
  );
}

function Celebration({ name, href, points }: { name: string; href: string; points: number }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <GlassCard strong padding="none" className="relative flex min-h-[440px] flex-col items-center justify-center gap-4 overflow-hidden p-6 text-center sm:p-8">
        <Confetti />
        <span aria-hidden className="text-6xl">
          🎉
        </span>
        <h2 className="text-[26px] font-semibold tracking-[-0.025em]">{name} is added!</h2>
        <p className="max-w-md text-[15px] text-muted">Autopilot and the chat assistant know about it now. Next, make the posts that tell people.</p>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-soft px-4 py-2 text-[15px] font-bold tabular-nums">
          <Zap aria-hidden className="size-4 text-pulse-violet" />
          {points} points
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" href={href} trailing={<ArrowRight aria-hidden className="size-4" />}>
            Make posts for it now
          </Button>
          <Button size="lg" variant="outline" href="/dashboard/knowledge/campaigns">
            Back to campaigns
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
