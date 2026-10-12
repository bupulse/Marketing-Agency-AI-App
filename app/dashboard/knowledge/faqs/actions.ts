"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { faqInputSchema, policiesSchema, type FaqInput, type PoliciesInput } from "@/lib/knowledge/policies";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { createFaq as create, deleteListItem, reorderList, savePolicies as save, updateFaq as update } from "@/lib/knowledge/records";

/**
 * Knowledge base -> FAQs & policies. Both are public-facing (the website chat gives them to visitors as the company's
 * own answers and rules), so both need the `settings` permission (Owner, Admin), like the company profile; Members
 * see them read-only. No plan feature, like the profile and the business info card.
 */
const id = z.string().min(1).max(60);
const ids = z.array(id).max(250);

function refresh() {
  revalidatePath("/dashboard/knowledge/faqs");
  revalidatePath("/dashboard/knowledge");
}

function check(input: unknown) {
  const parsed = faqInputSchema.safeParse(input);
  return parsed.success ? { data: parsed.data } : { failure: { ok: false as const, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) } };
}

export async function createFaq(input: FaqInput): Promise<Result<{ faqId: string }>> {
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "settings", limit: "knowledgeCreate", source: "knowledge.faq.create" }, async ({ businessId }) => ({ faqId: await create(businessId, checked.data) }));
  if (result.ok) refresh();
  return result;
}

export async function updateFaq(faqId: string, input: FaqInput): Promise<Result> {
  if (!id.safeParse(faqId).success) return { ok: false, error: "We could not find that question." };
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "settings", limit: "knowledgeEdit", source: "knowledge.faq.update" }, async ({ businessId }) => {
    await update(businessId, faqId, checked.data);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function deleteFaq(faqId: string): Promise<Result> {
  if (!id.safeParse(faqId).success) return { ok: false, error: "We could not find that question." };
  const result = await knowledgeAction({ permission: "settings", limit: "knowledgeEdit", source: "knowledge.faq.delete" }, async ({ businessId }) => {
    await deleteListItem("faq", businessId, faqId);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function reorderFaqs(order: string[]): Promise<Result> {
  const parsed = ids.safeParse(order);
  if (!parsed.success) return { ok: false, error: "We could not change the order." };
  const result = await knowledgeAction({ permission: "settings", limit: "knowledgeEdit", source: "knowledge.faq.reorder" }, async ({ businessId }) => {
    await reorderList("faq", businessId, parsed.data);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function savePolicies(input: PoliciesInput): Promise<Result> {
  const parsed = policiesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) };
  const result = await knowledgeAction({ permission: "settings", limit: "profileSave", source: "knowledge.policies" }, async ({ businessId }) => {
    await save(businessId, parsed.data);
    return {};
  });
  if (result.ok) refresh();
  return result;
}
