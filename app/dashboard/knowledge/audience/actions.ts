"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audienceNotesSchema, personaInputSchema, type PersonaInput } from "@/lib/knowledge/audience";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { createPersona as create, deleteListItem, reorderList, saveAudienceNotes as saveNotes, updatePersona as update } from "@/lib/knowledge/records";

/** Knowledge base -> Customers & audience. The `content` permission, like products (Members too). */
const id = z.string().min(1).max(60);
const ids = z.array(id).max(100);

function refresh() {
  revalidatePath("/dashboard/knowledge/audience");
  revalidatePath("/dashboard/knowledge");
}

function check(input: unknown) {
  const parsed = personaInputSchema.safeParse(input);
  return parsed.success ? { data: parsed.data } : { failure: { ok: false as const, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) } };
}

export async function createPersona(input: PersonaInput): Promise<Result<{ personaId: string }>> {
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeCreate", source: "knowledge.persona.create" }, async ({ businessId }) => ({ personaId: await create(businessId, checked.data) }));
  if (result.ok) refresh();
  return result;
}

export async function updatePersona(personaId: string, input: PersonaInput): Promise<Result> {
  if (!id.safeParse(personaId).success) return { ok: false, error: "We could not find that persona." };
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.persona.update" }, async ({ businessId }) => {
    await update(businessId, personaId, checked.data);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function deletePersona(personaId: string): Promise<Result> {
  if (!id.safeParse(personaId).success) return { ok: false, error: "We could not find that persona." };
  const result = await knowledgeAction({ permission: "content", limit: "knowledgeEdit", source: "knowledge.persona.delete" }, async ({ businessId }) => {
    await deleteListItem("persona", businessId, personaId);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function reorderPersonas(order: string[]): Promise<Result> {
  const parsed = ids.safeParse(order);
  if (!parsed.success) return { ok: false, error: "We could not change the order." };
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.persona.reorder" }, async ({ businessId }) => {
    await reorderList("persona", businessId, parsed.data);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function saveAudienceNotes(input: { notes: string }): Promise<Result> {
  const parsed = audienceNotesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) };
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.audience.notes" }, async ({ businessId }) => {
    await saveNotes(businessId, parsed.data.notes);
    return {};
  });
  if (result.ok) refresh();
  return result;
}
