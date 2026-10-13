"use server";

import { adminAction, actionMessage, finish } from "@/lib/admin/console";
import { deleteTrack, finishTrackUpload, generateTrack, setTrackActive, startTrackUpload } from "@/lib/music/service";
import { isMood, type TrackInput } from "@/lib/music/tracks";

// The music library (docs/VOICE_AND_MUSIC.md). adminAction("content") re-checks the admin (allow-listed email, AAL2) on every
// call: server actions are public POST endpoints. Uploads go straight to Storage with a signed URL, then are checked.

export type UploadStart = { ok: true; path: string; token: string } | { ok: false; error: string };

export async function startTrackUploadAction(file: { mimeType: string; bytes: number }): Promise<UploadStart> {
  await adminAction("content");
  try {
    return { ok: true, ...(await startTrackUpload({ mimeType: String(file?.mimeType ?? ""), bytes: Number(file?.bytes) })) };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

export async function finishTrackUploadAction(path: string, input: TrackInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await adminAction("content");
  try {
    const moods = Array.isArray(input?.moods) ? input.moods.filter(isMood) : [];
    await finishTrackUpload(ctx, String(path ?? ""), { ...input, moods, bpm: input?.bpm ? Number(input.bpm) : null });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

export async function setTrackActiveAction(f: FormData) {
  const ctx = await adminAction("content");
  await finish("/admin/music", () => "Saved.", () => setTrackActive(ctx, String(f.get("id") ?? ""), f.get("active") === "true"));
}

export async function deleteTrackAction(f: FormData) {
  const ctx = await adminAction("content");
  await finish("/admin/music", () => "Track removed.", () => deleteTrack(ctx, String(f.get("id") ?? "")));
}

/** "Generate a track" with ElevenLabs Music (paid, audited, 20 a day). */
export async function generateTrackAction(f: FormData) {
  const ctx = await adminAction("content");
  await finish("/admin/music", () => "Track generated and added.", () =>
    generateTrack(ctx, { title: String(f.get("title") ?? ""), prompt: String(f.get("prompt") ?? ""), mood: String(f.get("mood") ?? "") as never, seconds: Number(f.get("seconds") ?? 30) }),
  );
}
