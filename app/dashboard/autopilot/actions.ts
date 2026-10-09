"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { approveAll, regenerateGroup, removeGroup, saveSettings } from "@/lib/autopilot/manage";
import { runAutopilotForUser } from "@/lib/autopilot/run";
import type { SettingsInput } from "@/lib/autopilot/settings";
import { rateLimit, rateLimitMessage, RateLimitError, type RateLimitRule } from "@/lib/rate-limit";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

// Planning and regenerating call the AI, so they have tighter limits than editing the plan.
const LIMITS = {
  plan: { limit: 6, windowSeconds: 60 * 60 },
  regenerate: { limit: 30, windowSeconds: 60 * 60 },
  edit: { limit: 120, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

async function limited(userId: string, kind: keyof typeof LIMITS): Promise<string | null> {
  try {
    await rateLimit(`autopilot:${kind}:${userId}`, LIMITS[kind]);
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitMessage(error);
    throw error;
  }
}

const done = () => revalidatePath("/dashboard/autopilot");

export async function saveAutopilotSettings(input: SettingsInput): Promise<ActionResult> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("autopilotSettings", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
  const blocked = await limited(user.id, "edit");
  if (blocked) return { ok: false, error: blocked };
  const result = await saveSettings(user.id, input);
  if (result.ok) done();
  return result.ok ? { ok: true } : result;
}

export async function planNextWeek(): Promise<ActionResult> {
  const user = await requireActiveUser();
  const blocked = await limited(user.id, "plan");
  if (blocked) return { ok: false, error: blocked };
  const result = await runAutopilotForUser(user.id);
  done();
  switch (result.status) {
    case "planned":
      return { ok: true, message: `Next week is planned: ${result.groupCount} ${result.groupCount === 1 ? "idea" : "ideas"}, ${result.postCount} ${result.postCount === 1 ? "post" : "posts"}.${result.note ? ` ${result.note}` : ""}` };
    case "already_planned":
      return { ok: true, message: "Next week is already planned." };
    default:
      return { ok: false, error: result.note ?? "Autopilot could not plan next week this time." };
  }
}

export async function approveAllPosts(): Promise<ActionResult> {
  const user = await requireActiveUser();
  const blocked = await limited(user.id, "edit");
  if (blocked) return { ok: false, error: blocked };
  const result = await approveAll(user.id);
  done();
  if (!result.ok) return result;
  return { ok: true, message: result.approved === 0 ? "There was nothing to approve." : `Approved ${result.approved} ${result.approved === 1 ? "post" : "posts"}. They will go out at their times.` };
}

export async function removePlannedPost(groupId: string): Promise<ActionResult> {
  const user = await requireActiveUser();
  if (typeof groupId !== "string" || groupId.length === 0 || groupId.length > 80) return { ok: false, error: "That post could not be found." };
  const blocked = await limited(user.id, "edit");
  if (blocked) return { ok: false, error: blocked };
  const result = await removeGroup(user.id, groupId);
  done();
  return result.ok ? { ok: true, message: "Removed." } : result;
}

export async function regeneratePlannedPost(groupId: string): Promise<ActionResult> {
  const user = await requireActiveUser();
  if (typeof groupId !== "string" || groupId.length === 0 || groupId.length > 80) return { ok: false, error: "That post could not be found." };
  const blocked = await limited(user.id, "regenerate");
  if (blocked) return { ok: false, error: blocked };
  const result = await regenerateGroup(user.id, groupId);
  done();
  return result.ok ? { ok: true, message: "Written again." } : result;
}
