"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { answerInputSchema, OTHER_MAX, summarySchema, type AnswerInput, type VoiceSummaryInput } from "@/lib/knowledge/interview";
import { answerStep, approveProfile, InterviewInProgressError, saveQuizVoice, startInterview as start, stepBack, updateApprovedProfile } from "@/lib/knowledge/interview-service";
import { fieldErrorMap } from "@/lib/knowledge/products";

/**
 * Knowledge base -> Digital marketing profile (the AI interview). The brand voice is a company setting: the
 * `settings` permission (Owner, Admin), like Brand, and the `content` plan feature (the interview calls the AI, like
 * Studio). AI calls are limited inside the service (interviewAi, MAX_AI_CALLS_PER_DAY, the company's allowance).
 */
function refresh() {
  revalidatePath("/dashboard/knowledge/interview");
  revalidatePath("/dashboard/knowledge");
}

/** Starts the interview; over one in progress only with `startOver` (the page asks first). */
export async function startInterview(opts: { startOver?: boolean } = {}): Promise<Result & { needsConfirm?: boolean }> {
  let inProgress = false;
  const result = await knowledgeAction({ permission: "settings", feature: "content", limit: "interviewStep", source: "knowledge.interview.start" }, async ({ businessId }) => {
    try {
      await start(businessId, { confirm: opts?.startOver === true });
    } catch (error) {
      if (error instanceof InterviewInProgressError) inProgress = true;
      throw error;
    }
    return {};
  });
  if (result.ok) refresh();
  return inProgress ? { ...result, needsConfirm: true } : result;
}

export async function answerQuestion(input: AnswerInput & { skip?: boolean }): Promise<Result> {
  const parsed = answerInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your answer." };
  const result = await knowledgeAction({ permission: "settings", feature: "content", limit: "interviewStep", source: "knowledge.interview.answer" }, async (ctx) => {
    await answerStep(ctx, { ...parsed.data, skip: input.skip === true });
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function previousQuestion(): Promise<Result> {
  const result = await knowledgeAction({ permission: "settings", feature: "content", limit: "interviewStep", source: "knowledge.interview.back" }, async ({ businessId }) => {
    await stepBack(businessId);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

/** The this-or-that answers of the Business info quiz, kept with the voice it approves. */
const quizAnswersSchema = z.array(z.object({ topic: z.enum(["formality", "emojis", "followup"]), answer: z.string().trim().min(1).max(OTHER_MAX) })).max(5).default([]);

/**
 * Approves the summary the owner edited (after the interview), saves edits to the approved one (`edit`), or approves
 * the voice picked in the Business info quiz (`quiz`, no interview needed) with its this-or-that answers.
 */
export async function approveVoice(input: VoiceSummaryInput, mode: "approve" | "edit" | "quiz" = "approve", quizAnswers: { topic: string; answer: string }[] = []): Promise<Result> {
  const parsed = summarySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) };
  const answers = quizAnswersSchema.safeParse(quizAnswers);
  if (!answers.success) return { ok: false, error: "Check your answers." };
  const result = await knowledgeAction({ permission: "settings", feature: "content", limit: "interviewStep", source: "knowledge.interview.approve" }, async ({ businessId }) => {
    if (mode === "edit") await updateApprovedProfile(businessId, parsed.data);
    else if (mode === "quiz") await saveQuizVoice(businessId, parsed.data, answers.data);
    else await approveProfile(businessId, parsed.data);
    return {};
  });
  if (result.ok) {
    refresh();
    revalidatePath("/dashboard/brand");
  }
  return result;
}
