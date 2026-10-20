"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import { ForbiddenError } from "@/lib/team/roles";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { GraphProblem } from "@/lib/automations/graph";
import { AutomationError, createAutomation, duplicate, publish, remove, saveDraft, setPaused } from "@/lib/automations/service";

export type AutomationActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; problems?: GraphProblem[] };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

/** Changing automations needs the `automations` permission (Owner, Admin) and the feature in the plan. */
async function editor({ gated = true } = {}) {
  const user = await requireActiveUser("automations", "throw");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) throw new AutomationError("not_found", "Finish setting up your business first.");
  if (gated) await assertFeature(business.id, "automations");
  return { actorId: user.actorId, businessId: business.id };
}

async function guarded<T extends object>(run: () => Promise<T>): Promise<AutomationActionResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    if (error instanceof Error && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
    if (error instanceof AutomationError) return { ok: false, error: error.message, problems: error.problems.length ? error.problems : undefined };
    if (error instanceof ForbiddenError || error instanceof FeatureRequiredError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    console.error("[automations.actions]", error instanceof Error ? error.message : error);
    return { ok: false, error: GENERIC };
  }
}

const id = z.string().min(1).max(60);

export async function create(templateKey: string | null) {
  return guarded(async () => {
    const { businessId, actorId } = await editor();
    await rateLimit(`automations:create:${actorId}`, { limit: 30, windowSeconds: 3600 });
    const newId = await createAutomation(businessId, actorId, templateKey ? z.string().max(40).parse(templateKey) : null);
    revalidatePath("/dashboard/automations");
    return { id: newId };
  });
}

export async function save(automationId: string, name: string, graph: unknown) {
  return guarded(async () => {
    const { businessId } = await editor();
    await saveDraft(businessId, id.parse(automationId), { name: z.string().max(200).parse(name), graph });
    return {};
  });
}

export async function publishAutomation(automationId: string) {
  return guarded(async () => {
    const { businessId } = await editor();
    await publish(businessId, id.parse(automationId));
    revalidatePath("/dashboard/automations");
    return {};
  });
}

export async function pause(automationId: string, paused: boolean) {
  return guarded(async () => {
    // Pausing works without the feature, so an owner who lost it can still stop what runs.
    const { businessId } = await editor({ gated: !paused });
    await setPaused(businessId, id.parse(automationId), paused);
    revalidatePath("/dashboard/automations");
    return {};
  });
}

export async function copy(automationId: string) {
  return guarded(async () => {
    const { businessId, actorId } = await editor();
    const newId = await duplicate(businessId, actorId, id.parse(automationId));
    revalidatePath("/dashboard/automations");
    return { id: newId };
  });
}

export async function destroy(automationId: string) {
  return guarded(async () => {
    const { businessId } = await editor({ gated: false });
    await remove(businessId, id.parse(automationId));
    revalidatePath("/dashboard/automations");
    return {};
  });
}
