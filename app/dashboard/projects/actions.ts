"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { AIProviderError } from "@/lib/ai/types";
import { requireActiveUser } from "@/lib/auth/require-user";
import { flatErrors } from "@/lib/brand/schemas";
import { logError } from "@/lib/errors";
import {
  editedContentSchema,
  instructionSchema,
  isOwnPhotoPath,
  MAX_PROJECT_PHOTOS,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  projectInputSchema,
  type ProjectInput,
} from "@/lib/studio/schemas";
import { generateForProject, StudioNotFoundError, variantsJson } from "@/lib/studio/service";
import { buildObjectPath, createSignedDownloadUrl, createSignedUploadUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { UsageLimitError, type UsageBlockReason } from "@/lib/usage";

export type ActionFailure = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string>;
  blocked?: UsageBlockReason;
  projectId?: string;
};
export type PhotoUploadResult = { ok: true; path: string; token: string } | ActionFailure;
export type ProjectResult = { ok: true; projectId: string; contentId?: string } | ActionFailure;
export type ContentResult = { ok: true; contentId: string } | ActionFailure;
export type DeleteResult = { ok: true } | ActionFailure;
export type PhotoUrlsResult = { ok: true; urls: { path: string; url: string }[] } | ActionFailure;

const SAVE_FAILED = "We could not save that. Please try again.";
const NOT_FOUND: ActionFailure = { ok: false, error: "We could not find that." };
const GENERATE_FAILED = "We could not write your content just now. You were not charged, please try again.";

/** Every action re-checks the signed-in user and only touches their own business. */
const requireUser = requireActiveUser;

async function ownBusiness(userId: string) {
  return prisma.business.findUnique({ where: { userId }, select: { id: true } });
}

function refresh(projectId?: string) {
  revalidatePath("/dashboard/projects");
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/content");
  // The usage meters in the app shell.
  revalidatePath("/dashboard", "layout");
}

async function removePhotos(userId: string, paths: string[]) {
  const own = paths.filter((p) => isOwnPhotoPath(userId, p));
  if (own.length === 0) return;
  try {
    await (await createClient()).storage.from("media").remove(own);
  } catch {}
}

/** Turns a failed generation into the action result: usage blocks and AI errors are expected, the rest is logged. */
async function generationFailure(error: unknown, projectId?: string): Promise<ActionFailure> {
  if (error instanceof StudioNotFoundError) return NOT_FOUND;
  if (error instanceof UsageLimitError) {
    return { ok: false, error: "Your plan does not allow new content right now.", blocked: error.reason, projectId };
  }
  if (!(error instanceof AIProviderError)) await logError(error, { source: "studio.generate", level: "error" });
  return { ok: false, error: GENERATE_FAILED, projectId };
}

/** Signed URL so the browser can upload one project photo straight to the private media bucket. */
export async function createPhotoUpload(input: { fileName: string; type: string; size: number }): Promise<PhotoUploadResult> {
  const user = await requireUser();
  if (!(PHOTO_TYPES as readonly string[]).includes(input.type)) return { ok: false, error: "Use a PNG, JPG or WebP photo." };
  if (!(input.size > 0) || input.size > PHOTO_MAX_BYTES) return { ok: false, error: "Each photo must be 10 MB or smaller." };
  try {
    const { path, token } = await createSignedUploadUrl("media", buildObjectPath(user.id, input.fileName, "projects"));
    return { ok: true, path, token };
  } catch {
    return { ok: false, error: "We could not start the upload. Please try again." };
  }
}

export async function createProject(input: ProjectInput): Promise<ProjectResult> {
  const user = await requireUser();
  const parsed = projectInputSchema(user.id).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flatErrors(parsed.error) };
  const business = await ownBusiness(user.id);
  if (!business) return { ok: false, error: "Set up your business first." };

  const { details, ...data } = parsed.data;
  let projectId: string;
  try {
    const project = await prisma.project.create({
      data: { ...data, businessId: business.id, details: details ? { notes: details } : undefined },
      select: { id: true },
    });
    projectId = project.id;
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
  refresh(projectId);
  if (!input.generate) return { ok: true, projectId };

  try {
    const content = await generateForProject({ userId: user.id, businessId: business.id, projectId, feature: "content" });
    refresh(projectId);
    return { ok: true, projectId, contentId: content.id };
  } catch (error) {
    return generationFailure(error, projectId);
  }
}

