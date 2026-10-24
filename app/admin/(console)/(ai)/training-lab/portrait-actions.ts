"use server";

import { requireAdmin } from "@/lib/admin/auth";
import { actionMessage, adminAction } from "@/lib/admin/console";
import { createPortraitFromVideo, type UploadSlot } from "@/lib/training-lab/examples";

export type PortraitResult = { ok: true; id: string; upload: UploadSlot | null; warning?: string } | { ok: false; error: string };

/**
 * Makes a new actor example from one frame of an actor's video; the browser then uploads the still to the slot. Owner
 * only (the same checks as every Training Lab action), and the video's example must be an actor with consent.
 */
export async function createPortraitAction(sourceId: string, atSeconds: number, file: unknown): Promise<PortraitResult> {
  const ctx = await adminAction("ai");
  const identity = await requireAdmin();
  try {
    const { id, upload, uploadError } = await createPortraitFromVideo(ctx, identity, String(sourceId ?? ""), Number(atSeconds), file ?? undefined);
    return { ok: true, id, upload, ...(uploadError ? { warning: uploadError } : {}) };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}
