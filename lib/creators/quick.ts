// Creator campaign quick mode (docs/QUIZ_MODE.md, "C. Creator campaign quick mode"): nine quiz cards over the same
// draft as the 12-step wizard. Pure: which wizard steps each card saves, the size tiles, the date chips, the pay slider's
// range. Each card sends stepInput() for its steps, so the server checks (STEP_SCHEMAS, saveStep) stay the same and a
// draft made here opens in the detailed wizard, and the reverse.

import { addDaysYmd } from "@/lib/demo/slots";
import type { QuizRound, QuizStep } from "@/lib/quiz/flow";
import type { PayRules } from "./pay";
import { maxRate, minRate, RATE_VIEWS } from "./pay-floor";
import { daysInclusive } from "./periods";
import type { CreatorRequirements } from "./requirements";
import { stepNumber, type WizardStepId } from "./wizard";
import { nextMonday, payMethodOf, stepInput, type WizardAnswers } from "./wizard-steps";

export const QUICK_CARDS = ["idea", "goal", "creators", "where", "when", "pay", "prepared", "files", "ready"] as const;
export type QuickCard = (typeof QUICK_CARDS)[number];
export const isQuickCard = (v: unknown): v is QuickCard => typeof v === "string" && (QUICK_CARDS as readonly string[]).includes(v);

export const QUICK_ROUNDS: QuizRound[] = [
  { id: "idea", title: "Idea", emoji: "💡", blurb: "What it's about" },
  { id: "setup", title: "Setup", emoji: "🎯", blurb: "Who, where, when and the pay" },
  { id: "finish", title: "Finish", emoji: "🚀", blurb: "Check, add files, go live" },
];

const ROUND_OF: Record<QuickCard, string> = { idea: "idea", goal: "setup", creators: "setup", where: "setup", when: "setup", pay: "setup", prepared: "finish", files: "finish", ready: "finish" };
export const QUICK_STEPS: QuizStep[] = QUICK_CARDS.map((id) => ({ id, round: ROUND_OF[id] }));

/**
 * The wizard steps each card saves, in order. "We prepared the rest" saves Rules, Form and Look as shown; Content (the
 * brief and the tasks) is saved by its detailed step when the owner changes it, so the tasks When planned on the
 * server are never sent back stale.
 */
export const CARD_STEPS: Record<QuickCard, WizardStepId[]> = {
  idea: ["idea"],
  goal: ["goal"],
  creators: ["creators"],
  where: ["where"],
  when: ["when"],
  pay: ["pay"],
  prepared: ["rules", "form", "look"],
  files: ["files"],
  ready: [],
};

/** The detailed step a card opens ("Open detailed setup"). */
export const CARD_DETAILED: Record<QuickCard, WizardStepId> = { idea: "idea", goal: "goal", creators: "creators", where: "where", when: "when", pay: "pay", prepared: "content", files: "files", ready: "review" };

/** The summary cards of "We prepared the rest", each opening its detailed step. */
export const PREPARED: { step: WizardStepId; title: string; emoji: string }[] = [
  { step: "content", title: "Content", emoji: "📝" },
  { step: "rules", title: "Rules", emoji: "✅" },
  { step: "form", title: "Form", emoji: "📋" },
  { step: "look", title: "Look", emoji: "🎨" },
];

/** What a card sends: saveStepAction(campaignId, step, input) for each. */
export function cardInputs(card: QuickCard, a: WizardAnswers): { step: WizardStepId; input: unknown }[] {
  return CARD_STEPS[card].map((step) => ({ step, input: stepInput(step, a) }));
}

/** The card to continue a draft at, from the furthest wizard step it reached. */
export function cardForStep(reached: number | null): QuickCard {
  const n = reached ?? stepNumber("review");
  if (n <= stepNumber("goal")) return "goal";
  if (n <= stepNumber("creators")) return "creators";
  if (n <= stepNumber("where")) return "where";
  if (n <= stepNumber("when")) return "when";
  if (n <= stepNumber("pay")) return "pay";
  if (n <= stepNumber("look")) return "prepared";
  return "files";
}

/** "Continue" on a draft still being set up: quick mode at the card matching how far it got. */
export const continueHref = (campaignId: string, setupStep: number) => `/dashboard/creators/${campaignId}/quick?card=${cardForStep(setupStep)}`;

/** The smaller "Detailed setup" next to it: the wizard at the furthest step reached. */
export const detailedSetupHref = (campaignId: string, setupStep: number) => `/dashboard/creators/${campaignId}/setup?step=${setupStep}`;

/** The quiz's place when it opens at `card`: the cards before it count as answered, their rounds as done. */
export function progressAt(card: QuickCard) {
  const index = QUICK_STEPS.findIndex((s) => s.id === card);
  const before = QUICK_STEPS.slice(0, Math.max(0, index));
  const doneRounds = QUICK_ROUNDS.filter((r) => QUICK_STEPS.filter((s) => s.round === r.id).every((s) => before.includes(s))).map((r) => r.id);
  return { index: Math.max(0, index), answered: before.map((s) => s.id), skipped: [], doneRounds };
}