export async function updateProject(projectId: string, input: ProjectInput): Promise<ProjectResult> {
  const user = await requireUser();
  const parsed = projectInputSchema(user.id).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flatErrors(parsed.error) };
  const business = await ownBusiness(user.id);
  if (!business) return NOT_FOUND;
  const existing = await prisma.project.findFirst({ where: { id: projectId, businessId: business.id }, select: { photoPaths: true } });
  if (!existing) return NOT_FOUND;

  const { details, ...data } = parsed.data;
  try {
    await prisma.project.update({ where: { id: projectId }, data: { ...data, details: details ? { notes: details } : Prisma.DbNull } });
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
  await removePhotos(user.id, existing.photoPaths.filter((p) => !data.photoPaths.includes(p)));
  refresh(projectId);
  return { ok: true, projectId };
}

export async function deleteProject(projectId: string): Promise<DeleteResult> {
  const user = await requireUser();
  const business = await ownBusiness(user.id);
  if (!business) return NOT_FOUND;
  const project = await prisma.project.findFirst({ where: { id: projectId, businessId: business.id }, select: { photoPaths: true } });
  if (!project) return NOT_FOUND;
  try {
    await prisma.project.delete({ where: { id: projectId } });
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
  await removePhotos(user.id, project.photoPaths);
  refresh();
  return { ok: true };
}

/** A new content version for the project: the first one, or a regeneration with an optional note. */
export async function generateContent(projectId: string, input: { instruction?: string } = {}): Promise<ContentResult> {
  const user = await requireUser();
  const instruction = instructionSchema.safeParse(input?.instruction);
  if (!instruction.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: { instruction: "Use 500 characters or fewer." } };
  const business = await ownBusiness(user.id);
  if (!business) return NOT_FOUND;
  const project = await prisma.project.findFirst({
    where: { id: projectId, businessId: business.id },
    select: { id: true, _count: { select: { contents: true } } },
  });
  if (!project) return NOT_FOUND;

  try {
    const content = await generateForProject({
      userId: user.id,
      businessId: business.id,
      projectId,
      instruction: instruction.data,
      feature: project._count.contents > 0 ? "regenerate" : "content",
    });
    refresh(projectId);
    return { ok: true, contentId: content.id };
  } catch (error) {
    return generationFailure(error, projectId);
  }
}

/** Saves the owner's edits as a new version. Costs no credit. */
export async function saveEditedContent(
  contentId: string,
  input: { caption: string; hashtags: string[]; videoScript: string; adHeadlines: string[] },
): Promise<ContentResult> {
  const user = await requireUser();
  const parsed = editedContentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flatErrors(parsed.error) };
  const business = await ownBusiness(user.id);
  if (!business) return NOT_FOUND;
  const base = await prisma.generatedContent.findFirst({
    where: { id: contentId, project: { businessId: business.id } },
    select: { projectId: true, language: true },
  });
  if (!base) return NOT_FOUND;

  const { caption, videoScript, adHeadlines } = parsed.data;
  const hashtags = parsed.data.hashtags.map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  try {
    const saved = await prisma.generatedContent.create({
      data: {
        projectId: base.projectId,
        caption,
        hashtags,
        videoScript,
        adHeadlines,
        language: base.language,
        variants: variantsJson({ caption, hashtags, videoScript }),
        edited: true,
        provider: "edit",
        model: "owner",
      },
      select: { id: true },
    });
    refresh(base.projectId);
    return { ok: true, contentId: saved.id };
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
}

export async function getPhotoUrls(projectId: string): Promise<PhotoUrlsResult> {
  const user = await requireUser();
  const business = await ownBusiness(user.id);
  if (!business) return NOT_FOUND;
  const project = await prisma.project.findFirst({ where: { id: projectId, businessId: business.id }, select: { photoPaths: true } });
  if (!project) return NOT_FOUND;

  const settled = await Promise.allSettled(
    project.photoPaths.slice(0, MAX_PROJECT_PHOTOS).map(async (path) => ({ path, url: await createSignedDownloadUrl("media", path) })),
  );
  return { ok: true, urls: settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])) };
}
