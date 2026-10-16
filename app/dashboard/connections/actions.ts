"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { hasFeature, upgradeHref } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { disconnect, saveConnections } from "@/lib/social/connections";
import { openPending, PENDING_PATH, pendingCookieNames } from "@/lib/social/oauth";
import { deleteConnectedAccount, isComposioResult, scopeAccount } from "@/lib/social/composio/client";

async function businessIdFor(userId: string) {
  return (await prisma.business.findUnique({ where: { userId }, select: { id: true } }))?.id ?? null;
}

/** Disconnects one of the signed-in user's accounts. A connection of another business is ignored (no IDOR). */
export async function disconnectAction(formData: FormData) {
  const user = await requireActiveUser("channels");
  const id = z.string().min(1).max(64).safeParse(formData.get("id"));
  const businessId = await businessIdFor(user.id);
  if (id.success && businessId) await disconnect(id.data, { businessId });
  revalidatePath("/dashboard/connections");
}

async function clearPending() {
  const store = await cookies();
  for (const name of pendingCookieNames()) store.set(name, "", { path: PENDING_PATH, maxAge: 0 });
}

/** Saves the accounts ticked in the account picker from the pending OAuth result held in the encrypted cookie. */
export async function savePickedAccountsAction(formData: FormData) {
  const user = await requireActiveUser("channels");
  const store = await cookies();
  const pending = await openPending((name) => store.get(name)?.value, user.id);
  const businessId = await businessIdFor(user.id);
  const ids = formData.getAll("account").filter((v): v is string => typeof v === "string");
  if (!pending || !businessId) redirect("/dashboard/connections?error=expired");
  if (!(await hasFeature(businessId, "calendar"))) redirect(upgradeHref("calendar"));
  if (!ids.length) redirect(`/dashboard/connections?pick=${pending.network}`);
  try {
    await saveConnections(businessId, pending.network, pending.result, ids, "AUTO");
  } catch (error) {
    await logError(error, { source: "social.pick", userId: user.id });
    redirect("/dashboard/connections?error=failed");
  }
  await clearPending();
  revalidatePath("/dashboard/connections");
  redirect(`/dashboard/connections?connected=${pending.network}`);
}

/** Drops a half-finished connect (the user closed the account picker). */
export async function cancelPickAction() {
  const user = await requireActiveUser("channels");
  const store = await cookies();
  const pending = await openPending((name) => store.get(name)?.value, user.id);
  // A BuPulse-Socials sign-in nobody picked an account from is removed from Composio too.
  const composioAccount = pending && isComposioResult(pending.result.scopes) ? scopeAccount(pending.result.scopes) : null;
  if (pending && composioAccount) await deleteConnectedAccount(pending.network, composioAccount);
  await clearPending();
  redirect("/dashboard/connections");
}
