"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireCreator } from "@/lib/creators/auth";
import { disconnectCreator, saveCreatorConnection } from "@/lib/creators/connections";
import { handIn, HandInError, startUploads } from "@/lib/creators/handin";
import type { UploadRequest, UploadTarget } from "@/lib/creators/media";
import { checkHandedIn } from "@/lib/creators/tracking/check-now";
import { logError } from "@/lib/errors";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { openPending, PENDING_PATH, pendingCookieNames } from "@/lib/social/oauth";

const HOUR = 60 * 60;

/** Signed upload URLs for the files of a hand-in (the browser uploads straight to Storage). */
export async function startUploadsAction(taskId: string, files: UploadRequest[]): Promise<{ ok: true; targets: UploadTarget[] } | { ok: false; error: string }> {
  const { profile } = await requireCreator();
  try {
    await rateLimit(`creator-upload:${profile.id}`, { limit: 60, windowSeconds: HOUR });
    const clean = (Array.isArray(files) ? files : []).slice(0, 10).map((f) => ({ name: String(f?.name ?? "file").slice(0, 120), type: String(f?.type ?? ""), size: Number(f?.size ?? 0) }));
    return { ok: true, targets: await startUploads(profile.id, String(taskId), clean) };
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    if (error instanceof HandInError) return { ok: false, error: error.message };
    await logError(error, { source: "creators.upload" });
    return { ok: false, error: "The upload could not start. Please try again." };
  }
}

export type HandInState = { status: "idle" | "done" | "error"; error?: string; outcome?: { tracking: number; invalid: number; waiting: number } };

/** Hands in a task for a day, then checks its links at once (what cannot be checked now, the 6-hourly job checks). */
export async function handInAction(_prev: HandInState, formData: FormData): Promise<HandInState> {
  const { profile } = await requireCreator();
  const taskId = String(formData.get("taskId") ?? "");
  const links: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (key.startsWith("link_") && typeof value === "string") links[key.slice(5)] = value;
  let postIds: string[];
  try {
    await rateLimit(`creator-handin:${profile.id}`, { limit: 60, windowSeconds: HOUR });
    ({ postIds } = await handIn(profile.id, {
      taskId,
      day: String(formData.get("day") ?? ""),
      title: String(formData.get("title") ?? ""),
      caption: String(formData.get("caption") ?? ""),
      mediaPaths: formData.getAll("mediaPath").map(String),
      links,
    }));
  } catch (error) {
    if (error instanceof RateLimitError) return { status: "error", error: rateLimitMessage(error) };
    if (error instanceof HandInError) return { status: "error", error: error.message };
    await logError(error, { source: "creators.handin" });
    return { status: "error", error: "We could not save your hand-in. Please try again." };
  }
  const outcome = await checkHandedIn(postIds).catch(async (error) => {
    await logError(error, { source: "creators.handin.check" });
    return { tracking: 0, invalid: 0, waiting: postIds.length };
  });
  revalidatePath("/creator", "layout");
  return { status: "done", outcome };
}

/** Disconnects one of the creator's accounts (its posts stop earning after 3 days unless it is connected again). */
export async function disconnectAction(formData: FormData): Promise<void> {
  const { profile } = await requireCreator();
  await disconnectCreator(profile.id, String(formData.get("connectionId") ?? ""));
  revalidatePath("/creator/connections");
}

export type PickState = { error?: string; done?: boolean };

/** Facebook: the Page the creator picked from the ones their sign-in gave (kept in the sealed pending cookie). */
export async function pickPageAction(_prev: PickState, formData: FormData): Promise<PickState> {
  const session = await requireCreator();
  const jar = await cookies();
  const pending = await openPending((name) => jar.get(name)?.value, session.userId);
  const chosen = String(formData.get("account") ?? "");
  if (!pending || pending.network !== "facebook") return { error: "This choice expired. Connect Facebook again." };
  const account = pending.result.accounts.find((a) => a.externalAccountId === chosen);
  if (!account) return { error: "Pick one of your Pages." };
  try {
    await saveCreatorConnection(session.profile.id, "facebook", pending.result.accessToken, account);
  } catch (error) {
    await logError(error, { source: "creators.connect.pick" });
    return { error: "We could not save the Page. Please try again." };
  }
  for (const name of pendingCookieNames()) jar.delete({ name, path: PENDING_PATH });
  revalidatePath("/creator/connections");
  return { done: true };
}
