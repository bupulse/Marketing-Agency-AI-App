"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { saveKnowledge } from "@/app/onboarding/actions";
import { approveVoice } from "@/app/dashboard/knowledge/interview/actions";
import { saveProfile } from "@/app/dashboard/knowledge/profile/actions";
import { createReview } from "@/app/dashboard/knowledge/reviews/actions";
import { localParts, safeZone } from "@/lib/autopilot/timezone";
import type { KnowledgeInput } from "@/lib/brand/schemas";
import { prisma } from "@/lib/db";
import { featureBlocked } from "@/lib/entitlements";
import { personaInputSchema, type PersonaInput } from "@/lib/knowledge/audience";
import { competitorInputSchema, positioningSchema, type PositioningInput } from "@/lib/knowledge/competitors";
import { knowledgeAction, type Failure, type Result } from "@/lib/knowledge/guard";
import type { VoiceSummaryInput } from "@/lib/knowledge/interview";
import { knowledgeProgress } from "@/lib/knowledge/overview";
import { faqInputSchema, policiesSchema, type FaqInput, type PoliciesInput } from "@/lib/knowledge/policies";
import { fieldErrorMap, productInputSchema, type ProductInput } from "@/lib/knowledge/products";
import type { ProfileInput } from "@/lib/knowledge/profile";
import { draftBusinessQuiz } from "@/lib/knowledge/quiz-ai";
import type { QuizDraft } from "@/lib/knowledge/quiz-draft";
import { MAX_QUIZ_PRODUCTS } from "@/lib/knowledge/quiz-map";
import { createCompetitors, createFaqs, createPersona, savePolicies as savePoliciesRow, savePositioning as savePositioningRow, updatePersona } from "@/lib/knowledge/records";
import type { ReviewInput } from "@/lib/knowledge/reviews";
import { overallPercent } from "@/lib/knowledge/sections";
import { createProducts } from "@/lib/knowledge/service";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

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

// ---- One request per round ---------------------------------------------------------------------------------------
// Each server action is a round trip of its own (the browser sends them one at a time), and a round used to send one
// per item. saveQuizRound does a whole round in one request: the same schemas as the section actions, then the same
// lib/knowledge services through knowledgeAction with the section's permission, plan feature and rate limits (one hit
// per item, as the section actions count), the rows written together, and one revalidation for the round. Rounds with
// one write call their section's action. A failure names the first failing item (`item`, `part`) and its fields.

export type QuizRoundPayload =
  | { round: "you"; profile: ProfileInput }
  | { round: "sell"; products: ProductInput[] }
  | { round: "customers"; personas: { id?: string; input: PersonaInput }[] }
  | { round: "why"; competitors: string[]; positioning: PositioningInput | null }
  | { round: "rules"; policies: PoliciesInput | null; faqs: FaqInput[] }
  | { round: "find"; knowledge: KnowledgeInput }
  | { round: "voice"; summary: VoiceSummaryInput; answers: { topic: string; answer: string }[] }
  | { round: "love"; review: ReviewInput };

/** `ids`: the personas saved, in the order sent (a new one's id, so the quiz updates it if played again). */
export type QuizRoundResult = { ok: true; ids?: string[] } | (Failure & { item?: number; part?: "competitors" | "positioning" | "policies" | "faqs" });

const CHECK = "Check the highlighted fields.";
const TOO_MANY: QuizRoundResult = { ok: false, error: "Too many at once. Please try again." };
const MAX_BATCH = 20;
const personaId = z.string().min(1).max(60);

function parseAll<S extends z.ZodType>(schema: S, list: unknown[], part?: "competitors" | "faqs"): { data: z.output<S>[] } | { failure: QuizRoundResult } {
  const data: z.output<S>[] = [];
  for (const [item, raw] of list.entries()) {
    const r = schema.safeParse(raw);
    if (!r.success) return { failure: { ok: false, error: CHECK, fieldErrors: fieldErrorMap(r.error), item, ...(part ? { part } : {}) } };
    data.push(r.data);
  }
  return { data };
}

function refresh(...paths: string[]) {
  for (const path of ["/dashboard/knowledge", ...paths]) revalidatePath(path);
}

const hits = (key: string, rule: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS], n: number) => Promise.all(Array.from({ length: n }, () => rateLimit(key, rule)));

