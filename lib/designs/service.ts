import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { withLedger } from "@/lib/ai/ledger";
import { getImageProvider } from "@/lib/ai/image";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { refundUsage, consumeUsage } from "@/lib/usage";
import { createClient } from "@/lib/supabase/server";
import { designObjectPath, imageSize, isOwnDesignPath, isOwnObjectPath, isOwnProjectPhotoPath, toDataUrl } from "./assets";
import { ASPECT_SIZES, type AspectRatio } from "./layout";
import { buildImagePrompt } from "./prompt";
import { isTemplateId, renderTemplate, TEMPLATES } from "./templates";

/** A problem the user can read and act on. Anything else is an unexpected failure. */
export class DesignError extends Error {}

const PHOTO_MAX_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_SECONDS = 60 * 60;
const IMAGE_FEATURE = "image";

type Owner = { userId: string; businessId: string; projectId?: string | null };

async function requireOwned({ userId, businessId, projectId }: Owner) {
  const business = await prisma.business.findFirst({ where: { id: businessId, userId } });
  if (!business) throw new DesignError("We could not find your business.");
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, businessId }, select: { id: true } });
    if (!project) throw new DesignError("We could not find that project.");
  }
  return business;
}

const TEMPLATE_TYPES = ["image/png", "image/jpeg"];
const AI_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Reads an own file from Storage as a data URL (Satori and Gemini cannot use private URLs).
 * The size and type are checked on the object's metadata first, so an oversized file is never downloaded.
 */
async function loadImage(bucket: "media" | "brand", path: string, options: { maxBytes: number; types: string[]; resize?: boolean }) {
  const storage = (await createClient()).storage.from(bucket);
  const info = await storage.info(path);
  if (info.error || !info.data) return null;
  const { size, contentType } = info.data;
  if (!contentType || !options.types.includes(contentType)) throw new DesignError(UNSUPPORTED_PHOTO);
  if (size === undefined || size > options.maxBytes) throw new DesignError("That photo is too large. Please use one under 12 MB.");

  // Resizing needs Supabase's image transformations; without them the original (within the cap) is used.
  let result = options.resize ? await storage.download(path, { transform: { width: 1600, quality: 82 } }) : await storage.download(path);
  if (result.error && options.resize) result = await storage.download(path);
  if (result.error || !result.data) return null;
  const bytes = new Uint8Array(await result.data.arrayBuffer());
  if (bytes.length > options.maxBytes) throw new DesignError("That photo is too large. Please use one under 12 MB.");
  // Satori cannot decode WebP, whatever the stored content type says.
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (isWebp && !options.types.includes("image/webp")) throw new DesignError(UNSUPPORTED_PHOTO);
  return toDataUrl(bytes, isWebp ? "image/webp" : result.data.type || contentType);
}

const UNSUPPORTED_PHOTO = "Templates need a JPG or PNG photo. Please pick or upload a different one.";

async function loadPhoto(userId: string, photoPath: string | null | undefined, types: string[]) {
  if (!photoPath) return null;
  if (!isOwnProjectPhotoPath(userId, photoPath)) throw new DesignError("That photo could not be used.");
  const photo = await loadImage("media", photoPath, { maxBytes: PHOTO_MAX_BYTES, types, resize: true });
  if (!photo) throw new DesignError("That photo could not be loaded. Please pick it again.");
  return photo;
}

async function loadLogo(userId: string, logoPath: string | null, types = ["image/png", "image/jpeg", "image/svg+xml"]) {
  if (!logoPath || !isOwnObjectPath(userId, logoPath)) return null;
  try {
    return await loadImage("brand", logoPath, { maxBytes: 5 * 1024 * 1024, types });
  } catch {
    return null;
  }
}

