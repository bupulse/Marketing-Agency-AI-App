"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import { ForbiddenError, type Permission } from "@/lib/team/roles";
import { RATE_LIMITS, RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { LEAD_STATUSES } from "@/lib/leads/filters";
import { LeadError, deleteLeads, getLeadDetail, setLeadNotes, setLeadStatus } from "@/lib/leads/service";
import { saveEmailToggles, saveWhatsappAlerts } from "@/lib/leads/settings";
import { normalizePhone } from "@/lib/leads/normalize";
import { whatsappAlertsAvailable } from "@/lib/leads/whatsapp";
import { allowedEndpoint, removeDevice, saveDevice, vapidKeys } from "@/lib/push/service";

export type LeadActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

/**
 * The signed-in owner's business id. Every action starts here, and every query below is scoped by it. Working a lead
 * (status, notes, notifications) needs website chat in the plan; looking at and deleting the leads the company already
 * has never does (`gated: false`), so losing the feature never locks anyone out of their own data.
 */
async function owner(permission?: Permission, { gated = true } = {}) {
  const user = await requireActiveUser(permission, "throw");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) throw new LeadError("not_found", "Finish setting up your business first.");
  if (gated) await assertFeature(business.id, "websiteChat");
  // userId is the company account; actorId the person signed in (a teammate's own account).
  return { userId: user.id, actorId: user.actorId, businessId: business.id };
}

async function guarded<T extends object>(run: () => Promise<T>): Promise<LeadActionResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    // redirect() from requireActiveUser must keep going.
    if (error instanceof Error && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
    if (error instanceof ForbiddenError || error instanceof FeatureRequiredError) return { ok: false, error: error.message };
    if (error instanceof LeadError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    console.error("[leads.actions]", error instanceof Error ? error.message : error);
    return { ok: false, error: GENERIC };
  }
}

const idSchema = z.string().min(1).max(60);
const idsSchema = z.array(idSchema).min(1).max(200);

export async function loadLead(id: string) {
  return guarded(async () => {
    const { businessId } = await owner(undefined, { gated: false });
    const lead = await getLeadDetail(businessId, idSchema.parse(id));
    if (!lead) throw new LeadError("not_found", "That lead no longer exists.");
    return { lead };
  });
}

export async function changeStatus(ids: string[], status: string) {
  return guarded(async () => {
    const { businessId } = await owner();
    const parsed = z.object({ ids: idsSchema, status: z.enum(LEAD_STATUSES) }).safeParse({ ids, status });
    if (!parsed.success) throw new LeadError("invalid", "Choose a status.");
    const changed = await setLeadStatus(businessId, parsed.data.ids, parsed.data.status);
    revalidatePath("/dashboard/leads");
    return { changed };
  });
}

export async function saveNotes(id: string, notes: string) {
  return guarded(async () => {
    const { businessId, userId } = await owner();
    await rateLimit(`lead-notes:${userId}`, { limit: 600, windowSeconds: 3600 });
    if (typeof notes !== "string") throw new LeadError("invalid", "Notes must be text.");
    if (!(await setLeadNotes(businessId, idSchema.parse(id), notes))) throw new LeadError("not_found", "That lead no longer exists.");
    return {};
  });
}

export async function removeLeads(ids: string[]) {
  return guarded(async () => {
    const { businessId } = await owner(undefined, { gated: false });
    const parsed = idsSchema.safeParse(ids);
    if (!parsed.success) throw new LeadError("invalid", "Choose at least one lead.");
    const deleted = await deleteLeads(businessId, parsed.data);
    revalidatePath("/dashboard/leads");
    return { deleted };
  });
}

export async function saveToggles(input: { notifyInstant: boolean; notifyDaily: boolean }) {
  return guarded(async () => {
    const { businessId } = await owner("settings");
    const parsed = z.object({ notifyInstant: z.boolean(), notifyDaily: z.boolean() }).safeParse(input);
    if (!parsed.success) throw new LeadError("invalid", "Those settings are not valid.");
    await saveEmailToggles(businessId, parsed.data);
    return {};
  });
}

const base64Url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);
const deviceSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: base64Url.min(80).max(100), auth: base64Url.min(16).max(40) }),
  device: z.string().max(80).nullish(),
});

/**
 * "Alerts on this device": saves the browser's push subscription for the signed-in person. Everyone who may see
 * leads may switch it on for their own devices (Members too).
 */
export async function savePushDevice(input: unknown) {
  return guarded(async () => {
    const { businessId, actorId } = await owner("content");
    if (!vapidKeys()) throw new LeadError("invalid", "Phone and browser alerts are not available right now.");
    const parsed = deviceSchema.safeParse(input);
    if (!parsed.success || !allowedEndpoint(parsed.data.endpoint)) throw new LeadError("invalid", "This browser gave an address BuPulse cannot send alerts to.");
    await rateLimit(`push-device:${actorId}`, RATE_LIMITS.pushDevice);
    await saveDevice(businessId, actorId, parsed.data);
    return {};
  });
}

/** Turns alerts off on this device. Not gated by the plan: switching something off must always work. */
export async function removePushDevice(endpoint: string) {
  return guarded(async () => {
    const { actorId } = await owner("content", { gated: false });
    const parsed = z.string().url().max(1000).safeParse(endpoint);
    if (!parsed.success) throw new LeadError("invalid", "That device is not valid.");
    await removeDevice(actorId, parsed.data);
    return {};
  });
}

/** WhatsApp alerts on or off, and the number they go to (empty: the business phone). Only while the admin offers them. */
export async function saveWhatsappToggle(input: { enabled: boolean; number: string }) {
  return guarded(async () => {
    const { businessId } = await owner("settings");
    const parsed = z.object({ enabled: z.boolean(), number: z.string().max(40) }).safeParse(input);
    if (!parsed.success) throw new LeadError("invalid", "Those settings are not valid.");
    if (!(await whatsappAlertsAvailable())) throw new LeadError("invalid", "WhatsApp alerts are not available right now.");
    const typed = parsed.data.number.trim();
    const number = typed ? normalizePhone(typed) : null;
    if (typed && !number?.startsWith("+")) throw new LeadError("invalid", "Enter the WhatsApp number with its country code, e.g. +250 788 123 456.");
    await saveWhatsappAlerts(businessId, { notifyWhatsapp: parsed.data.enabled, whatsappNumber: number ?? null });
    return {};
  });
}
