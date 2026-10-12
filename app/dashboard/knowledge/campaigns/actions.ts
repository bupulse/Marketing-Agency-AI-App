"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { campaignInputSchema, type CampaignInput } from "@/lib/knowledge/campaigns";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { ITEM_STATUSES, fieldErrorMap } from "@/lib/knowledge/products";
import { createCampaign as create, deleteCampaign as remove, setCampaignStatus, updateCampaign as update } from "@/lib/knowledge/service";

const id = z.string().min(1).max(60);
const BASE = "/dashboard/knowledge/campaigns";

function refresh(campaignId?: string) {
  revalidatePath(BASE);
  revalidatePath("/dashboard/knowledge");
  if (campaignId) revalidatePath(`${BASE}/${campaignId}`);
  revalidatePath("/dashboard/content");
}

function check(input: unknown) {
  const parsed = campaignInputSchema.safeParse(input);
  return parsed.success ? { data: parsed.data } : { failure: { ok: false as const, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) } };
}

export async function createCampaign(input: CampaignInput): Promise<Result<{ campaignId: string }>> {
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "projectCreate", source: "knowledge.campaign.create" }, async ({ businessId }) => ({ campaignId: await create(businessId, checked.data) }));
  if (result.ok) refresh(result.campaignId);
  return result;
}

export async function updateCampaign(campaignId: string, input: CampaignInput): Promise<Result<{ campaignId: string }>> {
  if (!id.safeParse(campaignId).success) return { ok: false, error: "We could not find that campaign." };
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.campaign.update" }, async ({ businessId }) => {
    await update(businessId, campaignId, checked.data);
    return { campaignId };
  });
  if (result.ok) refresh(campaignId);
  return result;
}

export async function changeCampaignStatus(campaignId: string, status: string): Promise<Result> {
  const parsed = z.object({ id, status: z.enum(ITEM_STATUSES) }).safeParse({ id: campaignId, status });
  if (!parsed.success) return { ok: false, error: "We could not change that." };
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.campaign.status" }, async ({ businessId }) => {
    await setCampaignStatus(businessId, parsed.data.id, parsed.data.status);
    return {};
  });
  if (result.ok) refresh(campaignId);
  return result;
}

/** Deletes the campaign and its written content. Linked products and photos stay. */
export async function deleteCampaign(campaignId: string): Promise<Result> {
  if (!id.safeParse(campaignId).success) return { ok: false, error: "We could not find that campaign." };
  const result = await knowledgeAction({ permission: "content", limit: "knowledgeEdit", source: "knowledge.campaign.delete" }, async ({ businessId }) => {
    await remove(businessId, campaignId);
    return {};
  });
  if (result.ok) refresh();
  return result;
}
