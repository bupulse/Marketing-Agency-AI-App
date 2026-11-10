"use server";

import { revalidatePath } from "next/cache";
import { AdminError } from "@/lib/admin/types";
import { requestIp } from "@/lib/request-limits";
import { adminSetAgentPassword, approveJoinRequest, createAgentWithPassword, declineJoinRequest, requireNewAgentAuthenticator } from "@/lib/support/agents";
import { requireSupportAgentPage } from "@/lib/support/app-auth";

export type TeamActionState = { error?: string; done?: string };

/** admin@bupulse.com only (docs/SUPPORT_DASHBOARD.md): approve sends the invite email, decline removes the request. */
export async function answerRequest(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const me = await requireSupportAgentPage();
  if (!me.owner) return { error: "Only the admin can answer requests." };
  const id = String(formData.get("id") ?? "");
  const approve = formData.get("answer") === "approve";
  const ctx = { actor: `support:${me.email}`, ip: await requestIp(), viaApi: false };
  try {
    if (approve) {
      const r = await approveJoinRequest(ctx, id);
      revalidatePath("/support/team");
      return { done: r.emailed ? "Approved: the invite email is on its way." : "Approved, but the invite email could not be sent. Use Resend invite in Admin -> Live chat." };
    }
    await declineJoinRequest(ctx, id);
    revalidatePath("/support/team");
    return { done: "Declined." };
  } catch (e) {
    if (e instanceof AdminError) return { error: e.message };
    throw e;
  }
}

export type AccountActionState = { error?: string; created?: { name: string; email: string; password: string }; done?: string };

const ownerContext = async () => {
  const me = await requireSupportAgentPage();
  if (!me.owner) return null;
  return { me, ctx: { actor: `support:${me.email}`, ip: await requestIp(), viaApi: false } };
};

/**
 * admin@bupulse.com makes a team member with a password (no email is sent: the admin hands it over). They must add an
 * authenticator app at their first sign-in. The password goes back to this one form so the admin can copy it once.
 */
export async function createMemberAction(_prev: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const owner = await ownerContext();
  if (!owner) return { error: "Only the admin can add team members." };
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    const r = await createAgentWithPassword(owner.ctx, {
      name,
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? "AGENT"),
      departments: formData.getAll("departments").map(String),
      password,
    });
    revalidatePath("/support/team");
    return { created: { name: name.trim(), email: r.email, password } };
  } catch (e) {
    if (e instanceof AdminError) return { error: e.message };
    throw e;
  }
}

/** A new password for a team member; they are signed out and use the new one. */
export async function setMemberPasswordAction(_prev: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const owner = await ownerContext();
  if (!owner) return { error: "Only the admin can change passwords." };
  try {
    await adminSetAgentPassword(owner.ctx, String(formData.get("id") ?? ""), String(formData.get("password") ?? ""));
    return { done: "Saved. They are signed out and sign in with the new password." };
  } catch (e) {
    if (e instanceof AdminError) return { error: e.message };
    throw e;
  }
}

/** Removes their authenticator app and asks for a new one at the next sign-in (no emailed code needed for 7 days). */
export async function requireNewAuthenticatorAction(_prev: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const owner = await ownerContext();
  if (!owner) return { error: "Only the admin can do this." };
  try {
    await requireNewAgentAuthenticator(owner.ctx, String(formData.get("id") ?? ""));
    revalidatePath("/support/team");
    return { done: "Done. At their next sign-in they must add an authenticator app before anything opens." };
  } catch (e) {
    if (e instanceof AdminError) return { error: e.message };
    throw e;
  }
}
