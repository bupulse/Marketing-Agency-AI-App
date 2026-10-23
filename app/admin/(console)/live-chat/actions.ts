"use server";

import { requirePermission, type AdminIdentity } from "@/lib/admin/auth";
import type { AdminContext } from "@/lib/admin/types";
import { adminAction, finish } from "@/lib/admin/console";
import { inviteAgent, renameDepartment, resendAgentInvite, resetAgentAuthenticator, setAgentLocked, updateAgent } from "@/lib/support/agents";
import { clearSupportSettingsCache, getSupportSettings, saveSupportSettings, type SupportSettings } from "@/lib/support/settings";
import { aiFromForm, greetingsFromForm, hoursFromForm } from "@/lib/support/settings-form";

// Admin -> Live chat. adminAction("liveChat") re-checks the person (AAL2) and the permission on every call; the
// services check it again, audit every change and sign a locked agent out at once. Settings tabs change only their
// own fields: the rest of the saved settings is read first and kept as it is.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (tab: string) => `/admin/live-chat?tab=${tab}`;

async function liveChatManager() {
  const ctx = await adminAction("liveChat");
  return { ctx, actor: await requirePermission("liveChat") };
}

const agentInput = (f: FormData) => ({ name: text(f, "name"), role: text(f, "role"), departments: f.getAll("departments").map(String), maxChats: text(f, "maxChats") || undefined });

export async function inviteAgentAction(f: FormData) {
  const { ctx, actor } = await liveChatManager();
  await finish(back("agents"), (r: { emailed: boolean }) => (r.emailed ? "Invite sent. They choose a password and add an authenticator app from the email." : "Added, but the invite email could not be sent. Use Resend invite in a minute."), () =>
    inviteAgent(ctx, actor, { ...agentInput(f), email: text(f, "email") }),
  );
}

export async function updateAgentAction(f: FormData) {
  const { ctx, actor } = await liveChatManager();
  await finish(back("agents"), "Agent saved.", () => updateAgent(ctx, actor, text(f, "id"), agentInput(f)));
}

export async function setAgentLockedAction(f: FormData) {
  const { ctx, actor } = await liveChatManager();
  const locked = text(f, "locked") === "1";
  await finish(back("agents"), locked ? "Locked. They were signed out and cannot sign in until unlocked." : "Unlocked. They can sign in again.", () => setAgentLocked(ctx, actor, text(f, "id"), locked));
}

export async function resendAgentInviteAction(f: FormData) {
  const { ctx, actor } = await liveChatManager();
  await finish(back("agents"), (r: { emailed: boolean }) => (r.emailed ? "New invite sent. The old link no longer works." : "The invite email could not be sent. Please try again in a minute."), () => resendAgentInvite(ctx, actor, text(f, "id")));
}

export async function resetAgentAuthenticatorAction(f: FormData) {
  const { ctx, actor } = await liveChatManager();
  await finish(back("agents"), "Authenticator removed and signed out. They add one again at their next sign-in.", () => resetAgentAuthenticator(ctx, actor, text(f, "id")));
}

export async function renameDepartmentAction(f: FormData) {
  const { ctx, actor } = await liveChatManager();
  await finish(back("departments"), "Department renamed.", () => renameDepartment(ctx, actor, text(f, "key"), text(f, "name")));
}

/** Reads the saved settings, replaces one tab's fields and saves the whole (saveSupportSettings validates and audits). */
async function saveTab(ctx: AdminContext, actor: AdminIdentity, change: (current: SupportSettings) => Partial<SupportSettings>) {
  clearSupportSettingsCache(); // the saved row, not this server's 30-second copy (another server may have saved since)
  const current = await getSupportSettings();
  return saveSupportSettings(ctx, actor, { ...current, ...change(current) });
}

export async function saveHoursAction(f: FormData) {
  const { ctx, actor } = await liveChatManager();
  await finish(back("hours"), "Team hours saved. The chat shows them within a minute.", () => saveTab(ctx, actor, (current) => ({ hours: hoursFromForm(f, current.hours) })));
}

export async function saveGreetingsAction(f: FormData) {
  const { ctx, actor } = await liveChatManager();
  await finish(back("greetings"), "Greetings saved.", () => saveTab(ctx, actor, () => ({ greetings: greetingsFromForm(f) })));
}

export async function saveAiAction(f: FormData) {
  const { ctx, actor } = await liveChatManager();
  await finish(back("ai"), "AI rules saved.", () => saveTab(ctx, actor, () => aiFromForm(f)));
}
