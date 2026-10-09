import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { designObjectPath, imageSize, isOwnDesignPath } from "@/lib/designs/assets";
import { RATE_LIMITS, RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { CanvaApiError, createDesign, exportDesignPng, uploadAsset } from "./client";
import { CanvaTimeoutError } from "./jobs";
import { randomToken } from "./pkce";
import { ReturnTokenError, unwrapJwt, verifyReturnJwt } from "./return-jwt";
import { CanvaNotConnectedError, CanvaReconnectError, withCanva } from "./tokens";

/** A problem the user can read; `code` lets the UI offer the right next step. */
export class CanvaError extends Error {
  constructor(
    message: string,
    public code: "not_connected" | "reconnect" | "not_found" | "timeout" | "processing" | "failed",
  ) {
    super(message);
  }
}

const SESSION_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const CLAIM_STALE_MS = 2 * 60 * 1000;
/** Whole return job (export, download, save). Cloudflare lets background work run ~30 s after the response, so the route waits 30 s and this leaves the rest. */
const RETURN_BUDGET_MS = 55 * 1000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

/** Turns known failures into a CanvaError with friendly text; unknown ones are logged and made generic. */
async function friendly(error: unknown, source: string, userId: string): Promise<CanvaError> {
  if (error instanceof CanvaError) return error;
  if (error instanceof RateLimitError) return new CanvaError(rateLimitMessage(error), "timeout");
  if (error instanceof CanvaNotConnectedError) return new CanvaError("Connect your Canva account first.", "not_connected");
  if (error instanceof CanvaReconnectError) return new CanvaError("Canva access was removed. Please connect Canva again.", "reconnect");
  if (error instanceof CanvaTimeoutError) return new CanvaError("Canva is taking longer than usual. Please try again in a minute.", "timeout");
  if (error instanceof CanvaApiError) {
    if (error.status === 429) return new CanvaError("Canva is busy right now. Please try again in a minute.", "timeout");
    if (error.status === 403) return new CanvaError("Canva did not allow that. Please connect Canva again and accept all permissions.", "reconnect");
    await logError(error, { source, userId, status: error.status, code: error.code });
    return new CanvaError("Canva could not complete that. Please try again.", "failed");
  }
  await logError(error, { source, userId });
  return new CanvaError("Something went wrong with Canva. Please try again.", "failed");
}

async function ownDesign(userId: string, designId: string) {
  const design = await prisma.design.findFirst({ where: { id: designId, business: { userId } } });
  return design && isOwnDesignPath(userId, design.path) ? design : null;
}

/**
 * Uploads the design to the user's Canva, creates an editable Canva design from it and returns the URL to open.
 * `userId` is the company account (the design belongs to the company); `actorId` is the person whose own Canva account
 * is used. Canva tokens are personal: every teammate connects their own Canva, and designs stay the company's.
 */
export async function openDesignInCanva(userId: string, designId: string, actorId: string = userId): Promise<{ url: string }> {
  try {
    const design = await ownDesign(userId, designId);
    if (!design) throw new CanvaError("We could not find that design.", "not_found");
    await rateLimit(`canva-open:${actorId}`, RATE_LIMITS.canvaOpen);

    const file = await (await createClient()).storage.from("designs").download(design.path);
    if (file.error || !file.data) throw new CanvaError("We could not load that design. Please try again.", "failed");
    const bytes = new Uint8Array(await file.data.arrayBuffer());

    // Separate calls: if the token is refreshed after a 401, only the failed step is repeated (no second upload).
    const assetId = await withCanva(actorId, (token) => uploadAsset(token, "BuPulse design", bytes));
    const created = await withCanva(actorId, (token) => createDesign(token, { assetId, title: "BuPulse design", width: design.width, height: design.height }));

    const id = randomToken(16);
    await prisma.canvaEdit.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - SESSION_MAX_AGE_MS) } } });
    await prisma.canvaEdit.create({ data: { id, userId: actorId, designId: design.id, canvaDesignId: created.id } });

    const url = new URL(created.editUrl);
    url.searchParams.set("correlation_state", id);
    return { url: url.toString() };
  } catch (error) {
    throw await friendly(error, "canva.open", actorId);
  }
}

