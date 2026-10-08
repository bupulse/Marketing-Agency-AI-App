"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { businessHasApiAccess } from "@/lib/api/auth";
import { ApiKeyError, createApiKey, revokeApiKey } from "@/lib/api/keys";
import { prisma } from "@/lib/db";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";

export type ApiKeyActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function owner() {
  const user = await requireActiveUser();
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) throw new ApiKeyError("not_found", "Finish setting up your business first.");
  return { userId: user.id, businessId: business.id };
}

async function guarded<T extends object>(run: () => Promise<T>): Promise<ApiKeyActionResult<T>> {
  try {
    const value = await run();
    revalidatePath("/dashboard/connectors/api");
    return { ok: true, ...value };
  } catch (error) {
    if (error instanceof ApiKeyError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    if (error && typeof error === "object" && "digest" in error) throw error; // redirects from requireActiveUser
    console.error("[api-keys] action failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Nothing was changed. Please try again." };
  }
}

export async function createKey(input: { name: string; scopes: string[] }) {
  return guarded(async () => {
    const { businessId, userId } = await owner();
    if (!(await businessHasApiAccess(businessId))) throw new ApiKeyError("invalid", "API keys are part of the Pro plan.");
    await rateLimit(`api-key-create:${userId}`, { limit: 20, windowSeconds: 3600 });
    const { key } = await createApiKey(businessId, input);
    return { key };
  });
}

export async function revokeKey(id: string) {
  return guarded(async () => {
    await revokeApiKey((await owner()).businessId, id);
    return {};
  });
}
