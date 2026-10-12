"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import {
  flatErrors,
  isOwnLogoPath,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  lookSchema,
  offerSchema,
  readKnowledge,
  validateKnowledge,
  voiceSchema,
  type KnowledgeInput,
} from "@/lib/brand/schemas";
import { hasEssentials } from "@/lib/business-info/facts";
import { timezoneForCountryName } from "@/lib/region-format";
import { buildObjectPath, createSignedUploadUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { takeReturn } from "@/lib/auth/return-server";

export type SaveResult = { ok: true } | { ok: false; error?: string; fieldErrors?: Record<string, string> };
export type LogoUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

const SAVE_FAILED = "We could not save that. Please try again.";

/** Every action re-checks the signed-in user and only touches their own business. */
const requireUser = () => requireActiveUser("settings");

async function update(userId: string, data: Parameters<typeof prisma.business.update>[0]["data"], step?: string): Promise<SaveResult> {
  try {
    await prisma.business.update({ where: { userId }, data });
    // The app shell shows the logo, colours and business details.
    revalidatePath("/dashboard", "layout");
    if (step) trackEvent(EVENT_NAMES.onboardingStep, { userId, props: { step } });
    return { ok: true };
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
}

export async function saveOffer(input: { description: string; audience: string }): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = offerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: flatErrors(parsed.error) };
  return update(user.id, parsed.data, "offer");
}

export async function saveVoice(input: { tone: string }): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = voiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: flatErrors(parsed.error) };
  return update(user.id, { tone: parsed.data.tone }, "voice");
}

export async function saveLook(input: { logoPath: string | null; brandColors: string[] }): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = lookSchema.safeParse({ logoPath: input.logoPath ?? undefined, brandColors: input.brandColors });
  if (!parsed.success) return { ok: false, fieldErrors: flatErrors(parsed.error) };

  const { logoPath, brandColors } = parsed.data;
  if (logoPath && !isOwnLogoPath(user.id, logoPath)) return { ok: false, error: "That logo could not be used. Please upload it again." };

  const before = await prisma.business.findUnique({ where: { userId: user.id }, select: { logoUrl: true } });
  const result = await update(user.id, { logoUrl: logoPath ?? null, brandColors }, "look");

  // Tidy up the replaced logo; failing to delete it must never block saving.
  const old = before?.logoUrl;
  if (result.ok && old && old !== logoPath && isOwnLogoPath(user.id, old)) {
    try {
      await (await createClient()).storage.from("brand").remove([old]);
    } catch {}
  }
  return result;
}

export async function saveKnowledge(input: KnowledgeInput): Promise<SaveResult> {
  const user = await requireUser();
  // Phone numbers without a country of their own are read in the business's sign-up country.
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { country: true, timezone: true, knowledge: true } });
  // Free-text floors saved before the floor dropdown stay valid; any other floor must come from the list.
  const legacyFloors = readKnowledge(business?.knowledge).locations.flatMap((l) => (l.building?.floor ? [l.building.floor] : []));
  const parsed = validateKnowledge(input, { country: business?.country, requireEssentials: true, legacyFloors });
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.errors, error: parsed.errors.form };
  // Opening hours are in the business's zone. A business still on the default UTC gets its country's zone
  // (Rwanda -> Africa/Kigali), as sign-up does; countries with several zones keep theirs until the browser sets it.
  const zone = business && (!business.timezone || business.timezone === "UTC") ? timezoneForCountryName(business.country) : null;
  return update(user.id, { knowledge: parsed.data, ...(zone ? { timezone: zone } : {}) }, "knowledge");
}

/** Signed URL so the browser can upload the logo straight to the private brand bucket. */
export async function createLogoUpload(input: { fileName: string; type: string; size: number }): Promise<LogoUploadResult> {
  const user = await requireUser();
  if (!(LOGO_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, error: "Use a PNG, JPG or WebP image." };
  }
  if (!(input.size > 0) || input.size > LOGO_MAX_BYTES) return { ok: false, error: "The logo must be 5 MB or smaller." };
  try {
    const { path, token } = await createSignedUploadUrl("brand", buildObjectPath(user.id, input.fileName, "logo"), { service: true });
    return { ok: true, path, token };
  } catch {
    return { ok: false, error: "We could not start the upload. Please try again." };
  }
}

/** Last step: needs the basics from steps 1 and 2, then opens the dashboard. */
export async function finishOnboarding(): Promise<SaveResult> {
  const user = await requireUser();
  const business = await prisma.business.findUnique({ where: { userId: user.id } });
  if (!business) redirect("/login");
  if (!business.description || !business.audience) return { ok: false, error: "Go back to step 1 and describe what you sell." };
  if (!business.tone) return { ok: false, error: "Go back to step 2 and choose a brand voice." };
  if (!hasEssentials(readKnowledge(business.knowledge))) return { ok: false, error: "Add your opening hours, head office address and a WhatsApp or phone number in step 4." };

  const result = await update(user.id, { onboardedAt: business.onboardedAt ?? new Date() });
  if (!result.ok) return result;
  if (!business.onboardedAt) trackEvent(EVENT_NAMES.onboardingComplete, { userId: user.id, businessId: business.id });
  redirect(await takeReturn()); // the dashboard, or where the person was headed before signing up
}
