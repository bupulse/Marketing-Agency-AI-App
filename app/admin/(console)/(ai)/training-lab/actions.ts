"use server";

import { refresh } from "next/cache";
import type { ConfirmResult } from "@/components/admin/confirm-button";
import { requireAdmin } from "@/lib/admin/auth";
import { actionMessage, adminAction, finish } from "@/lib/admin/console";
import { ENGINE_LABELS, type TrainingEngine } from "@/lib/training-lab/types";
import { confirmExampleFile, createExample, deleteExample, NOTE_FIELDS, rateExample, saveExampleNotes, setExampleEngine, startExampleUpload, updateExample, type UploadSlot } from "@/lib/training-lab/examples";
import { draftExampleNotes } from "@/lib/training-lab/analyse";
import { exampleFromReel, type FromReel } from "@/lib/training-lab/from-result";
import { withdrawText } from "@/lib/training-lab/consent-text";

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

/** Saves an edit; when an actor's consent was withdrawn, `message` says how many businesses lost them as presenter. */
export async function updateExampleAction(id: string, input: unknown): Promise<({ ok: true; message?: string }) | { ok: false; error: string }> {
  const { ctx, identity } = await owner();
  try {
    const { withdrawn, removedFrom } = await updateExample(ctx, identity, String(id ?? ""), input);
    return withdrawn ? { ok: true, message: withdrawText(removedFrom).done } : { ok: true };
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
  let removedFrom = 0;
  try {
    removedFrom = (await deleteExample(ctx, identity, text(f, "id"))).removedFrom;
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
  refresh();
  return { ok: true, message: removedFrom ? `Example and its file deleted. ${withdrawText(removedFrom).done}` : "Example and its file deleted." };
}

/** Gemini drafts the example's notes (only when the switch and the budget allow; lib/training-lab/analyse.ts). */
export async function draftNotesAction(f: FormData) {
  const { ctx, identity } = await owner();
  await finish(backOf(f), "The AI drafted the notes. Correct anything it got wrong and save.", () => draftExampleNotes(ctx, identity, text(f, "id")));
}

/** The owner's corrected or hand-written notes; one box per field ("note_<field>"). */
export async function saveNotesAction(f: FormData) {
  const { ctx, identity } = await owner();
  const raw = Object.fromEntries(NOTE_FIELDS.map((field) => [field, text(f, `note_${field}`)]));
  await finish(backOf(f), (notes: unknown) => (notes ? "Notes saved." : "Notes cleared."), () => saveExampleNotes(ctx, identity, text(f, "id"), raw));
}

const fromReelMessage = (r: FromReel, verdict: "more" | "never") =>
  `${verdict === "more" ? "Added as a 5-star example: the engines will make more like it." : "Added as a 1-star example with your reason: the engines will never copy it."}${r.copied ? "" : " The video could not be copied into the Lab, so the example has no file."}${r.runs ? ` The rating went on the ${r.runs} team run${r.runs === 1 ? "" : "s"} that made it.` : ""}`;

/** "More like this" on a finished reel: a 5-star Lab example with the reel's MP4 (copied privately). */
export async function moreLikeThisAction(f: FormData) {
  const { ctx, identity } = await owner();
  await finish(`${BACK}#finished-reels`, (r: FromReel) => fromReelMessage(r, "more"), () => exampleFromReel(ctx, identity, text(f, "reelId"), "more"));
}

/** "Never this" on a finished reel, with the owner's one-line reason (the dialog keeps it open on a refusal). */
export async function neverThisAction(f: FormData): Promise<ConfirmResult> {
  const { ctx, identity } = await owner();
  let result: FromReel;
  try {
    result = await exampleFromReel(ctx, identity, text(f, "reelId"), "never", text(f, "reason"));
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
  refresh();
  return { ok: true, message: fromReelMessage(result, "never") };
}
