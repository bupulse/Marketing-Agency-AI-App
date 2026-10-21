"use server";

import { submitApplication } from "@/lib/creators/apply";
import type { ApplicationErrors } from "@/lib/creators/application";
import { logError } from "@/lib/errors";
import { requestIp } from "@/lib/request-limits";

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
