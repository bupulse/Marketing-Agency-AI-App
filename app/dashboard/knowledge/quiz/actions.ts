"use server";

import { createPersona, updatePersona } from "@/app/dashboard/knowledge/audience/actions";
import { createCompetitor, savePositioning } from "@/app/dashboard/knowledge/competitors/actions";
import { createFaq, savePolicies } from "@/app/dashboard/knowledge/faqs/actions";
import { createProduct } from "@/app/dashboard/knowledge/products/actions";
import { localParts, safeZone } from "@/lib/autopilot/timezone";
import type { PersonaInput } from "@/lib/knowledge/audience";
import type { PositioningInput } from "@/lib/knowledge/competitors";
import type { FaqInput, PoliciesInput } from "@/lib/knowledge/policies";
import type { ProductInput } from "@/lib/knowledge/products";
import { prisma } from "@/lib/db";
import { featureBlocked } from "@/lib/entitlements";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { knowledgeProgress } from "@/lib/knowledge/overview";
import { draftBusinessQuiz } from "@/lib/knowledge/quiz-ai";
import type { QuizDraft } from "@/lib/knowledge/quiz-draft";
import { MAX_QUIZ_PRODUCTS } from "@/lib/knowledge/quiz-map";
import { overallPercent } from "@/lib/knowledge/sections";

/**
 * Knowledge base -> the Business info quiz (docs/QUIZ_MODE.md). The quiz saves through each section's own actions;
 * the two readers give the guesses at the start (one AI call, or the template) and the score at the end. Members may
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

// ---- A round's saves in one request ------------------------------------------------------------------------------
// The browser sends server actions one at a time, so a round with several items took one round trip each. These run
// the same section actions (each with its own checks, permission, plan feature and rate limit) side by side on the
// server, and return each one's result in order. Creates are safe in parallel: each takes the company's list lock.

const MAX_BATCH = 20;
const tooMany = { ok: false as const, error: "Too many at once. Please try again." };

export async function saveQuizProducts(inputs: ProductInput[]) {
  if (!Array.isArray(inputs) || inputs.length > MAX_QUIZ_PRODUCTS) return [tooMany];
  return Promise.all(inputs.map((input) => createProduct(input)));
}

export async function saveQuizPersonas(saves: { id?: string; input: PersonaInput }[]) {
  if (!Array.isArray(saves) || saves.length > 2) return [tooMany];
  return Promise.all(saves.map((s) => (s.id ? updatePersona(s.id, s.input) : createPersona(s.input))));
}

/** New competitors, then the positioning (null: unchanged). */
export async function saveQuizWhy(input: { competitors: string[]; positioning: PositioningInput | null }) {
  if (!Array.isArray(input?.competitors) || input.competitors.length > MAX_BATCH) return { competitors: [tooMany], positioning: null };
  const [competitors, positioning] = await Promise.all([Promise.all(input.competitors.map((name) => createCompetitor({ name }))), input.positioning ? savePositioning(input.positioning) : null]);
  return { competitors, positioning };
}

/** The policies (null: unchanged), then the new questions. */
export async function saveQuizRules(input: { policies: PoliciesInput | null; faqs: FaqInput[] }) {
  if (!Array.isArray(input?.faqs) || input.faqs.length > MAX_BATCH) return { policies: null, faqs: [tooMany] };
  const [policies, faqs] = await Promise.all([input.policies ? savePolicies(input.policies) : null, Promise.all(input.faqs.map((f) => createFaq(f)))]);
  return { policies, faqs };
}
