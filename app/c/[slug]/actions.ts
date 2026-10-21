"use server";

import { revalidatePath } from "next/cache";
import { submitApplication } from "@/lib/creators/apply";
import { quickApply } from "@/lib/creators/quick-apply";
import type { ApplicationErrors } from "@/lib/creators/application";
import { logError } from "@/lib/errors";
import { requestIp } from "@/lib/request-limits";
import { getCurrentUser } from "@/lib/supabase/server";

export type ApplyState = { status: "idle" | "sent" | "error"; error?: string; errors?: ApplicationErrors; values?: Record<string, string> };

/** Public: a creator applies to a campaign (lib/creators/apply.ts: open campaigns only, limited per address). */
export async function applyAction(slug: string, _prev: ApplyState, formData: FormData): Promise<ApplyState> {
  // Bots fill in the hidden field; they get the same answer as a person, and nothing is saved.
  if (String(formData.get("website") ?? "")) return { status: "sent" };
  const values = Object.fromEntries([...formData.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")).map(([k, v]) => [k, String(v).slice(0, 1000)]));
  try {
    const result = await submitApplication(slug.toLowerCase(), formData, await requestIp());
    if (result.ok) return { status: "sent" };
    return { status: "error", error: result.error, errors: result.errors, values };
  } catch (error) {
    await logError(error, { source: "creators.apply" });
    return { status: "error", error: "We could not send your application. Please try again.", values };
  }
}

export type QuickApplyState = { status: "idle" | "sent" | "error"; error?: string; errors?: ApplicationErrors; incomplete?: boolean; values?: Record<string, string> };

/** A signed-in creator applies in one tap: their profile fills the application, they answer the company's questions. */
export async function quickApplyAction(slug: string, _prev: QuickApplyState, formData: FormData): Promise<QuickApplyState> {
  const user = await getCurrentUser();
  if (!user?.email_confirmed_at || !user.email) return { status: "error", error: "Sign in with your creator account first." };
  const values = Object.fromEntries([...formData.entries()].filter(([k, v]) => typeof v === "string" && k.startsWith("q_")).map(([k, v]) => [k, String(v).slice(0, 1000)]));
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
