"use server";

import { redirect } from "next/navigation";
import { adminAction, actionMessage, finish } from "@/lib/admin/console";
import {
  createIndustryFromSuggestion,
  deleteIndustry,
  dismissIndustrySuggestion,
  restoreIndustrySuggestion,
  saveIndustry,
  setIndustryActive,
  setIndustryOrder,
  type IndustryInput,
} from "@/lib/admin/industries-service";

const BACK = "/admin/industries";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// Each action re-checks the admin (adminAction: allow-listed email, AAL2). Every change is audited.

function inputOf(f: FormData): IndustryInput {
  return {
    name: text(f, "name"),
    slug: text(f, "slug"),
    shortDescription: text(f, "shortDescription"),
    customers: text(f, "customers"),
    offerings: text(f, "offerings"),
    postIdeas: text(f, "postIdeas"),
    tone: text(f, "tone"),
    hashtags: text(f, "hashtags").split(/[\s,]+/).filter(Boolean),
    seasons: text(f, "seasons"),
    avoid: text(f, "avoid"),
    active: f.get("active") === "on",
    sortOrder: Number(text(f, "sortOrder") || 0),
  };
}

export type IndustryFormState = { error?: string };

/** Create or edit. On success the list opens with a notice; on a validation error the form stays with the message. */
export async function saveIndustryAction(_prev: IndustryFormState, f: FormData): Promise<IndustryFormState> {
  const ctx = await adminAction();
  const id = text(f, "id") || null;
  const suggestionKey = text(f, "suggestionKey");
  let notice: string;
  try {
    if (!id && suggestionKey) {
      const r = await createIndustryFromSuggestion(ctx, { ...inputOf(f), suggestionKey });
      notice = `${r.industry.name} created; ${r.moved} ${r.moved === 1 ? "company" : "companies"} moved to it.`;
    } else {
      const r = await saveIndustry(ctx, { ...inputOf(f), id });
      notice = `${r.name} saved.`;
    }
  } catch (e) {
    return { error: actionMessage(e) };
  }
  redirect(`${BACK}?notice=${encodeURIComponent(notice)}`);
}

export async function setIndustryActiveAction(f: FormData) {
  const ctx = await adminAction();
  const active = f.get("active") === "true";
  await finish(BACK, (r) => `${r.name} is ${active ? "offered at sign-up again" : "hidden from sign-up"}.`, () => setIndustryActive(ctx, { id: text(f, "id"), active }));
}

export async function setIndustryOrderAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, (r) => `${r.name}: order ${r.sortOrder}.`, () => setIndustryOrder(ctx, { id: text(f, "id"), sortOrder: Number(text(f, "sortOrder")) }));
}

export async function deleteIndustryAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, (r) => `${r.name} deleted.`, () => deleteIndustry(ctx, { id: text(f, "id") }));
}

export async function dismissSuggestionAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, (r) => `"${r.label}" dismissed.`, () => dismissIndustrySuggestion(ctx, { key: text(f, "key") }));
}

export async function restoreSuggestionAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, (r) => `"${r.label}" is back in the suggestions.`, () => restoreIndustrySuggestion(ctx, { key: text(f, "key") }));
}