export async function saveQuizRound(payload: QuizRoundPayload): Promise<QuizRoundResult> {
  switch (payload?.round) {
    case "you":
      return saveProfile(payload.profile);
    case "find": {
      const r = await saveKnowledge(payload.knowledge);
      return r.ok ? r : { ok: false, error: r.error ?? CHECK, fieldErrors: r.fieldErrors };
    }
    case "voice":
      return approveVoice(payload.summary, "quiz", payload.answers);
    case "love":
      return createReview(payload.review);

    case "sell": {
      if (!Array.isArray(payload.products) || payload.products.length > MAX_QUIZ_PRODUCTS) return TOO_MANY;
      const parsed = parseAll(productInputSchema, payload.products);
      if ("failure" in parsed) return parsed.failure;
      const r = await knowledgeAction({ permission: "content", feature: "content", source: "knowledge.quiz.products" }, async ({ userId, businessId }) => {
        await hits(`projectCreate:${userId}`, RATE_LIMITS.projectCreate, parsed.data.length);
        await createProducts(businessId, parsed.data);
        return {};
      });
      if (r.ok) refresh("/dashboard/knowledge/products", "/dashboard/content");
      return r;
    }

    case "customers": {
      if (!Array.isArray(payload.personas) || payload.personas.length > 2) return TOO_MANY;
      if (payload.personas.some((p) => p?.id !== undefined && !personaId.safeParse(p.id).success)) return { ok: false, error: "We could not find that persona." };
      const parsed = parseAll(personaInputSchema, payload.personas.map((p) => p?.input));
      if ("failure" in parsed) return parsed.failure;
      const saves = payload.personas.map((p, i) => ({ id: p.id, data: parsed.data[i] }));
      const r = await knowledgeAction({ permission: "content", feature: "content", source: "knowledge.quiz.personas" }, async ({ userId, businessId }) => {
        const creates = saves.filter((s) => !s.id).length;
        await Promise.all([hits(`knowledgeCreate:${userId}`, RATE_LIMITS.knowledgeCreate, creates), hits(`knowledgeEdit:${userId}`, RATE_LIMITS.knowledgeEdit, saves.length - creates)]);
        const ids = await Promise.all(saves.map((s) => (s.id ? updatePersona(businessId, s.id, s.data).then(() => s.id!) : createPersona(businessId, s.data))));
        return { ids };
      });
      if (r.ok) refresh("/dashboard/knowledge/audience");
      return r;
    }

    case "why": {
      if (!Array.isArray(payload.competitors) || payload.competitors.length > MAX_BATCH) return TOO_MANY;
      const parsed = parseAll(competitorInputSchema, payload.competitors.map((name) => ({ name })), "competitors");
      if ("failure" in parsed) return parsed.failure;
      const positioning = payload.positioning ? positioningSchema.safeParse(payload.positioning) : null;
      if (positioning && !positioning.success) return { ok: false, error: CHECK, fieldErrors: fieldErrorMap(positioning.error), part: "positioning" };
      const r = await knowledgeAction({ permission: "content", feature: "content", source: "knowledge.quiz.why" }, async ({ userId, businessId }) => {
        await Promise.all([hits(`knowledgeCreate:${userId}`, RATE_LIMITS.knowledgeCreate, parsed.data.length), hits(`knowledgeEdit:${userId}`, RATE_LIMITS.knowledgeEdit, positioning ? 1 : 0)]);
        await Promise.all([createCompetitors(businessId, parsed.data), positioning?.success ? savePositioningRow(businessId, positioning.data) : null]);
        return {};
      });
      if (r.ok) refresh("/dashboard/knowledge/competitors");
      return r;
    }

    case "rules": {
      if (!Array.isArray(payload.faqs) || payload.faqs.length > MAX_BATCH) return TOO_MANY;
      const parsed = parseAll(faqInputSchema, payload.faqs, "faqs");
      if ("failure" in parsed) return parsed.failure;
      const policies = payload.policies ? policiesSchema.safeParse(payload.policies) : null;
      if (policies && !policies.success) return { ok: false, error: CHECK, fieldErrors: fieldErrorMap(policies.error), part: "policies" };
      // FAQs and policies are public-facing: the `settings` permission and no plan feature, like their section.
      const r = await knowledgeAction({ permission: "settings", source: "knowledge.quiz.rules" }, async ({ userId, businessId }) => {
        await Promise.all([hits(`knowledgeCreate:${userId}`, RATE_LIMITS.knowledgeCreate, parsed.data.length), hits(`profileSave:${userId}`, RATE_LIMITS.profileSave, policies ? 1 : 0)]);
        await Promise.all([createFaqs(businessId, parsed.data), policies?.success ? savePoliciesRow(businessId, policies.data) : null]);
        return {};
      });
      if (r.ok) refresh("/dashboard/knowledge/faqs");
      return r;
    }
  }
  return { ok: false, error: "We could not save that. Please try again." };
}
