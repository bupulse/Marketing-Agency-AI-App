// The AI marketing interview, server side: storage (MarketingInterview, one per company), the AI calls for the next
// question and the summary, and approval into Business.marketingProfile. The rules are pure, in ./interview.ts.
//
// AI calls go through the cost ledger (feature "interview") on the cheap text model, so the admin switch and the
// monthly budget caps (the platform's and the company's allowance) apply; each company may make
// RATE_LIMITS.interviewAi calls an hour and MAX_AI_CALLS_PER_DAY over a rolling 24 hours, counted in the ledger
// (AiCall, feature "interview"), so starting over does not reset it. Whenever the AI cannot be used the fixed question set carries on, and once the reason is lasting (no
// key, switched off, budget reached, rate limited) the rest of the interview stays on the fixed set.
import "server-only";
import { AIBudgetExceededError } from "@/lib/ai/budget";
import { getCheapTextProvider } from "@/lib/ai";
import { withLedger } from "@/lib/ai/ledger";
import { AIProviderError } from "@/lib/ai/types";
import { ServiceDisabledError } from "@/lib/admin/switch";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";
import {
  aiQuestionJsonSchema,
  aiSummaryJsonSchema,
  buildQuestionPrompt,
  buildSummaryPrompt,
  checkAnswer,
  fallbackSummary,
  fixedQuestion,
  interviewDone,
  marketingProfileFrom,
  MAX_AI_CALLS_PER_DAY,
  MAX_RESTARTS_PER_DAY,
  MAX_QUESTIONS,
  nextFixedQuestion,
  parseAiQuestion,
  parseAiSummary,
  QUESTION_SYSTEM,
  readMarketingProfile,
  readSteps,
  SUMMARY_SYSTEM,
  summarySchema,
  type InterviewContext,
  type InterviewQuestion,
  type InterviewStep,
  type MarketingProfile,
  type VoiceSummary,
} from "./interview";
import { readProfile } from "./profile";
import { KnowledgeError } from "./service";

export type InterviewView = {
  status: "none" | "active" | "review" | "approved";
  /** "fixed" once the AI could not be used: the page says the questions are the standard set. */
  mode: "ai" | "fixed";
  steps: InterviewStep[];
  cursor: number;
  summary: VoiceSummary | null;
  profile: MarketingProfile | null;
};

type Ctx = { userId: string; businessId: string };
type Row = NonNullable<Awaited<ReturnType<typeof loadRow>>>;

const CHANGED = "This interview changed in another tab. Reload the page to carry on.";

function loadRow(businessId: string) {
  return prisma.marketingInterview.findUnique({ where: { businessId } });
}

function readSummary(value: unknown): VoiceSummary | null {
  const parsed = summarySchema.safeParse(value ?? undefined);
  return parsed.success ? parsed.data : null;
}

export async function getInterviewView(businessId: string): Promise<InterviewView> {
  const [row, business] = await Promise.all([loadRow(businessId), prisma.business.findUnique({ where: { id: businessId }, select: { marketingProfile: true } })]);
  const profile = readMarketingProfile(business?.marketingProfile);
  if (!row) return { status: profile ? "approved" : "none", mode: "ai", steps: [], cursor: 0, summary: null, profile };
  const steps = readSteps(row.steps);
  const status = row.status === "review" || row.status === "approved" ? row.status : "active";
  return { status, mode: row.mode === "fixed" ? "fixed" : "ai", steps, cursor: Math.min(row.cursor, Math.max(0, steps.length - 1)), summary: readSummary(row.summary), profile };
}

async function interviewContext(businessId: string): Promise<InterviewContext & { language: string }> {
  const b = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, industry: true, description: true, profile: true, contentLanguage: true } });
  return { businessName: b?.name ?? "", sector: b?.industry, about: readProfile(b?.profile).about ?? b?.description, language: b?.contentLanguage ?? "English" };
}

/** Saves only when nobody else changed the row since it was read (two tabs, a double click). */
async function save(row: Row, data: Prisma.MarketingInterviewUpdateManyMutationInput): Promise<void> {
  const { count } = await prisma.marketingInterview.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data });
  if (!count) throw new KnowledgeError(CHANGED);
}

/** A lasting reason the AI cannot be used now: switch the rest of the interview to the fixed set. */
function lasting(error: unknown): boolean {
  return error instanceof AIBudgetExceededError || error instanceof ServiceDisabledError || error instanceof RateLimitError || !(error instanceof AIProviderError);
}

