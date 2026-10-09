"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { logError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/team/roles";
import { cancelInvite, changeRole, createInvite, removeMember, resendInvite, setMyAlerts, TeamError, transferOwnership, type TeamActor } from "@/lib/team/service";

export type TeamResult = { ok: true; message?: string } | { ok: false; error: string };

/** Every team action re-checks the role on the server, rate limits per company, and turns known failures into plain messages. */
async function run(permission: "team" | "company", fn: (actor: TeamActor) => Promise<string | void>): Promise<TeamResult> {
  try {
    const user = await requireActiveUser(permission, "throw");
    await rateLimit(`team:${user.id}`, { limit: 60, windowSeconds: 60 * 60 });
    const message = await fn(user);
    revalidatePath("/dashboard/settings/team");
    return { ok: true, message: message || undefined };
  } catch (error) {
    if (error instanceof TeamError || error instanceof ForbiddenError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    if (error && typeof error === "object" && "digest" in error) throw error; // redirects
    await logError(error, { source: "team.action" });
    return { ok: false, error: "Something went wrong. Nothing was changed. Please try again." };
  }
}

export async function inviteAction(input: { email: string; role: string }): Promise<TeamResult> {
  return run("team", async (actor) => {
    await rateLimit(`team-invite:${actor.id}`, { limit: 20, windowSeconds: 60 * 60 });
    const invite = await createInvite(actor, input);
    return invite.sent ? `Invitation sent to ${invite.email}.` : `Invitation saved, but the email could not be sent. Use Resend in a moment.`;
  });
}

export async function resendInviteAction(inviteId: string): Promise<TeamResult> {
  return run("team", async (actor) => {
    await rateLimit(`team-invite:${actor.id}`, { limit: 20, windowSeconds: 60 * 60 });
    const { sent } = await resendInvite(actor, String(inviteId));
    return sent ? "Invitation sent again." : "The email could not be sent. Please try again in a moment.";
  });
}

export async function cancelInviteAction(inviteId: string): Promise<TeamResult> {
  return run("team", async (actor) => {
    await cancelInvite(actor, String(inviteId));
    return "Invitation cancelled.";
  });
}

export async function changeRoleAction(userId: string, role: string): Promise<TeamResult> {
  return run("team", async (actor) => {
    await changeRole(actor, String(userId), String(role));
    return "Role updated.";
  });
}

export async function removeMemberAction(userId: string): Promise<TeamResult> {
  return run("team", async (actor) => {
    await removeMember(actor, String(userId));
    return "Removed from your company.";
  });
}

export async function transferOwnershipAction(userId: string): Promise<TeamResult> {
  return run("company", async (actor) => {
    await transferOwnership(actor, String(userId));
    return "Ownership transferred. You are now an Admin.";
  });
}

export async function setAlertsAction(on: boolean): Promise<TeamResult> {
  return run("team", async (actor) => {
    await setMyAlerts(actor, Boolean(on));
    return on ? "You will get the owner's lead and post emails." : "Those emails now go to the owner only.";
  });
}
