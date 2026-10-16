"use server";

import { actionMessage, adminAction, finish } from "@/lib/admin/console";
import { createScreenLink, revokeScreenLink } from "@/lib/screen/links";
import { deleteSound, finishSoundUpload, generateSound, setSoundActive, startSoundUpload } from "@/lib/screen/sounds";

// Admin -> Organisation -> Sales screen. adminAction("screen.manage") re-checks the person (owner or staff, AAL2) and the
// permission on every call: server actions are public POST endpoints. Every change is audited in lib/screen/*.

const BACK = "/admin/organisation/screen";

export type CreatedLink = { ok: true; url: string } | { ok: false; error: string };

/** A new screen link. Its full URL is returned once and never stored. */
export async function createScreenLinkAction(name: string): Promise<CreatedLink> {
  const ctx = await adminAction("screen.manage");
  try {
    const { url } = await createScreenLink(ctx, String(name ?? ""));
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

export async function revokeScreenLinkAction(f: FormData) {
  const ctx = await adminAction("screen.manage");
  await finish(BACK, "Link revoked. A screen using it stops within 10 seconds.", () => revokeScreenLink(ctx, String(f.get("id") ?? "")));
}

export type UploadStart = { ok: true; path: string; token: string } | { ok: false; error: string };

export async function startSoundUploadAction(file: { bytes: number; rights: boolean }): Promise<UploadStart> {
  await adminAction("screen.manage");
  try {
    return { ok: true, ...(await startSoundUpload({ bytes: Number(file?.bytes), rights: file?.rights === true })) };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

export async function finishSoundUploadAction(path: string, input: { name: string; rights: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await adminAction("screen.manage");
  try {
    await finishSoundUpload(ctx, String(path ?? ""), { name: String(input?.name ?? ""), rights: input?.rights === true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

/** "Generate a sound" with ElevenLabs Sound Effects (paid, audited, 20 a day). */
export async function generateSoundAction(f: FormData) {
  const ctx = await adminAction("screen.manage");
  await finish(BACK, "Sound generated and added.", () => generateSound(ctx, { name: String(f.get("name") ?? ""), prompt: String(f.get("prompt") ?? ""), seconds: Number(f.get("seconds") ?? 3) }));
}

export async function setSoundActiveAction(f: FormData) {
  const ctx = await adminAction("screen.manage");
  await finish(BACK, "Saved.", () => setSoundActive(ctx, String(f.get("id") ?? ""), f.get("active") === "true"));
}

export async function deleteSoundAction(f: FormData) {
  const ctx = await adminAction("screen.manage");
  await finish(BACK, "Sound deleted.", () => deleteSound(ctx, String(f.get("id") ?? "")));
}
