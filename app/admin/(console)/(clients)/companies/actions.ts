"use server";

import { adminAction, finish, userIdOf } from "@/lib/admin/console";
import { changeCompanyUserRole, changeUserEmail, createCompanyUser, removeCompanyUser, sendPasswordReset } from "@/lib/admin/actions/companies";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (f: FormData) => `/admin/companies/${encodeURIComponent(text(f, "businessId"))}?tab=users`;

// Every action re-checks the admin (adminAction), then runs the audited, rate-limited function in lib/admin/actions/companies.ts.
// The console dialog is the confirmation; the API (Jarvis) must send confirm: true.

export async function addCompanyUserAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(back(f), (r) => (r.emailSent ? `User created. A link to choose a password was sent to ${r.email}.` : `User created, but the email could not be sent. Use "Send reset link" in a moment.`), () =>
    createCompanyUser(ctx, { businessId: text(f, "businessId"), email: text(f, "email"), role: text(f, "role"), name: text(f, "name") || undefined }),
  );
}

export async function sendResetAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(back(f), (r) => `Reset link sent to ${r.sentTo}.`, () => sendPasswordReset(ctx, { userId: userIdOf(text(f, "userId")) }));
}

export async function changeEmailAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(
    back(f),
    (r) => `Email changed to ${r.newEmail}. ${r.noticeSent ? "The old address was notified." : "The notice to the old address could not be sent."}${r.resetSent ? " A reset link went to the new address." : ""}`,
    () => changeUserEmail(ctx, { userId: userIdOf(text(f, "userId")), newEmail: text(f, "newEmail"), sendReset: f.get("sendReset") === "on" }),
  );
}

export async function removeUserAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(back(f), "User removed.", () => removeCompanyUser(ctx, { userId: userIdOf(text(f, "userId")) }));
}

export async function changeRoleAction(f: FormData) {
  const ctx = await adminAction("clients.manage");
  await finish(back(f), (r) => (r.role === "OWNER" ? "Ownership handed over. The previous owner is now an Admin." : "Role updated."), () =>
    changeCompanyUserRole(ctx, { userId: userIdOf(text(f, "userId")), role: text(f, "role") }),
  );
}