// ---- Creators ---------------------------------------------------------------------------------------------------

export const SIZES = [
  { value: "ANY", label: "Anyone", emoji: "🙌", hint: "Any number of followers", min: null },
  { value: "1K", label: "1k+", emoji: "🌱", hint: "Small and close to their fans", min: 1_000 },
  { value: "10K", label: "10k+", emoji: "⭐", hint: "Known in their town", min: 10_000 },
  { value: "50K", label: "50k+", emoji: "🔥", hint: "Big audiences", min: 50_000 },
] as const;
export type SizeValue = (typeof SIZES)[number]["value"];

/** The size tile of a minimum: the biggest whose floor it reaches (none or 0: Anyone). */
export function sizeOf(minFollowers: number | null | undefined): SizeValue {
  const n = minFollowers ?? 0;
  return [...SIZES].reverse().find((s) => s.min !== null && n >= s.min)?.value ?? "ANY";
}

export function withSize(r: CreatorRequirements, size: SizeValue): CreatorRequirements {
  return { ...r, minFollowers: SIZES.find((s) => s.value === size)?.min ?? null };
}

/** Places to tap on the Creators card: the ones picked, then Kigali's districts and the big towns. */
export const PLACE_CHIPS = ["Kigali", "Kigali, Gasabo", "Kigali, Kicukiro", "Kigali, Nyarugenge", "Northern Province, Musanze", "Western Province, Rubavu", "Southern Province, Huye", "Eastern Province, Rwamagana"];

// ---- When -------------------------------------------------------------------------------------------------------

export const START_CHIPS = [
  { value: "TODAY", label: "Starts today" },
  { value: "MONDAY", label: "Next Monday" },
  { value: "PICK", label: "Pick a day" },
] as const;
export type StartChip = (typeof START_CHIPS)[number]["value"];

export const LENGTH_CHIPS = [
  { value: "1W", label: "1 week", days: 7 },
  { value: "2W", label: "2 weeks", days: 14 },
  { value: "1M", label: "1 month", days: 30 },
  { value: "PICK", label: "Pick the last day", days: 0 },
] as const;
export type LengthChip = (typeof LENGTH_CHIPS)[number]["value"];

export function startChipOf(startsOn: string, today: string): StartChip {
  return startsOn === today ? "TODAY" : startsOn === nextMonday(today) ? "MONDAY" : "PICK";
}

export function lengthChipOf(startsOn: string, endsOn: string): LengthChip {
  const days = daysInclusive(startsOn, endsOn);
  return LENGTH_CHIPS.find((l) => l.days === days)?.value ?? "PICK";
}

/** The campaign's first and last day from the chips; "Pick" keeps the day typed (`current`). The length keeps up with a new start. */
export function quickDates(start: StartChip, length: LengthChip, today: string, current: { startsOn: string; endsOn: string }): { startsOn: string; endsOn: string } {
  const startsOn = start === "TODAY" ? today : start === "MONDAY" ? nextMonday(today) : current.startsOn;
  const days = LENGTH_CHIPS.find((l) => l.value === length)?.days ?? 0;
  if (days) return { startsOn, endsOn: addDaysYmd(startsOn, days - 1) };
  // A picked last day: kept, or the same length after a new start.
  const keep = daysInclusive(current.startsOn, current.endsOn);
  const endsOn = current.startsOn === startsOn ? current.endsOn : addDaysYmd(startsOn, Math.max(1, keep) - 1);
  return { startsOn, endsOn: endsOn < startsOn ? startsOn : endsOn };
}

// ---- Pay --------------------------------------------------------------------------------------------------------

/** True when the pay is a price per views only: the slider can show it (fees and milestones open the detailed step). */
export const sliderPay = (rules: PayRules) => payMethodOf(rules) === "VIEWS";

/** The slider's range for the price per `views` views: the floor (less is refused) to five times it. */
export function rateRange(currency: string, views: number, current: number | null | undefined) {
  const min = minRate(currency, views);
  const max = Math.min(maxRate(currency, views), Math.max(min * 5, current ?? 0));
  return { min, max, step: Math.max(1, Math.round(min / 10)) };
}

/** The rules with the slider's price per views (the views it is priced for kept). */
export function withRate(rules: PayRules, rate: number): PayRules {
  const views = rules.rateViews && (RATE_VIEWS as readonly number[]).includes(rules.rateViews) ? rules.rateViews : 1_000;
  return { ...rules, ratePerThousand: Math.round(rate), rateViews: views };
}

/** Budget chips a period, in whole units of the currency (RWF: 50,000 / 100,000 / 250,000). */
export function budgetPresets(currency: string): number[] {
  return [50, 100, 250].map((x) => minRate(currency) * x);
}
