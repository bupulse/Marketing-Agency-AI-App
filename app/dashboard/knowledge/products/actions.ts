"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { fieldErrorMap, productInputSchema, ITEM_STATUSES, type ProductInput } from "@/lib/knowledge/products";
import { createProduct as create, deleteProduct as remove, duplicateProduct as duplicate, setProductStatus, updateProduct as update } from "@/lib/knowledge/service";

const id = z.string().min(1).max(60);
const BASE = "/dashboard/knowledge/products";

function refresh(productId?: string) {
  revalidatePath(BASE);
  revalidatePath("/dashboard/knowledge");
  if (productId) revalidatePath(`${BASE}/${productId}`);
  revalidatePath("/dashboard/content");
}

function invalid(input: unknown) {
  const parsed = productInputSchema.safeParse(input);
  return parsed.success ? { data: parsed.data } : { failure: { ok: false as const, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) } };
}

/** Creates a product. The form checks the same schema first; this is the authority. */
export async function createProduct(input: ProductInput): Promise<Result<{ productId: string }>> {
  const checked = invalid(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "projectCreate", source: "knowledge.product.create" }, async ({ businessId }) => ({ productId: await create(businessId, checked.data) }));
  if (result.ok) refresh(result.productId);
  return result;
}

export async function updateProduct(productId: string, input: ProductInput): Promise<Result<{ productId: string }>> {
  if (!id.safeParse(productId).success) return { ok: false, error: "We could not find that product." };
  const checked = invalid(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.product.update" }, async ({ businessId }) => {
    await update(businessId, productId, checked.data);
    return { productId };
  });
  if (result.ok) refresh(productId);
  return result;
}

/** Archive (hidden from lists, pickers and Autopilot, kept with its content) or bring back as active or draft. */
export async function changeProductStatus(productId: string, status: string): Promise<Result> {
  const parsed = z.object({ id, status: z.enum(ITEM_STATUSES) }).safeParse({ id: productId, status });
  if (!parsed.success) return { ok: false, error: "We could not change that." };
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.product.status" }, async ({ businessId }) => {
    await setProductStatus(businessId, parsed.data.id, parsed.data.status);
    return {};
  });
  if (result.ok) refresh(productId);
  return result;
}

export async function duplicateProduct(productId: string): Promise<Result<{ productId: string }>> {
  if (!id.safeParse(productId).success) return { ok: false, error: "We could not find that product." };
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "projectCreate", source: "knowledge.product.duplicate" }, async ({ businessId }) => ({ productId: await duplicate(businessId, productId) }));
  if (result.ok) refresh(result.productId);
  return result;
}

/** Deletes the product and its written content; its photos stay in the gallery. */
export async function deleteProduct(productId: string): Promise<Result> {
  if (!id.safeParse(productId).success) return { ok: false, error: "We could not find that product." };
  // Not feature-gated: removing your own data always works (tests/features/keep-your-data.test.ts).
  const result = await knowledgeAction({ permission: "content", limit: "knowledgeEdit", source: "knowledge.product.delete" }, async ({ businessId }) => {
    await remove(businessId, productId);
    return {};
  });
  if (result.ok) refresh();
  return result;
}
