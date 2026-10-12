"use server";

import { revalidatePath } from "next/cache";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { answerInputSchema, summarySchema, type AnswerInput, type VoiceSummaryInput } from "@/lib/knowledge/interview";
import { answerStep, approveProfile, InterviewInProgressError, startInterview as start, stepBack, updateApprovedProfile } from "@/lib/knowledge/interview-service";
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

/** Approves the summary the owner edited (after the interview), or saves edits to the approved one (`edit`). */
export async function approveVoice(input: VoiceSummaryInput, mode: "approve" | "edit" = "approve"): Promise<Result> {
  const parsed = summarySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) };
  const result = await knowledgeAction({ permission: "settings", feature: "content", limit: "interviewStep", source: "knowledge.interview.approve" }, async ({ businessId }) => {
    if (mode === "edit") await updateApprovedProfile(businessId, parsed.data);
    else await approveProfile(businessId, parsed.data);
    return {};
  });
  if (result.ok) {
    refresh();
    revalidatePath("/dashboard/brand");
  }
  return result;
}
