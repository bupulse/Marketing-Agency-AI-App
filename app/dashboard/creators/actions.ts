"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/require-user";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import { ForbiddenError } from "@/lib/team/roles";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { CampaignInput, GoalsInput, TaskInput, TaskRepeat } from "@/lib/creators/company-forms";
import {
  createCampaign,
  createTasks,
  CreatorCampaignError,
  declineApplicant,
  deleteCampaign,
  deleteTask,
  markPayoutPaid,
  rejectPost,
  rejectSubmission,
  removeCreator,
  resendInvite,
  selectApplicant,
  setAcceptingApplications,
  setCampaignStatus,
  setListed,
  updateCampaign,
  updatePeriodGoals,
  updateTask,
  type CampaignActor,
} from "@/lib/creators/campaigns";
import { reportCreator } from "@/lib/creators/finder";
import { offerCreator, withdrawOffer } from "@/lib/creators/offers";
import { ReportError } from "@/lib/creators/reports";

export type CreatorActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";
const id = z.string().min(1).max(60);

/**
 * Running creator campaigns needs the `creators` permission (Owner, Admin) and the feature in the plan. Stopping things
 * and paying what is owed work without the feature (`gated: false`), so a company that lost it can still settle up.
 */
async function manager({ gated = true } = {}): Promise<CampaignActor> {
  const user = await requireActiveUser("creators", "throw");
  if (!user.businessId) throw new CreatorCampaignError("not_found", "Finish setting up your business first.");
  if (gated) await assertFeature(user.businessId, "creators");
  return { actorId: user.actorId, businessId: user.businessId, role: user.role };
}

