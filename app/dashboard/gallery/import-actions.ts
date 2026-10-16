"use server";

import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/require-user";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import type { FeatureKey } from "@/lib/features";
import { logError } from "@/lib/errors";
import { CanvaImportError, importCanvaDesign, importDriveFile, importDropboxFile, importOptions, listCanvaDesigns, type ImportOptions } from "@/lib/media/importers";
import { businessIdFor, MediaError, type MediaItem } from "@/lib/media/service";
import { RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import type { CanvaDesignSummary } from "@/lib/canva/client";

export type ImportResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; needsConnect?: boolean };

const FAILED = "Something went wrong. Please try again.";
/** Where the photo goes: "folder:<id>", "product:<id>" or "campaign:<id>" (lib/media/destinations.ts); required. */
const destination = z.string().max(80).nullish().transform((v) => v || null);

type Ctx = { userId: string; businessId: string };

/** Every import needs the gallery; Drive and Dropbox need driveImport, Canva needs canva (each a plan feature). */
async function guard<T extends object>(fn: (ctx: Ctx) => Promise<T>, feature: FeatureKey = "gallery"): Promise<ImportResult<T>> {
  const user = await requireActiveUser();
  try {
    const businessId = await businessIdFor(user.id);
    if (!businessId) return { ok: false, error: "Set up your business first." };
    await assertFeature(businessId, "gallery");
    await assertFeature(businessId, feature);
    return { ok: true, ...(await fn({ userId: user.id, businessId })) };
  } catch (error) {
    if (error instanceof CanvaImportError) return { ok: false, error: error.message, needsConnect: error.needsConnect || undefined };
    if (error instanceof MediaError || error instanceof FeatureRequiredError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    void logError(error, { source: "gallery.import", userId: user.id });
    return { ok: false, error: FAILED };
  }
}

/** Which importers are set up, and the public keys the browser needs to open their pickers. */
export async function getImportOptions(): Promise<ImportResult<{ options: ImportOptions }>> {
  return guard(async ({ userId }) => ({ options: await importOptions(userId) }));
}

const driveSchema = z.object({ token: z.string().min(10).max(4096), fileId: z.string().min(8).max(128), destination });

/** Imports one file the person picked in Google Picker. The token is used for this call and not stored. */
export async function importFromDrive(input: z.input<typeof driveSchema>): Promise<ImportResult<{ item: MediaItem }>> {
  const parsed = driveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That file could not be imported." };
  return guard(async (ctx) => ({ item: await importDriveFile(ctx, parsed.data) }), "driveImport");
}

const dropboxSchema = z.object({ link: z.string().url().max(2000), name: z.string().min(1).max(260), destination });

/** Imports one file from a Dropbox Chooser direct link. */
export async function importFromDropbox(input: z.input<typeof dropboxSchema>): Promise<ImportResult<{ item: MediaItem }>> {
  const parsed = dropboxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That file could not be imported." };
  return guard(async (ctx) => ({ item: await importDropboxFile(ctx, parsed.data) }), "driveImport");
}

const listSchema = z.object({ query: z.string().max(100).optional(), cursor: z.string().max(500).nullish() });

export async function listFromCanva(input: z.input<typeof listSchema>): Promise<ImportResult<{ items: CanvaDesignSummary[]; nextCursor: string | null }>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: FAILED };
  return guard(({ userId }) => listCanvaDesigns(userId, parsed.data), "canva");
}

const canvaSchema = z.object({ designId: z.string().min(6).max(64), title: z.string().max(260), destination });

/** Exports one Canva design as a PNG and adds it to the gallery. */
export async function importFromCanva(input: z.input<typeof canvaSchema>): Promise<ImportResult<{ item: MediaItem }>> {
  const parsed = canvaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That design could not be imported." };
  return guard(async (ctx) => ({ item: await importCanvaDesign(ctx, parsed.data) }), "canva");
}
