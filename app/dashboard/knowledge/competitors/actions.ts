"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { competitorInputSchema, positioningSchema, type CompetitorInput, type PositioningInput } from "@/lib/knowledge/competitors";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { createCompetitor as create, deleteListItem, reorderList, savePositioning as save, updateCompetitor as update } from "@/lib/knowledge/records";

/** Knowledge base -> Competitors & what makes you different. The `content` permission (Members too). */
const id = z.string().min(1).max(60);
const ids = z.array(id).max(100);

function refresh() {
  revalidatePath("/dashboard/knowledge/competitors");
  revalidatePath("/dashboard/knowledge");
}

function check(input: unknown) {
  const parsed = competitorInputSchema.safeParse(input);
  return parsed.success ? { data: parsed.data } : { failure: { ok: false as const, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) } };
}

export async function createCompetitor(input: CompetitorInput): Promise<Result<{ competitorId: string }>> {
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeCreate", source: "knowledge.competitor.create" }, async ({ businessId }) => ({ competitorId: await create(businessId, checked.data) }));
  if (result.ok) refresh();
  return result;
}

export async function updateCompetitor(competitorId: string, input: CompetitorInput): Promise<Result> {
  if (!id.safeParse(competitorId).success) return { ok: false, error: "We could not find that competitor." };
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.competitor.update" }, async ({ businessId }) => {
    await update(businessId, competitorId, checked.data);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function deleteCompetitor(competitorId: string): Promise<Result> {
  if (!id.safeParse(competitorId).success) return { ok: false, error: "We could not find that competitor." };
  const result = await knowledgeAction({ permission: "content", limit: "knowledgeEdit", source: "knowledge.competitor.delete" }, async ({ businessId }) => {
    await deleteListItem("competitor", businessId, competitorId);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function reorderCompetitors(order: string[]): Promise<Result> {
  const parsed = ids.safeParse(order);
  if (!parsed.success) return { ok: false, error: "We could not change the order." };
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.competitor.reorder" }, async ({ businessId }) => {
    await reorderList("competitor", businessId, parsed.data);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function savePositioning(input: PositioningInput): Promise<Result> {
  const parsed = positioningSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) };
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.positioning" }, async ({ businessId }) => {
    await save(businessId, parsed.data);
    return {};
  });
  if (result.ok) refresh();
  return result;
}
