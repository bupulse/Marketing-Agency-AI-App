"use server";

import { revalidatePath } from "next/cache";
import { adminAction, actionMessage, finish, userIdOf } from "@/lib/admin/console";
import { toMinor } from "@/lib/admin/format";
import { createAdminKey, revokeAdminKey, rotateAdminKey } from "@/lib/admin/keys";
import {
  approveAction,
  deleteMonthlyCost,
  setMonthlyCost,
  extendTrial,
  rejectAction,
  endAnnouncement,
  requestChangePlan,
  requestRefund,
  restoreUser,
  sendAnnouncement,
  setFeatureFlag,
  suspendUser,
} from "@/lib/admin/service";
import { addAdminNote, deleteAdminNote } from "@/lib/admin/notes";
import { setAiBudget } from "@/lib/admin/ai-usage";
import { clearMoneyReportCache } from "@/lib/money/report";
import { setServiceEnabled, testService } from "@/lib/admin/services";
import { AdminError } from "@/lib/admin/types";
import { prisma } from "@/lib/db";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---- Monthly costs ---------------------------------------------------------------------------------------

export async function saveCostAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/costs#one-off", "Cost saved.", async () => {
    const month = text(f, "month");
    const category = text(f, "category").toLowerCase();
    const amount = Number(text(f, "amount").replace(/[$,\s]/g, ""));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AdminError("invalid", "Pick a month.");
    if (!category || category.length > 40) throw new AdminError("invalid", "Enter a category such as hosting or email.");
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new AdminError("invalid", "Enter the amount in dollars, for example 5.00.");
    const amountCents = Math.round(amount * 100);
    await setMonthlyCost(ctx, { month, category, amountCents, note: text(f, "note") || undefined });
    clearMoneyReportCache();
  });
}

export async function deleteCostAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/costs#one-off", "Cost deleted.", async () => {
    const month = text(f, "month");
    const category = text(f, "category");
    await deleteMonthlyCost(ctx, { month, category });
    clearMoneyReportCache();
  });
}

// ---- Jarvis API keys (a key is shown once, in the action result) -------------------------------------------

export type KeyState = { error?: string; key?: string; name?: string };

const allowList = (raw: string) => raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

export async function createKeyAction(_prev: KeyState, f: FormData): Promise<KeyState> {
  const ctx = await adminAction();
  try {
    const { key, apiKey } = await createAdminKey(ctx, { name: text(f, "name"), ipAllowList: allowList(text(f, "ips")) });
    revalidatePath("/admin/jarvis");
    return { key, name: apiKey.name };
  } catch (e) {
    return { error: actionMessage(e) };
  }
}

export async function rotateKeyAction(_prev: KeyState, f: FormData): Promise<KeyState> {
  const ctx = await adminAction();
  try {
    const { key, apiKey } = await rotateAdminKey(ctx, text(f, "id"));
    // No revalidate here: re-rendering the list would unmount the row that is showing the new key.
    return { key, name: apiKey.name };
  } catch (e) {
    return { error: actionMessage(e) };
  }
}

export async function revokeKeyAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/jarvis", "Key revoked. Jarvis can no longer use it.", () => revokeAdminKey(ctx, text(f, "id")));
}

// ---- Users -----------------------------------------------------------------------------------------------

const uid = (f: FormData) => userIdOf(text(f, "userId"));
// An invalid id falls back to the users list instead of building a bad path.
const userBack = (f: FormData) => {
  try {
    return `/admin/users/${uid(f)}`;
  } catch {
    return "/admin/users";
  }
};

export async function extendTrialAction(f: FormData) {
  const ctx = await adminAction();
  await finish(userBack(f), "Trial extended.", () => extendTrial(ctx, { userId: uid(f), days: Number(text(f, "days")) }));
}

export async function suspendAction(f: FormData) {
  const ctx = await adminAction();
  await finish(userBack(f), "User suspended. They are signed out and cannot use BuPulse until restored.", () =>
    suspendUser(ctx, { userId: uid(f), reason: text(f, "reason") }),
  );
}

export async function restoreAction(f: FormData) {
  const ctx = await adminAction();
  await finish(userBack(f), "User restored.", () => restoreUser(ctx, { userId: uid(f) }));
}

export async function changePlanAction(f: FormData) {
  const ctx = await adminAction();
  await finish(userBack(f), (r) => r.message, () =>
    requestChangePlan(ctx, { userId: uid(f), plan: text(f, "plan"), interval: text(f, "interval") || undefined, idempotencyKey: text(f, "idem") || undefined }),
  );
}

export async function refundAction(f: FormData) {
  const ctx = await adminAction();
  await finish(userBack(f), "Refund request created. Approve it on the Approvals page.", () => {
    const currency = /^[A-Z]{3}$/.test(text(f, "currency")) ? text(f, "currency") : "USD";
    const raw = text(f, "amount");
    const minor = raw === "" ? null : toMinor(raw, currency);
    if (raw !== "" && (minor === null || minor <= 0)) throw new AdminError("invalid", `Enter the refund as an amount in ${currency}, or leave it empty for a full refund.`);
    const transactionId = text(f, "transactionId");
    return requestRefund(ctx, {
      userId: uid(f),
      reason: text(f, "reason"),
      transactionId: /^txn_\w+$/.test(transactionId) ? transactionId : undefined,
      lineItemId: minor !== null ? text(f, "lineItemId") || undefined : undefined, // only a partial refund names a line
      amountMinor: minor === null ? undefined : minor,
      idempotencyKey: text(f, "idem") || undefined,
    });
  });
}