type AiResult<T> = { value: T | null; called: boolean; stop: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Interview AI calls the company made in the last 24 hours (failed ones too: they may have been billed). */
export function interviewCallsToday(businessId: string, now = new Date()): Promise<number> {
  return prisma.aiCall.count({ where: { businessId, feature: "interview", createdAt: { gte: new Date(now.getTime() - DAY_MS) } } });
}

/**
 * One cheap AI call through the ledger, rate-limited per company. Never throws: failures become `value: null`.
 * `called` is true only when the provider was really asked (refusals before the call, such as the budget caps or
 * the admin switch, cost nothing and do not count).
 */
async function callAi<T>(ctx: Ctx, row: Row, request: { system: string; prompt: string; jsonSchema: Record<string, unknown> }, parse: (text: string) => T | null): Promise<AiResult<T>> {
  if (row.mode === "fixed") return { value: null, called: false, stop: false };
  if ((await interviewCallsToday(ctx.businessId)) >= MAX_AI_CALLS_PER_DAY) return { value: null, called: false, stop: true };
  let invoked = false;
  try {
    await rateLimit(`interviewAi:${ctx.businessId}`, RATE_LIMITS.interviewAi);
    const { provider, model } = getCheapTextProvider();
    const result = await withLedger(
      { userId: ctx.userId, businessId: ctx.businessId, feature: "interview" },
      { provider: provider.name, model },
      () => {
        invoked = true;
        return provider.generate(request);
      },
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
    );
    return { value: parse(result.text), called: true, stop: false };
  } catch (error) {
    if (!(error instanceof RateLimitError) && !(error instanceof AIBudgetExceededError) && !(error instanceof ServiceDisabledError)) {
      await logError(error, { source: "knowledge.interview.ai", level: "warn", businessId: ctx.businessId });
    }
    return { value: null, called: invoked, stop: lasting(error) };
  }
}

/** Thrown by startInterview when an interview is under way and the owner has not confirmed "Start over". */
export class InterviewInProgressError extends KnowledgeError {
  constructor() {
    super("You have an interview in progress. Choose Start over to throw away its answers and begin again.");
  }
}

/**
 * Starts the interview with the fixed first question. Over an interview in progress (or waiting for approval) only
 * with `confirm` ("Start over"), at most MAX_RESTARTS_PER_DAY times a day. The AI call count is not reset: the daily
 * cap is counted in the ledger. The approved profile stays until a new one is approved.
 */
export async function startInterview(businessId: string, opts: { confirm?: boolean } = {}): Promise<void> {
  const row = await loadRow(businessId);
  if (row && (row.status === "active" || row.status === "review") && !opts.confirm) throw new InterviewInProgressError();
  if (row) {
    try {
      await rateLimit(`interviewRestart:${businessId}`, { limit: MAX_RESTARTS_PER_DAY, windowSeconds: 24 * 60 * 60 });
    } catch (error) {
      if (error instanceof RateLimitError) throw new KnowledgeError(`You can start the interview over ${MAX_RESTARTS_PER_DAY} times a day. Please carry on with this one, or try again tomorrow.`);
      throw error;
    }
  }
  const first: InterviewStep = { ...fixedQuestion("tone"), answer: null, skipped: false };
  const data = { status: "active", mode: "ai", steps: [first] as unknown as Prisma.InputJsonValue, cursor: 0, summary: Prisma.DbNull };
  if (!row) {
    await prisma.marketingInterview.upsert({ where: { businessId }, create: { businessId, ...data }, update: data });
    return;
  }
  await save(row, data);
}

/** A claim older than this (the request that made it died) may be taken over by the next answer. */
const CLAIM_STALE_MS = 60_000;

/**
 * Answers (or skips) the question at `index`, which must be the one on screen. Going forward from an earlier
 * question shows the next one already asked; from the last one, the AI (or the fixed set) asks the next, or the
 * summary is written when every topic is covered or the cap is reached.
 *
 * The row is claimed BEFORE any AI call: the answer is saved and the cursor moved past the last question in one
 * conditional update, so a double click or a second tab is refused instead of paying for a second AI call. A claim
 * left behind by a request that died is taken over after CLAIM_STALE_MS.
 */
export async function answerStep(ctx: Ctx, input: { index: number; choices: string[]; other: string; skip: boolean }, now = new Date()): Promise<void> {
  const row = await loadRow(ctx.businessId);
  if (!row || row.status !== "active") throw new KnowledgeError("Start the interview first.");
  const steps = readSteps(row.steps);
  const last = steps.length - 1;
  const abandoned = row.cursor === steps.length && input.index === last && now.getTime() - row.updatedAt.getTime() > CLAIM_STALE_MS;
  if ((input.index !== row.cursor && !abandoned) || input.index > last) throw new KnowledgeError(CHANGED);
  const step = steps[input.index];
  if (input.skip) {
    steps[input.index] = { ...step, answer: null, skipped: true };
  } else {
    const checked = checkAnswer(step, input);
    if (!checked.ok) throw new KnowledgeError(checked.error);
    steps[input.index] = { ...step, answer: checked.answer, skipped: false };
  }

  if (input.index < last) {
    await save(row, { steps: steps as unknown as Prisma.InputJsonValue, cursor: input.index + 1 });
    return;
  }

  // Claim: the answer is stored and the cursor points past the last question while the next one is written.
  const claimedAt = new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1));
  await save(row, { steps: steps as unknown as Prisma.InputJsonValue, cursor: steps.length, updatedAt: claimedAt });
  const claimed: Row = { ...row, updatedAt: claimedAt, cursor: steps.length };

  let aiCalls = row.aiCalls;
  let mode = row.mode;
  if (interviewDone(steps)) {
    const ictx = await interviewContext(ctx.businessId);
    const ai = await callAi(ctx, claimed, { system: SUMMARY_SYSTEM, prompt: buildSummaryPrompt(ictx, steps, ictx.language), jsonSchema: aiSummaryJsonSchema }, parseAiSummary);
    if (ai.called) aiCalls += 1;
    if (ai.stop) mode = "fixed";
    await save(claimed, { status: "review", cursor: last, summary: (ai.value ?? fallbackSummary(steps)) as Prisma.InputJsonValue, aiCalls, mode });
    return;
  }

  let next: InterviewQuestion | null = null;
  if (steps.length < MAX_QUESTIONS) {
    const ictx = await interviewContext(ctx.businessId);
    const ai = await callAi(ctx, claimed, { system: QUESTION_SYSTEM, prompt: buildQuestionPrompt(ictx, steps), jsonSchema: aiQuestionJsonSchema }, (text) => {
      const q = parseAiQuestion(text, steps);
      return q === "done" ? null : q;
    });
    if (ai.called) aiCalls += 1;
    if (ai.stop) mode = "fixed";
    next = ai.value ?? nextFixedQuestion(steps);
  }
  if (!next) {
    await save(claimed, { cursor: last });
    throw new KnowledgeError("We could not find the next question. Please try again.");
  }
  steps.push({ ...next, answer: null, skipped: false });
  await save(claimed, { steps: steps as unknown as Prisma.InputJsonValue, cursor: steps.length - 1, aiCalls, mode });
}

