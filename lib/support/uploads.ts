import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { transcribeAudio } from "./ai";
import { UPLOAD_LIMITS, type UploadResponse, type uploadBody } from "./contract";
import { ownConversation } from "./conversations";
import { SupportError, limit } from "./http";
import { ATTACHMENT_TTL_MS, SUPPORT_LIMITS } from "./limits";
import { broadcast } from "./realtime";
import { createUploadSlot, downloadObject, objectInfo, removeObjects } from "./storage";
import { newId } from "./tokens";
import type { VisitorSession } from "./visits";

// Files in the chat (docs/SUPPORT_CHAT.md section 5): screenshots, photos and PDFs up to 10 MB, and voice notes up to
// 2 minutes. The widget asks for a slot (type and size checked here, and again by the bucket), PUTs the file to the
// signed URL, then says it is done; the server checks what really arrived. Voice notes get a transcript from Gemini
// audio on the free tier; when that fails (quota, network) the transcript is "paused" and the audio still goes through.
// Files are deleted 90 days after upload (retention.ts).

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3" };
const ALLOWED: readonly string[] = [...UPLOAD_LIMITS.imageMime, ...UPLOAD_LIMITS.fileMime, ...UPLOAD_LIMITS.voiceMime];

/** Why a file may not be sent, or null. Pure: the same rules the widget checks before sending. */
export function uploadProblem(mime: string, bytes: number, durationSec?: number): string | null {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (!ALLOWED.includes(base)) return "Send a photo (JPG, PNG or WebP), a PDF or a voice note.";
  if (bytes > UPLOAD_LIMITS.maxBytes) return "That file is larger than 10 MB.";
  if (base.startsWith("audio/") && (durationSec ?? 0) > UPLOAD_LIMITS.maxVoiceSec) return "Voice notes can be up to 2 minutes long.";
  return null;
}

export async function createUpload(session: VisitorSession, conversationId: string, body: z.infer<typeof uploadBody>): Promise<UploadResponse> {
  const c = await ownConversation(session, conversationId);
  if (c.status === "CLOSED") throw new SupportError(409, "closed", "This chat has ended. Start a new one to send a file.");
  await limit(`support:upload:${session.visitorId}`, SUPPORT_LIMITS.upload);
  const problem = uploadProblem(body.mime, body.bytes, body.durationSec);
  if (problem) throw new SupportError(400, "file_not_allowed", problem);
  const mime = body.mime.split(";")[0].trim().toLowerCase();
  const id = newId();
  const storagePath = `conv/${conversationId}/${id}.${EXT[mime]}`;
  const slot = await createUploadSlot(storagePath);
  await prisma.supportAttachment.create({
    data: {
      id,
      conversationId,
      storagePath,
      mime,
      bytes: body.bytes,
      fileName: body.fileName?.replace(/[\r\n]/g, " ").trim().slice(0, 200) || null,
      durationSec: mime.startsWith("audio/") ? (body.durationSec ?? null) : null,
      transcriptStatus: mime.startsWith("audio/") ? "pending" : null,
      expiresAt: new Date(Date.now() + ATTACHMENT_TTL_MS),
    },
  });
  return { attachmentId: id, uploadUrl: slot.signedUrl, token: slot.token };
}

/** POST …/uploads/:aid/done: the file is there and fits; voice notes start their transcript. */
export async function finishUpload(session: VisitorSession, conversationId: string, attachmentId: string): Promise<{ attachmentId: string }> {
  await ownConversation(session, conversationId);
  const a = await prisma.supportAttachment.findUnique({ where: { id: attachmentId }, select: { id: true, conversationId: true, storagePath: true, mime: true, uploadedAt: true } });
  if (!a || a.conversationId !== conversationId) throw new SupportError(404, "attachment_not_found", "That file was not found. Please attach it again.");
  if (a.uploadedAt) return { attachmentId };
  const info = await objectInfo(a.storagePath);
  if (!info) throw new SupportError(409, "not_uploaded", "The file did not arrive. Please try again.");
  if (info.bytes > UPLOAD_LIMITS.maxBytes || (info.mime && info.mime.split(";")[0] !== a.mime)) {
    await removeObjects([a.storagePath]).catch(() => {});
    await prisma.supportAttachment.delete({ where: { id: a.id } });
    throw new SupportError(400, "file_not_allowed", "That file is not what was announced, or larger than 10 MB.");
  }
  await prisma.supportAttachment.update({ where: { id: a.id }, data: { uploadedAt: new Date(), bytes: info.bytes } });
  // Before the message is sent, so the AI (and the agent) read the words, not just "Voice note". A few seconds at most.
  if (a.mime.startsWith("audio/")) await transcribe(a.id);
  return { attachmentId };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The voice note's transcript, or "paused" when the free tier cannot do it now. Never throws. */
export async function transcribe(attachmentId: string): Promise<void> {
  const a = await prisma.supportAttachment.findUnique({ where: { id: attachmentId }, select: { id: true, conversationId: true, storagePath: true, mime: true } });
  if (!a) return;
  try {
    const bytes = await downloadObject(a.storagePath);
    const transcript = await transcribeAudio({ base64: toBase64(bytes), mime: a.mime });
    await prisma.supportAttachment.update({ where: { id: a.id }, data: { transcript, transcriptStatus: "done" } });
  } catch (error) {
    await prisma.supportAttachment.update({ where: { id: a.id }, data: { transcriptStatus: "paused" } }).catch(() => {});
    await logError(error, { source: "support.voice", level: "warn" });
  }
  await broadcast({ type: "conversation.updated", conversationId: a.conversationId, fields: ["transcript"] }, { conversation: a.conversationId, inbox: true });
}