// ---- Approvals -------------------------------------------------------------------------------------------

export async function approveFormAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/approvals", (r) => (r.status === "executed" ? "Approved and done." : r.status === "needs_check" ? "Approved, but check Paddle: it may or may not have gone through. Do not request it again." : `Approved, but it did not complete (${r.status}). See the result below.`), () =>
    approveAction(ctx, text(f, "id")),
  );
}

export async function rejectFormAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/approvals", "Rejected. Nothing was changed.", () => rejectAction(ctx, text(f, "id")));
}

// ---- Feature flags ---------------------------------------------------------------------------------------

export async function saveFlagAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/flags", "Flag saved.", async () => {
    if (f.get("create") === "1") {
      // Creating must never overwrite: an existing flag keeps its settings.
      const exists = await prisma.featureFlag.findUnique({ where: { key: text(f, "key") }, select: { key: true } });
      if (exists) throw new AdminError("conflict", "A flag with this key already exists. Change it from the list below.");
    }
    const rollout = text(f, "rollout");
    return setFeatureFlag(ctx, {
      key: text(f, "key"),
      enabled: f.has("enabled") ? text(f, "enabled") === "on" : undefined,
      rolloutPercent: rollout === "" ? undefined : Number(rollout),
      description: text(f, "description") || undefined,
    });
  });
}

export async function flagOverrideAction(f: FormData) {
  const ctx = await adminAction();
  const back = text(f, "back") || "/admin/flags";
  await finish(back, "Override saved.", async () => {
    let userId = text(f, "userId") ? userIdOf(text(f, "userId")) : "";
    if (!userId) {
      const email = text(f, "email").toLowerCase();
      const user = email ? await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } }) : null;
      if (!user) throw new AdminError("not_found", "No user with that email.");
      userId = user.id;
    }
    const value = text(f, "value");
    if (!["on", "off", "remove"].includes(value)) throw new AdminError("invalid", "Choose on, off or remove.");
    return setFeatureFlag(ctx, { key: text(f, "key"), userOverrides: { [userId]: value === "remove" ? null : value === "on" } });
  });
}

// ---- Announcements ---------------------------------------------------------------------------------------

export async function createAnnouncementAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/announcements", "Announcement saved.", () => {
    const plans = f.getAll("plans").map(String);
    // datetime-local has no zone. The browser sends its offset (minutes, UTC minus local) in "tz"; UTC = local + offset.
    const tz = Number(text(f, "tz"));
    const offsetMin = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0;
    const date = (k: string) => {
      const v = text(f, k);
      if (!v) return undefined;
      const d = new Date(`${v}:00Z`);
      if (Number.isNaN(d.getTime())) throw new AdminError("invalid", "That date does not look right.");
      return new Date(d.getTime() + offsetMin * 60_000);
    };
    return sendAnnouncement(ctx, {
      title: text(f, "title"),
      body: text(f, "body"),
      audience: plans.length ? "plan" : "all",
      plans,
      startsAt: date("startsAt"),
      endsAt: date("endsAt"),
      dismissible: f.get("dismissible") === "on",
    });
  });
}

export async function endAnnouncementAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/announcements", "Announcement ended.", () => endAnnouncement(ctx, text(f, "id")));
}

// ---- Client notes ------------------------------------------------------------------------------------------

export async function addNoteAction(f: FormData) {
  const ctx = await adminAction();
  const userId = userIdOf(text(f, "userId"));
  await finish(`/admin/users/${userId}?tab=notes`, "Note saved.", () => addAdminNote(ctx, { userId, body: String(f.get("body") ?? "") }));
}

export async function deleteNoteAction(f: FormData) {
  const ctx = await adminAction();
  const userId = userIdOf(text(f, "userId"));
  await finish(`/admin/users/${userId}?tab=notes`, "Note deleted.", async () => {
    // The note must belong to this client: the id alone is not enough.
    const note = await prisma.adminNote.findFirst({ where: { id: text(f, "id"), userId }, select: { id: true } });
    if (!note) throw new AdminError("not_found", "That note does not belong to this client.");
    await deleteAdminNote(ctx, note.id);
  });
}

// ---- Services and AI budget ----------------------------------------------------------------------------------

export async function testServiceAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/services", (r) => `${r.ok ? "Working" : "Not working"}: ${r.message ?? (r.ok ? "the check passed" : "the check failed")} (${r.latencyMs} ms).`, () => testService(ctx, text(f, "service")));
}

export async function setServiceEnabledAction(f: FormData) {
  const ctx = await adminAction();
  const enabled = text(f, "enabled") === "1";
  await finish("/admin/services", enabled ? "Service switched on." : "Service switched off. Clients see a friendly unavailable message.", () =>
    setServiceEnabled(ctx, { service: text(f, "service"), enabled, reason: text(f, "reason") || undefined }),
  );
}

export async function setAiBudgetAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/ai", "Monthly AI cap saved.", () => {
    const raw = text(f, "usd");
    const usd = raw === "" ? null : Number(raw.replace(/[$,\s]/g, ""));
    if (usd !== null && !Number.isFinite(usd)) throw new AdminError("invalid", "Enter the cap in dollars, for example 20.");
    return setAiBudget(ctx, { monthlyUsd: usd });
  });
}