export type ReturnJob = {
  /** The company account (the design's owner) and the person whose Canva session this is. */
  userId: string;
  actorId: string;
  editId: string;
  canvaDesignId: string;
  original: NonNullable<Awaited<ReturnType<typeof ownDesign>>>;
  deadline: number;
};

/**
 * First half of a return: checks the Canva token, that the session is this user's and the original is
 * theirs, and claims the session so two returns cannot save at once. Call finishCanvaReturn next;
 * it releases the claim.
 */
export async function startCanvaReturn(userId: string, jwtParam: string, actorId: string = userId): Promise<ReturnJob> {
  try {
    await rateLimit(`canva-return:${actorId}`, RATE_LIMITS.canvaReturn);
    let claims;
    try {
      claims = await verifyReturnJwt(unwrapJwt(jwtParam));
    } catch (error) {
      if (error instanceof ReturnTokenError) throw new CanvaError("That Canva link is no longer valid. Open the design in Canva again.", "failed");
      throw error;
    }

    const edit = await prisma.canvaEdit.findFirst({ where: { id: claims.correlation_state, userId: actorId } });
    if (!edit || edit.canvaDesignId !== claims.design_id) throw new CanvaError("We could not match that Canva design to your account.", "not_found");
    const original = await ownDesign(userId, edit.designId);
    if (!original) throw new CanvaError("The original design no longer exists.", "not_found");

    const claimed = await prisma.canvaEdit.updateMany({
      where: { id: edit.id, userId: actorId, OR: [{ processingAt: null }, { processingAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } }] },
      data: { processingAt: new Date() },
    });
    if (claimed.count !== 1) throw new CanvaError("That edit is already being saved. Give it a moment, then check your designs.", "processing");
    return { userId, actorId, editId: edit.id, canvaDesignId: edit.canvaDesignId, original, deadline: Date.now() + RETURN_BUDGET_MS };
  } catch (error) {
    throw await friendly(error, "canva.return", actorId);
  }
}

/**
 * Second half: exports the edited design and saves it as a NEW design next to the original (a version
 * history without a schema change: Design has no parent link, and the original stays untouched). The
 * session is kept, so pressing "Return to BuPulse" again saves the latest state again.
 */
export async function finishCanvaReturn(job: ReturnJob): Promise<{ designId: string }> {
  const { userId, actorId, original } = job;
  let path: string | null = null;
  let stored = false;
  const storage = (await createClient()).storage.from("designs");
  try {
    const png = await withCanva(actorId, (token) => exportDesignPng(token, job.canvaDesignId, { width: original.width, height: original.height }, job.deadline));
    if (!PNG_MAGIC.every((byte, i) => png[i] === byte)) throw new CanvaError("Canva sent a file we could not read. Please try again.", "failed");

    const id = globalThis.crypto.randomUUID();
    path = designObjectPath(userId, id, "image/png");
    const { error: uploadError } = await storage.upload(path, png, { contentType: "image/png", upsert: false });
    if (uploadError) throw new Error(`Could not store the edited design: ${uploadError.message}`);
    const { width, height } = imageSize(png, original.aspectRatio as Parameters<typeof imageSize>[1]);
    await prisma.design.create({
      data: {
        id,
        businessId: original.businessId,
        projectId: original.projectId,
        kind: original.kind,
        template: original.template,
        prompt: original.prompt,
        aspectRatio: original.aspectRatio,
        path,
        width,
        height,
      },
    });
    stored = true;
    return { designId: id };
  } catch (error) {
    throw await friendly(error, "canva.return", actorId);
  } finally {
    // Never leave a file without a design row, and always free the session for the next try.
    try {
      if (path && !stored) await storage.remove([path]);
    } catch {}
    try {
      await prisma.canvaEdit.updateMany({ where: { id: job.editId, userId: actorId }, data: { processingAt: null } });
    } catch {}
  }
}

export async function completeCanvaReturn(userId: string, jwtParam: string, actorId: string = userId): Promise<{ designId: string }> {
  return finishCanvaReturn(await startCanvaReturn(userId, jwtParam, actorId));
}
