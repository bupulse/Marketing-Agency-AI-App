"use server";

import { localParts, safeZone } from "@/lib/autopilot/timezone";
import { prisma } from "@/lib/db";
import { featureBlocked } from "@/lib/entitlements";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { knowledgeProgress } from "@/lib/knowledge/overview";
import { draftBusinessQuiz } from "@/lib/knowledge/quiz-ai";
import type { QuizDraft } from "@/lib/knowledge/quiz-draft";
import { overallPercent } from "@/lib/knowledge/sections";

/**
 * Knowledge base -> the Business info quiz (docs/QUIZ_MODE.md). The quiz saves through each section's own actions;
 * these two only read: the guesses at the start (one AI call, or the template) and the score at the end. Members may
 * play the rounds they can edit, so both follow the `content` permission.
 */
export async function draftQuiz(): Promise<Result<{ draft: QuizDraft }>> {
  return knowledgeAction({ permission: "content", source: "knowledge.quiz.draft" }, async ({ userId, businessId }) => {
    // The AI writes only for plans with AI writing; the template answers for the others, at no cost.
    const useAi = !(await featureBlocked(businessId, "content"));
    return { draft: await draftBusinessQuiz({ userId, businessId }, { useAi }) };
  });
}

/** The overall Business info %, recomputed after the quiz saved (the finish screen's score ring). */
export async function quizScore(): Promise<Result<{ percent: number }>> {
  return knowledgeAction({ permission: "content", source: "knowledge.quiz.score" }, async ({ businessId }) => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { id: true, name: true, website: true, industryId: true, industryOther: true, profile: true, knowledge: true, logoUrl: true, brandColors: true, tone: true, positioning: true, policies: true, marketingProfile: true, timezone: true },
    });
    const p = localParts(new Date(), safeZone(business.timezone));
    const today = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    return { percent: overallPercent(await knowledgeProgress(business, today)) };
  });
}
