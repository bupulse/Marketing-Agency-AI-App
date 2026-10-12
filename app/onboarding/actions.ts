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
  validateKnowledge,
  voiceSchema,
} from "@/lib/brand/schemas";
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

export async function saveKnowledge(input: {
  hours: string;
  area: string;
  contact: string;
  faqs: { question: string; answer: string }[];
}): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = validateKnowledge(input);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.errors };
  return update(user.id, { knowledge: parsed.data }, "knowledge");
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

  const result = await update(user.id, { onboardedAt: business.onboardedAt ?? new Date() });
  if (!result.ok) return result;
  if (!business.onboardedAt) trackEvent(EVENT_NAMES.onboardingComplete, { userId: user.id, businessId: business.id });
  redirect(await takeReturn()); // the dashboard, or where the person was headed before signing up
}
