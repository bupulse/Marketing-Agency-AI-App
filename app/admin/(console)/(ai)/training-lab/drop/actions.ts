"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { actionMessage, adminAction } from "@/lib/admin/console";
import { AdminError } from "@/lib/admin/types";
import { readDraft, type DraftFields } from "@/lib/training-lab/analyse";
import { createExampleFromDraft, discardDraft, draftInfo, ownDraft, startDraft, assertLabOwner, type Draft, type LabNotes } from "@/lib/training-lab/examples";
import { isKind } from "./kinds";

// Drop, read, check (docs/TRAINING_LAB.md, board task 26). Each action re-checks the admin (allow-listed email, AAL2,
// the "ai" area), and lib/training-lab refuses anyone but the owner from ADMIN_EMAILS: server actions are public POST
// endpoints. The file waits in a draft folder until Save (lib/training-lab/examples.ts, "Drafts").

async function owner() {
  const ctx = await adminAction("ai");
  return { ctx, identity: await requireAdmin() };
}

export type StartResult = ({ ok: true } & Draft) | { ok: false; error: string };
export type ReadResult = { ok: true; fields: DraftFields; notes: LabNotes | null } | { ok: false; error: string };
export type SaveResult = { ok: true; id: string; message: string } | { ok: false; error: string };

/** A fresh draft folder and its upload address, after the file's kind and size are checked. */
export async function startDraftAction(file: unknown, kind: string): Promise<StartResult> {
  const { ctx, identity } = await owner();
  try {
    return { ok: true, ...(await startDraft(ctx, identity, file, String(kind ?? ""))) };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

/** The AI reads the uploaded draft (when the switch and the budget allow): suggested fields and notes, or why not. */
export async function readDraftAction(path: string, kind: string): Promise<ReadResult> {
  const { ctx, identity } = await owner();
  try {
    assertLabOwner(ctx, identity);
    const own = ownDraft(path, identity.id);
    if (!own || !isKind(kind)) throw new AdminError("invalid", "That draft could not be found. Drop the file again.");
    const info = await draftInfo(path);
    if (!info) throw new AdminError("not_found", "The file did not arrive. Drop it again.");
    const read = await readDraft({ draftId: own.draftId, path, mime: info.mime, bytes: info.bytes, kind });
    return read.ok ? { ok: true, fields: read.fields, notes: read.notes } : { ok: false, error: read.error };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

/** Save to the Lab: the checked form, with the draft's file (or a link when `draft` is null). */
export async function saveDraftAction(draft: string | null, input: unknown): Promise<SaveResult> {
  const { ctx, identity } = await owner();
  try {
    const { id, warning } = await createExampleFromDraft(ctx, identity, draft ?? null, input);
    refresh();
    return { ok: true, id, message: warning ?? "Saved to the Lab. The engines you switched on learn from it from now on." };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

/** Discard: the draft's file is deleted. */
export async function discardDraftAction(path: string): Promise<{ ok: boolean }> {
  const { ctx, identity } = await owner();
  try {
    await discardDraft(ctx, identity, String(path ?? ""));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
