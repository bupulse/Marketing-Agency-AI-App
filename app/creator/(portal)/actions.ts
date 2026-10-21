"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ApplicationErrors } from "@/lib/creators/application";
import { requireCreator } from "@/lib/creators/auth";
import { disconnectCreator, saveCreatorConnection } from "@/lib/creators/connections";
import { handIn, HandInError, startUploads } from "@/lib/creators/handin";
import type { UploadRequest, UploadTarget } from "@/lib/creators/media";
import { answerOffer, OfferError } from "@/lib/creators/offer-answers";
import { saveProfile } from "@/lib/creators/profile";
import { readProfileForm } from "@/lib/creators/profile-form";
import { createReport, ReportError } from "@/lib/creators/reports";
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

export type ProfileState = { status: "idle" | "saved" | "error"; error?: string; errors?: ApplicationErrors; values?: Record<string, string> };

/** Saves the creator's profile; back to the campaign they came from (`next`, a /c/<slug> page) once it is complete. */
export async function saveProfileAction(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const { profile } = await requireCreator();
  const values = Object.fromEntries([...formData.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")).map(([k, v]) => [k, String(v).slice(0, 1000)]));
  const read = readProfileForm(formData);
  if (!read.ok) return { status: "error", errors: read.errors, values };
  try {
    await rateLimit(`creator-profile:${profile.id}`, { limit: 60, windowSeconds: HOUR });
    await saveProfile(profile.id, read.value);
  } catch (error) {
    if (error instanceof RateLimitError) return { status: "error", error: rateLimitMessage(error), values };
    await logError(error, { source: "creators.profile" });
    return { status: "error", error: "We could not save your profile. Please try again.", values };
  }
  revalidatePath("/creator", "layout");
  const next = String(formData.get("next") ?? "");
  if (/^\/c\/[a-z0-9-]{3,80}$/.test(next)) redirect(next);
  return { status: "saved" };
}

export type OfferState = { error?: string };

/** Accepts or declines a company's invitation (lib/creators/offer-answers.ts). */
export async function answerOfferAction(_prev: OfferState, formData: FormData): Promise<OfferState> {
  const { profile } = await requireCreator();
  const answer = formData.get("answer") === "accept" ? "accept" : "decline";
  let status: "JOINED" | "DECLINED";
  try {
    status = await answerOffer(profile.id, String(formData.get("id") ?? ""), answer);
  } catch (error) {
    if (error instanceof OfferError) return { error: error.message };
    await logError(error, { source: "creators.offer-answer" });
    return { error: "We could not save your answer. Please try again." };
  }
  revalidatePath("/creator", "layout");
  // Joined: straight to the campaign, where its tasks are.
  const campaignId = String(formData.get("campaignId") ?? "");
  if (status === "JOINED" && /^[a-z0-9]{10,40}$/.test(campaignId)) redirect(`/creator/campaigns/${campaignId}`);
  return {};
}

export type ReportState = { status: "idle" | "sent" | "error"; error?: string };

/** A creator reports a campaign (lib/creators/reports.ts: one open report per creator and campaign, rate limited). */
export async function reportCampaignAction(campaignId: string, _prev: ReportState, formData: FormData): Promise<ReportState> {
  const session = await requireCreator();
  try {
    await createReport({ kind: "CAMPAIGN", campaignId, reporterUserId: session.userId, reason: String(formData.get("reason") ?? ""), details: String(formData.get("details") ?? "") });
    return { status: "sent" };
  } catch (error) {
    if (error instanceof ReportError) return { status: "error", error: error.message };
    if (error instanceof RateLimitError) return { status: "error", error: rateLimitMessage(error) };
    await logError(error, { source: "creators.report" });
    return { status: "error", error: "We could not send your report. Please try again." };
  }
}
