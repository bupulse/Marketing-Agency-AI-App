"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import { connectCloudflare, disconnectCloudflare, installChat, uninstallChat, CloudflareUserError, type InstallOutcome } from "@/lib/cloudflare/service";

async function businessId() {
  const user = await requireActiveUser("connectors");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  return { user, id: business?.id ?? null };
}

export type TokenState = { error?: string };

/** The token goes from this form straight to Cloudflare and into encrypted storage; it is never sent back to the browser. */
export async function connectCloudflareAction(_prev: TokenState, formData: FormData): Promise<TokenState> {
  const { user, id } = await businessId();
  if (!id) return { error: "Finish setting up your business first." };
  try {
    await rateLimit(`store-connect:${user.id}`, RATE_LIMITS.storeConnect);
    await connectCloudflare(id, String(formData.get("token") ?? ""));
  } catch (error) {
    if (error instanceof RateLimitError) return { error: rateLimitMessage(error) };
    if (error instanceof CloudflareUserError) return { error: error.message };
    await logError(error, { source: "cloudflare.connect", userId: user.id });
    return { error: "We could not connect to Cloudflare. Please try again." };
  }
  revalidatePath("/dashboard/domains");
  redirect("/dashboard/domains");
}

export type InstallResult = ({ ok: true } & InstallOutcome) | { ok: false; error: string };

export async function installChatAction(zoneId: string): Promise<InstallResult> {
  const { user, id } = await businessId();
  if (!id || typeof zoneId !== "string" || zoneId.length > 64) return { ok: false, error: "We could not find that domain." };
  try {
    await rateLimit(`store-connect:${user.id}`, RATE_LIMITS.storeConnect);
    const outcome = await installChat(id, zoneId);
    revalidatePath("/dashboard/domains");
    revalidatePath("/dashboard/widget");
    return { ok: true, ...outcome };
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    if (error instanceof CloudflareUserError) return { ok: false, error: error.message };
    await logError(error, { source: "cloudflare.install", userId: user.id });
    return { ok: false, error: "We could not add the chat. Please try again." };
  }
}

export async function removeChatAction(zoneId: string): Promise<{ ok: boolean; error?: string }> {
  const { user, id } = await businessId();
  if (!id || typeof zoneId !== "string" || zoneId.length > 64) return { ok: false, error: "We could not find that domain." };
  try {
    await uninstallChat(id, zoneId);
    revalidatePath("/dashboard/domains");
    return { ok: true };
  } catch (error) {
    if (error instanceof CloudflareUserError) return { ok: false, error: error.message };
    await logError(error, { source: "cloudflare.uninstall", userId: user.id });
    return { ok: false, error: "We could not remove the chat. Please try again." };
  }
}

export async function disconnectCloudflareAction(): Promise<{ ok: boolean }> {
  const { id } = await businessId();
  if (id) await disconnectCloudflare(id);
  revalidatePath("/dashboard/domains");
  return { ok: true };
}