async function store(userId: string, designId: string, bytes: Uint8Array, mimeType: string) {
  const path = designObjectPath(userId, designId, mimeType);
  const { error } = await (await createClient()).storage.from("designs").upload(path, bytes, { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Could not store the design: ${error.message}`);
  return path;
}

async function removeFile(path: string) {
  try {
    await (await createClient()).storage.from("designs").remove([path]);
  } catch {}
}

export type CreatedDesign = { id: string; path: string };

export async function createTemplateDesign(input: Owner & {
  template: string;
  aspectRatio: AspectRatio;
  headline: string;
  subline?: string | null;
  chip?: string | null;
  kicker?: string | null;
  photoPath?: string | null;
}): Promise<CreatedDesign> {
  if (!isTemplateId(input.template)) throw new DesignError("Pick one of the templates.");
  await rateLimit(`design:${input.userId}`, RATE_LIMITS.templateDesign);
  const business = await requireOwned(input);
  const [photoDataUrl, logoDataUrl] = await Promise.all([loadPhoto(input.userId, input.photoPath, TEMPLATE_TYPES), loadLogo(input.userId, business.logoUrl)]);

  let png: ArrayBuffer;
  try {
    png = await renderTemplate(
      input.template,
      {
        businessName: business.name,
        logoDataUrl,
        colors: business.brandColors,
        photoDataUrl,
        headline: input.headline,
        subline: input.subline,
        chip: input.chip,
        kicker: input.kicker,
      },
      input.aspectRatio,
    );
  } catch (error) {
    await logError(error, { source: "designs.render", userId: input.userId, template: input.template });
    throw new DesignError(photoDataUrl ? "We could not draw that design. Try another photo, a JPG or PNG." : "We could not draw that design. Please try again.");
  }

  const id = globalThis.crypto.randomUUID();
  const path = await store(input.userId, id, new Uint8Array(png), "image/png");
  const { width, height } = ASPECT_SIZES[input.aspectRatio];
  try {
    await prisma.design.create({
      data: { id, businessId: business.id, projectId: input.projectId ?? null, kind: "TEMPLATE", template: input.template, aspectRatio: input.aspectRatio, path, width, height },
    });
  } catch (error) {
    await removeFile(path);
    throw error;
  }
  return { id, path };
}

/** Uses one image credit. The credit is given back when no design could be made. */
export async function createAiDesign(input: Owner & {
  prompt: string;
  aspectRatio: AspectRatio;
  useLogo?: boolean;
  usePhotoPath?: string | null;
}): Promise<CreatedDesign> {
  await rateLimit(`design:${input.userId}`, RATE_LIMITS.templateDesign);
  const business = await requireOwned(input);
  if (input.usePhotoPath && !isOwnProjectPhotoPath(input.userId, input.usePhotoPath)) throw new DesignError("That photo could not be used.");

  // Throws UsageLimitError when the plan has no image credits left.
  const { periodStart } = await consumeUsage(input.userId, "image");
  try {
    const [logo, photo] = await Promise.all([
      input.useLogo ? loadLogo(input.userId, business.logoUrl, [...AI_TYPES, "image/svg+xml"]) : null,
      loadPhoto(input.userId, input.usePhotoPath, AI_TYPES),
    ]);
    const references = [photo, logo].filter((r): r is string => !!r);
    const prompt = buildImagePrompt({ business, prompt: input.prompt, aspectRatio: input.aspectRatio, hasLogo: !!logo, hasPhoto: !!photo });

    const provider = getImageProvider();
    const image = await withLedger(
      { userId: input.userId, businessId: business.id, feature: IMAGE_FEATURE },
      { provider: provider.name, model: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image" },
      () => provider.generate({ prompt, aspectRatio: input.aspectRatio, referenceImageUrls: references }),
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage, images: 1 }),
    );

    const id = globalThis.crypto.randomUUID();
    const path = await store(input.userId, id, image.data, image.mimeType);
    const { width, height } = imageSize(image.data, input.aspectRatio);
    try {
      await prisma.design.create({
        data: { id, businessId: business.id, projectId: input.projectId ?? null, kind: "AI", prompt: input.prompt, aspectRatio: input.aspectRatio, path, width, height },
      });
    } catch (error) {
      await removeFile(path);
      throw error;
    }
    return { id, path };
  } catch (error) {
    // Giving the credit back must never hide the original error.
    try {
      await refundUsage(input.userId, "image", periodStart);
    } catch (refundError) {
      await logError(refundError, { source: "designs.refund", userId: input.userId });
    }
    throw error;
  }
}

async function ownDesign(userId: string, designId: string) {
  const design = await prisma.design.findFirst({ where: { id: designId, business: { userId } } });
  if (!design || !isOwnDesignPath(userId, design.path)) return null;
  return design;
}

export async function deleteDesign(userId: string, designId: string): Promise<boolean> {
  const design = await ownDesign(userId, designId);
  if (!design) return false;
  await removeFile(design.path);
  await prisma.design.delete({ where: { id: design.id } });
  return true;
}

/** Signed URL for one design file. `download` makes the browser save it instead of showing it. */
export async function designUrl(path: string, options: { download?: string } = {}): Promise<string> {
  const { data, error } = await (await createClient()).storage
    .from("designs")
    .createSignedUrl(path, DOWNLOAD_SECONDS, options.download ? { download: options.download } : undefined);
  if (error || !data) throw error ?? new Error("Could not sign the design URL");
  return data.signedUrl;
}

export async function designDownloadUrl(userId: string, designId: string): Promise<string | null> {
  const design = await ownDesign(userId, designId);
  if (!design) return null;
  const ext = design.path.split(".").pop() ?? "png";
  return designUrl(design.path, { download: `${design.template ?? "design"}-${design.aspectRatio.replace(":", "x")}.${ext}` });
}

/** Signed display URLs for many designs at once; designs whose file is missing are left out. */
export async function designUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data } = await (await createClient()).storage.from("designs").createSignedUrls(paths, DOWNLOAD_SECONDS);
  for (const item of data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  return urls;
}

/** The business's designs, newest first, with signed URLs, in the shape <DesignStudio designs> expects. */
export async function listDesigns(userId: string, options: { projectId?: string; take?: number } = {}) {
  const rows = await prisma.design.findMany({
    where: { business: { userId }, ...(options.projectId ? { projectId: options.projectId } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 60,
  });
  const urls = await designUrls(rows.map((r) => r.path));
  return rows.flatMap((r) => {
    const url = urls.get(r.path);
    return url ? [{ id: r.id, url, kind: r.kind, aspectRatio: r.aspectRatio, template: r.template }] : [];
  });
}

/** A template drawn with the business's own name, logo and colours and sample text, for the picker. Nothing is stored or charged. */
export async function previewTemplate(userId: string, template: string, aspectRatio: AspectRatio): Promise<ArrayBuffer | null> {
  const info = TEMPLATES.find((t) => t.id === template);
  if (!info) return null;
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) return null;
  const logoDataUrl = await loadLogo(userId, business.logoUrl);
  return renderTemplate(
    info.id,
    {
      businessName: business.name,
      logoDataUrl,
      colors: business.brandColors,
      headline: info.fields.headline.placeholder,
      subline: info.fields.subline.placeholder,
      chip: info.fields.chip.placeholder,
    },
    aspectRatio,
  );
}

/** Signed URLs for a project's photos (media bucket), same order as `paths`; own files only, "" for any that fail. */
export async function photoPreviewUrls(userId: string, paths: string[]): Promise<string[]> {
  const own = paths.filter((p) => isOwnObjectPath(userId, p));
  if (own.length === 0) return paths.map(() => "");
  const { data } = await (await createClient()).storage.from("media").createSignedUrls(own, DOWNLOAD_SECONDS);
  const byPath = new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
  return paths.map((p) => byPath.get(p) ?? "");
}