/** Back one question (from the summary: back to the last question). */
export async function stepBack(businessId: string): Promise<void> {
  const row = await loadRow(businessId);
  if (!row || row.status === "approved") throw new KnowledgeError("Start the interview first.");
  const steps = readSteps(row.steps);
  if (row.status === "review") {
    await save(row, { status: "active", cursor: Math.max(0, steps.length - 1) });
    return;
  }
  await save(row, { cursor: Math.max(0, row.cursor - 1) });
}

/** The owner's edited summary becomes the company's brand voice (Business.marketingProfile), used by every writer. */
export async function approveProfile(businessId: string, summary: VoiceSummary): Promise<void> {
  const row = await loadRow(businessId);
  if (!row || row.status !== "review") throw new KnowledgeError("Finish the interview first.");
  const profile = marketingProfileFrom(summary, readSteps(row.steps));
  await prisma.$transaction([
    prisma.business.update({ where: { id: businessId }, data: { marketingProfile: profile as unknown as Prisma.InputJsonValue } }),
    prisma.marketingInterview.update({ where: { id: row.id }, data: { status: "approved", summary: summary as Prisma.InputJsonValue } }),
  ]);
}

/** Edits the approved profile in place (voice, rules, samples) without a new interview. */
export async function updateApprovedProfile(businessId: string, summary: VoiceSummary): Promise<void> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { marketingProfile: true } });
  const current = readMarketingProfile(business?.marketingProfile);
  if (!current) throw new KnowledgeError("Approve a brand voice first.");
  const profile: MarketingProfile = { ...current, ...summary, approvedAt: new Date().toISOString() };
  await prisma.business.update({ where: { id: businessId }, data: { marketingProfile: profile as unknown as Prisma.InputJsonValue } });
}