async function guarded<T extends object>(run: () => Promise<T>): Promise<CreatorActionResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    if (error instanceof Error && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
    if (error instanceof CreatorCampaignError || error instanceof ForbiddenError || error instanceof FeatureRequiredError || error instanceof ReportError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    if (error instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error("[creators.actions]", error instanceof Error ? error.message : error);
    return { ok: false, error: GENERIC };
  }
}

/** Every creators page shows the campaign's state, so a change refreshes them all. */
const refresh = () => revalidatePath("/dashboard/creators", "layout");

export async function createCampaignAction(input: CampaignInput) {
  return guarded(async () => {
    const actor = await manager();
    await rateLimit(`creators:campaign:${actor.actorId}`, { limit: 20, windowSeconds: 3600 });
    const row = await createCampaign(actor, input);
    refresh();
    return { id: row.id };
  });
}

export async function updateCampaignAction(campaignId: string, input: CampaignInput) {
  return guarded(async () => {
    const actor = await manager();
    await updateCampaign(actor, id.parse(campaignId), input);
    refresh();
    return {};
  });
}

export async function setCampaignStatusAction(campaignId: string, status: "LIVE" | "PAUSED" | "ENDED") {
  return guarded(async () => {
    const next = z.enum(["LIVE", "PAUSED", "ENDED"]).parse(status);
    // Going live needs the feature; pausing and ending never do.
    const actor = await manager({ gated: next === "LIVE" });
    await setCampaignStatus(actor, id.parse(campaignId), next);
    refresh();
    return {};
  });
}

export async function setAcceptingAction(campaignId: string, on: boolean) {
  return guarded(async () => {
    const actor = await manager({ gated: on });
    await setAcceptingApplications(actor, id.parse(campaignId), on === true);
    refresh();
    return {};
  });
}

/** "Show on the marketplace": hiding needs nothing, showing needs the feature. */
export async function setListedAction(campaignId: string, on: boolean) {
  return guarded(async () => {
    const actor = await manager({ gated: on });
    await setListed(actor, id.parse(campaignId), on === true);
    refresh();
    return {};
  });
}

export async function deleteCampaignAction(campaignId: string) {
  return guarded(async () => {
    const actor = await manager({ gated: false });
    await deleteCampaign(actor, id.parse(campaignId));
    refresh();
    return {};
  });
}

export async function createTasksAction(campaignId: string, input: TaskInput, repeat: TaskRepeat) {
  return guarded(async () => {
    const actor = await manager();
    const r = await createTasks(actor, id.parse(campaignId), input, z.enum(["none", "week", "day"]).parse(repeat));
    refresh();
    return r;
  });
}

export async function updateTaskAction(campaignId: string, taskId: string, input: TaskInput) {
  return guarded(async () => {
    const actor = await manager();
    await updateTask(actor, id.parse(taskId), input);
    refresh();
    return {};
  });
}

export async function deleteTaskAction(campaignId: string, taskId: string) {
  return guarded(async () => {
    const actor = await manager({ gated: false });
    await deleteTask(actor, id.parse(taskId));
    refresh();
    return {};
  });
}

/**
 * Picks an applicant. A creator with an account joins at once (`picked.joined`); anyone else gets an invite link, which
 * the answer carries once, for Copy and WhatsApp.
 */
export async function selectApplicantAction(campaignId: string, campaignCreatorId: string) {
  return guarded(async () => {
    const actor = await manager();
    await rateLimit(`creators:invite:${actor.actorId}`, { limit: 60, windowSeconds: 3600 });
    const picked = await selectApplicant(actor, id.parse(campaignCreatorId));
    refresh();
    return { picked };
  });
}

export async function resendInviteAction(campaignId: string, campaignCreatorId: string) {
  return guarded(async () => {
    const actor = await manager();
    await rateLimit(`creators:invite:${actor.actorId}`, { limit: 60, windowSeconds: 3600 });
    const invite = await resendInvite(actor, id.parse(campaignCreatorId));
    refresh();
    return { invite };
  });
}

export async function declineApplicantAction(campaignId: string, campaignCreatorId: string) {
  return guarded(async () => {
    const actor = await manager({ gated: false });
    await declineApplicant(actor, id.parse(campaignCreatorId));
    refresh();
    return {};
  });
}

export async function removeCreatorAction(campaignId: string, campaignCreatorId: string) {
  return guarded(async () => {
    const actor = await manager({ gated: false });
    await removeCreator(actor, id.parse(campaignCreatorId));
    refresh();
    return {};
  });
}

export async function rejectPostAction(campaignId: string, postId: string, reason: string) {
  return guarded(async () => {
    const actor = await manager({ gated: false });
    await rejectPost(actor, id.parse(postId), z.string().max(1000).parse(reason));
    refresh();
    return {};
  });
}

export async function rejectSubmissionAction(campaignId: string, submissionId: string, reason: string) {
  return guarded(async () => {
    const actor = await manager({ gated: false });
    const r = await rejectSubmission(actor, id.parse(submissionId), z.string().max(1000).parse(reason));
    refresh();
    return r;
  });
}

export async function markPayoutPaidAction(campaignId: string, payoutId: string, reference: string) {
  return guarded(async () => {
    const actor = await manager({ gated: false });
    await markPayoutPaid(actor, id.parse(payoutId), z.string().max(200).parse(reference));
    refresh();
    return {};
  });
}

export async function updatePeriodGoalsAction(campaignId: string, periodId: string, goals: GoalsInput) {
  return guarded(async () => {
    const actor = await manager();
    await updatePeriodGoals(actor, id.parse(periodId), goals);
    refresh();
    return {};
  });
}

/** Invites a marketplace creator to one of the company's live or draft campaigns (Find creators). */
export async function offerCreatorAction(campaignId: string, profileId: string) {
  return guarded(async () => {
    const actor = await manager();
    await rateLimit(`creators:offer:${actor.actorId}`, { limit: 60, windowSeconds: 3600 });
    const offer = await offerCreator(actor, { campaignId: id.parse(campaignId), profileId: id.parse(profileId) });
    refresh();
    return { offer };
  });
}

export async function withdrawOfferAction(campaignId: string, campaignCreatorId: string) {
  return guarded(async () => {
    const actor = await manager({ gated: false });
    await withdrawOffer(actor, id.parse(campaignCreatorId));
    refresh();
    return {};
  });
}

/** Reports a creator to BuPulse (createReport rate limits it). Works without the feature, like the other safety steps. */
export async function reportCreatorAction(profileId: string, reason: string, details: string) {
  return guarded(async () => {
    const actor = await manager({ gated: false });
    await reportCreator(actor, { profileId: id.parse(profileId), reason: z.string().max(40).parse(reason), details: z.string().max(2000).parse(details) });
    return {};
  });
}
