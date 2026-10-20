"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import { ForbiddenError, type Permission } from "@/lib/team/roles";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { InboxError, addNote, assign, getThread, markRead, replyAsAgent, setBotPause, setStatus, type Thread } from "@/lib/inbox/service";
import { ContactError, addTag, removeTag } from "@/lib/contacts/core";

export type InboxActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

/** The signed-in person's company. Answering follows `content` (Members answer too); every query is scoped by it. */
async function member(permission: Permission = "content") {
  const user = await requireActiveUser(permission, "throw");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) throw new InboxError("not_found", "Finish setting up your business first.");
  await assertFeature(business.id, "inbox");
  return { actorId: user.actorId, businessId: business.id };
}

async function guarded<T extends object>(run: () => Promise<T>): Promise<InboxActionResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    if (error instanceof Error && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
    if (error instanceof ForbiddenError || error instanceof FeatureRequiredError || error instanceof InboxError || error instanceof ContactError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    console.error("[inbox.actions]", error instanceof Error ? error.message : error);
    return { ok: false, error: GENERIC };
  }
}

const id = z.string().min(1).max(60);

/** Opens a conversation: its messages, and it is marked read. */
export async function loadThread(conversationId: string): Promise<InboxActionResult<{ thread: Thread }>> {
  return guarded(async () => {
    const { businessId } = await member();
    const cid = id.parse(conversationId);
    await markRead(businessId, cid);
    const thread = await getThread(businessId, cid);
    if (!thread) throw new InboxError("not_found", "That conversation no longer exists.");
    return { thread };
  });
}

export async function sendReply(conversationId: string, text: string): Promise<InboxActionResult<{ sent: boolean; error?: string }>> {
  return guarded(async () => {
    const { businessId, actorId } = await member();
    await rateLimit(`inbox:reply:${actorId}`, { limit: 60, windowSeconds: 60 });
    const result = await replyAsAgent(businessId, id.parse(conversationId), actorId, z.string().max(4000).parse(text));
    revalidatePath("/dashboard/inbox");
    return result.ok ? { sent: true } : { sent: false, error: result.error };
  });
}

export async function saveNote(conversationId: string, text: string) {
  return guarded(async () => {
    const { businessId, actorId } = await member();
    await addNote(businessId, id.parse(conversationId), actorId, z.string().max(2000).parse(text));
    return {};
  });
}

export async function assignTo(conversationId: string, userId: string | null) {
  return guarded(async () => {
    const { businessId } = await member();
    await assign(businessId, id.parse(conversationId), userId ? z.string().uuid().parse(userId) : null);
    revalidatePath("/dashboard/inbox");
    return {};
  });
}

export async function changeStatus(conversationId: string, status: "OPEN" | "CLOSED") {
  return guarded(async () => {
    const { businessId } = await member();
    await setStatus(businessId, id.parse(conversationId), z.enum(["OPEN", "CLOSED"]).parse(status));
    revalidatePath("/dashboard/inbox");
    return {};
  });
}

/** Pause automations in this conversation for `hours` (a person answers), or resume them (0). */
export async function pauseAutomations(conversationId: string, hours: number) {
  return guarded(async () => {
    const { businessId } = await member();
    await setBotPause(businessId, id.parse(conversationId), z.number().int().min(0).max(24 * 7).parse(hours));
    return {};
  });
}

export async function tagContact(contactId: string, tag: string, add: boolean) {
  return guarded(async () => {
    const { businessId } = await member();
    const name = z.string().trim().min(1).max(40).parse(tag);
    if (add) await addTag(businessId, id.parse(contactId), name);
    else await removeTag(businessId, id.parse(contactId), name);
    return {};
  });
}
