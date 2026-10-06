"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { isOwnProjectPhotoPath } from "@/lib/designs/assets";
import { ASPECT_RATIOS } from "@/lib/designs/layout";
import { createAiDesign as makeAiDesign, createTemplateDesign as makeTemplateDesign, DesignError, deleteDesign as removeDesign, designDownloadUrl, designUrl } from "@/lib/designs/service";
import { isTemplateId } from "@/lib/designs/templates";
import { RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import { UsageLimitError, type UsageBlockReason } from "@/lib/usage";

export type DesignResult =
  | { ok: true; designId: string; url: string }
  | { ok: false; error: string; blocked?: UsageBlockReason };

const FAILED = "We could not create that design. Please try again.";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const ratio = z.enum(ASPECT_RATIOS);
const projectId = z.string().min(1).max(60).nullish().transform((v) => v || null);

const templateSchema = z.object({
  projectId,
  template: z.string().refine(isTemplateId, "Pick one of the templates."),
  aspectRatio: ratio,
  headline: z.string().trim().min(1, "Add a headline.").max(140, "Keep the headline under 140 characters."),
  subline: optionalText(180),
  chip: optionalText(40),
  kicker: optionalText(30),
  photoPath: optionalText(500),
});

const aiSchema = z.object({
  projectId,
  prompt: z.string().trim().min(5, "Describe the image in a few words.").max(800, "Keep the description under 800 characters."),
  aspectRatio: ratio,
  useLogo: z.boolean().optional(),
  usePhotoPath: optionalText(500),
});

async function businessOf(userId: string) {
  return prisma.business.findUnique({ where: { userId }, select: { id: true } });
}

function revalidate(projectId: string | null) {
  revalidatePath("/dashboard/designs");
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
}

function failure(error: unknown, userId: string): DesignResult {
  if (error instanceof UsageLimitError) return { ok: false, error: "You have used your image credits.", blocked: error.reason };
  if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
  if (error instanceof DesignError) return { ok: false, error: error.message };
  void logError(error, { source: "designs.action", userId });
  return { ok: false, error: FAILED };
}

export async function createTemplateDesign(input: z.input<typeof templateSchema>): Promise<DesignResult> {
  const user = await requireActiveUser();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? FAILED };
  const data = parsed.data;
  if (data.photoPath && !isOwnProjectPhotoPath(user.id, data.photoPath)) return { ok: false, error: "That photo could not be used." };

  const business = await businessOf(user.id);
  if (!business) return { ok: false, error: "Set up your business first." };
  try {
    const { id, path } = await makeTemplateDesign({ userId: user.id, businessId: business.id, ...data, template: data.template });
    revalidate(data.projectId);
    return { ok: true, designId: id, url: await designUrl(path) };
  } catch (error) {
    return failure(error, user.id);
  }
}

export async function createAiDesign(input: z.input<typeof aiSchema>): Promise<DesignResult> {
  const user = await requireActiveUser();
  const parsed = aiSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? FAILED };
  const data = parsed.data;
  if (data.usePhotoPath && !isOwnProjectPhotoPath(user.id, data.usePhotoPath)) return { ok: false, error: "That photo could not be used." };

  const business = await businessOf(user.id);
  if (!business) return { ok: false, error: "Set up your business first." };
  try {
    const { id, path } = await makeAiDesign({ userId: user.id, businessId: business.id, ...data });
    revalidate(data.projectId);
    return { ok: true, designId: id, url: await designUrl(path) };
  } catch (error) {
    return failure(error, user.id);
  }
}

export async function deleteDesign(designId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireActiveUser();
  if (typeof designId !== "string" || !designId) return { ok: false, error: "Design not found." };
  try {
    const removed = await removeDesign(user.id, designId);
    if (!removed) return { ok: false, error: "Design not found." };
    revalidate(null);
    return { ok: true };
  } catch (error) {
    void logError(error, { source: "designs.delete", userId: user.id });
    return { ok: false, error: "We could not delete that design. Please try again." };
  }
}

export async function getDesignDownloadUrl(designId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireActiveUser();
  if (typeof designId !== "string" || !designId) return { ok: false, error: "Design not found." };
  try {
    const url = await designDownloadUrl(user.id, designId);
    return url ? { ok: true, url } : { ok: false, error: "Design not found." };
  } catch (error) {
    void logError(error, { source: "designs.download", userId: user.id });
    return { ok: false, error: "We could not prepare the download. Please try again." };
  }
}
