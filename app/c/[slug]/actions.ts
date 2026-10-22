"use server";

import { revalidatePath } from "next/cache";
import { startApplicationUpload, submitApplication, type ApplicationUpload } from "@/lib/creators/apply";
import { quickApply } from "@/lib/creators/quick-apply";
import type { ApplicationErrors } from "@/lib/creators/application";
import { logError } from "@/lib/errors";
import { requestIp } from "@/lib/request-limits";
import { getCurrentUser } from "@/lib/supabase/server";

export type FormValues = Record<string, string | string[]>;
export type ApplyState = { status: "idle" | "sent" | "error"; error?: string; errors?: ApplicationErrors; values?: FormValues };

/** What was typed, to put back in the form after an error: one value per name, several for choices ticked. */
function valuesOf(formData: FormData, keep: (name: string) => boolean): FormValues {
  const out: FormValues = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string" || k.startsWith("$") || !keep(k)) continue;
    const value = v.slice(0, 1000);
    const before = out[k];
    out[k] = before === undefined ? value : Array.isArray(before) ? [...before, value] : [before, value];
  }
  return out;
}

/** Public: a creator applies to a campaign (lib/creators/apply.ts: open campaigns only, limited per address). */
export async function applyAction(slug: string, _prev: ApplyState, formData: FormData): Promise<ApplyState> {
  // Bots fill in the hidden field; they get the same answer as a person, and nothing is saved.
  if (String(formData.get("website") ?? "")) return { status: "sent" };
  const values = valuesOf(formData, () => true);
  try {
    const result = await submitApplication(slug.toLowerCase(), formData, await requestIp());
    if (result.ok) return { status: "sent" };
    return { status: "error", error: result.error, errors: result.errors, values };
  } catch (error) {
    await logError(error, { source: "creators.apply" });
    return { status: "error", error: "We could not send your application. Please try again.", values };
  }
}

export type QuickApplyState = { status: "idle" | "sent" | "error"; error?: string; errors?: ApplicationErrors; incomplete?: boolean; values?: FormValues };

/** A signed-in creator applies in one tap: their profile fills the application, they answer the company's questions. */
export async function quickApplyAction(slug: string, _prev: QuickApplyState, formData: FormData): Promise<QuickApplyState> {
  const user = await getCurrentUser();
  if (!user?.email_confirmed_at || !user.email) return { status: "error", error: "Sign in with your creator account first." };
  const values = valuesOf(formData, () => true);
  try {
    const result = await quickApply({ userId: user.id, email: user.email }, slug.toLowerCase(), formData);
    if (result.ok) {
      revalidatePath("/creator");
      return { status: "sent" };
    }
    return { status: "error", error: result.error, errors: result.errors, incomplete: result.incomplete, values };
  } catch (error) {
    await logError(error, { source: "creators.quick-apply" });
    return { status: "error", error: "We could not send your application. Please try again.", values };
  }
}

/**
 * Public: a signed upload URL for one file of an application's upload question (lib/creators/apply.ts: live campaigns
 * taking applications only, photos and videos as the question accepts, 50 MB at most, limited per address and campaign).
 */
export async function startApplicationUploadAction(slug: string, fieldId: string, file: { type: string; size: number }): Promise<ApplicationUpload> {
  try {
    return await startApplicationUpload(slug.toLowerCase(), String(fieldId).slice(0, 40), { type: String(file?.type ?? "").slice(0, 60), size: Number(file?.size ?? 0) }, await requestIp());
  } catch (error) {
    await logError(error, { source: "creators.apply-upload" });
    return { ok: false, error: "The upload could not start. Please try again." };
  }
}
