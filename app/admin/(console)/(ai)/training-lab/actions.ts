"use server";

import { refresh } from "next/cache";
import type { ConfirmResult } from "@/components/admin/confirm-button";
import { requireAdmin } from "@/lib/admin/auth";
import { actionMessage, adminAction, finish } from "@/lib/admin/console";
import { ENGINE_LABELS, type TrainingEngine } from "@/lib/training-lab/types";
import { confirmExampleFile, createExample, deleteExample, rateExample, setExampleEngine, startExampleUpload, updateExample, type UploadSlot } from "@/lib/training-lab/examples";

// The Training Lab (docs/TRAINING_LAB.md). Each action re-checks the admin (allow-listed email, AAL2, the "ai" area)
// and lib/training-lab/examples.ts then refuses anyone but the owner from ADMIN_EMAILS: server actions are public POST
// endpoints, so the page's check is never enough. Files go straight to Storage with a signed upload address.

const BACK = "/admin/training-lab";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
/** Back to the list with its filters and the example in view; never anywhere else. */
const backOf = (f: FormData) => {
  const back = text(f, "back");
  return back === BACK || back.startsWith(`${BACK}?`) || back.startsWith(`${BACK}#`) ? back : BACK;
};

async function owner() {
  const ctx = await adminAction("ai");
  return { ctx, identity: await requireAdmin() };
}

export type SaveResult = { ok: true; id: string; upload: UploadSlot | null; warning?: string } | { ok: false; error: string };
export type StepResult = { ok: true } | { ok: false; error: string };
export type UploadResult = ({ ok: true } & UploadSlot) | { ok: false; error: string };

/** Saves a new example; with a file, also the address the browser uploads it to. */
export async function createExampleAction(input: unknown, file: unknown): Promise<SaveResult> {
  const { ctx, identity } = await owner();
  try {
    const { id, upload, uploadError } = await createExample(ctx, identity, input, file ?? undefined);
    return { ok: true, id, upload, ...(uploadError ? { warning: uploadError } : {}) };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

export async function updateExampleAction(id: string, input: unknown): Promise<StepResult> {
  const { ctx, identity } = await owner();
  try {
    await updateExample(ctx, identity, String(id ?? ""), input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

/** An address for a new or replacement file on an existing example. */
export async function startExampleUploadAction(id: string, file: unknown): Promise<UploadResult> {
  const { ctx, identity } = await owner();
  try {
    return { ok: true, ...(await startExampleUpload(ctx, identity, String(id ?? ""), file)) };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

/** The browser uploaded the file: the server checks it and points the example at it. */
export async function confirmExampleFileAction(id: string, path: string): Promise<StepResult> {
  const { ctx, identity } = await owner();
  try {
    await confirmExampleFile(ctx, identity, String(id ?? ""), String(path ?? ""));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

export async function rateExampleAction(f: FormData) {
  const { ctx, identity } = await owner();
  const raw = text(f, "rating");
  await finish(backOf(f), raw ? `Rated ${raw} of 5.` : "Rating cleared.", () => rateExample(ctx, identity, text(f, "id"), raw ? Number(raw) : null));
}

/** One engine on or off; the button's value is "<engine>:on" or "<engine>:off". */
export async function setEngineAction(f: FormData) {
  const { ctx, identity } = await owner();
  const [engine = "", state] = text(f, "toggle").split(":");
  const label = ENGINE_LABELS[engine as TrainingEngine] ?? "That engine";
  await finish(backOf(f), state === "on" ? `${label} now uses it.` : `${label} no longer uses it.`, () => setExampleEngine(ctx, identity, text(f, "id"), engine, state === "on"));
}

export async function deleteExampleAction(f: FormData): Promise<ConfirmResult> {
  const { ctx, identity } = await owner();
  try {
    await deleteExample(ctx, identity, text(f, "id"));
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
  refresh();
  return { ok: true, message: "Example and its file deleted." };
}
