"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { ForbiddenError, type Permission } from "@/lib/team/roles";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { LEAD_STATUSES } from "@/lib/leads/filters";
import { LeadError, deleteLeads, getLeadDetail, setLeadNotes, setLeadStatus } from "@/lib/leads/service";
import { saveEmailToggles } from "@/lib/leads/settings";

export type LeadActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

/** The signed-in owner's business id. Every action starts here, and every query below is scoped by it. */
async function owner(permission?: Permission) {
  const user = await requireActiveUser(permission, "throw");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) throw new LeadError("not_found", "Finish setting up your business first.");
  return { userId: user.id, businessId: business.id };
}

async function guarded<T extends object>(run: () => Promise<T>): Promise<LeadActionResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    // redirect() from requireActiveUser must keep going.
    if (error instanceof Error && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
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
    const { businessId } = await owner();
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
    const { businessId } = await owner();
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
