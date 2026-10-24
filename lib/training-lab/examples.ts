import "server-only";
// The Training Lab's library on the server (docs/TRAINING_LAB.md): list, add, edit, rate, switch per engine, delete.
//
// Only the owner from ADMIN_EMAILS, in the console (not a staff member, not Jarvis), like the signed-zip updates. A file
// goes straight from the browser to the private "training-lab" bucket: the row is made first, the server gives a
// signed upload address in the example's folder, and the browser confirms once the file is there; the server then reads
// its real size and type from Storage before the row points at it.
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import type { AdminIdentity } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUploadSlot, exampleFolder, examplePath, isExamplePath, removeObjects, DOWNLOAD_SECONDS, TRAINING_BUCKET } from "./storage";
import { readVoiceExtras, withVoiceExtras } from "./language";
import { ENGINES, KINDS, exampleInputSchema, fileProblem, type ExampleInput, type TrainingEngine, type TrainingKind } from "./types";

export type LabOwner = Pick<AdminIdentity, "id" | "isOwner" | "staffId">;
export type FileInfo = { name: string; type: string; size: number };
export type UploadSlot = { path: string; token: string };

/** Only the owner from ADMIN_EMAILS, in the console. */
export function assertLabOwner(ctx: AdminContext, identity: LabOwner) {
  if (ctx.viaApi) throw new AdminError("forbidden", "The Training Lab can only be used by the owner in the admin console.");
  if (!identity.isOwner || identity.staffId) throw new AdminError("forbidden", "Only the owner can use the Training Lab.");
}

// ---- Reading -------------------------------------------------------------------------------------------------------

export type ExampleFilter = { kind?: TrainingKind; sector?: string; language?: string; engine?: TrainingEngine };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** The list's filters from the page's search params; anything unknown is dropped. */
export function parseFilter(sp: Record<string, string | string[] | undefined>): ExampleFilter {
  const kind = one(sp.kind);
  const engine = one(sp.engine);
  const sector = one(sp.sector)?.slice(0, 40);
  const language = one(sp.language)?.slice(0, 40);
  return {
    ...(kind && (KINDS as readonly string[]).includes(kind) ? { kind: kind as TrainingKind } : {}),
    ...(engine && (ENGINES as readonly string[]).includes(engine) ? { engine: engine as TrainingEngine } : {}),
    ...(sector ? { sector } : {}),
    ...(language ? { language } : {}),
  };
}

export function filterWhere(f: ExampleFilter): Prisma.TrainingExampleWhereInput {
  return {
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.engine ? { engines: { has: f.engine } } : {}),
    ...(f.sector ? { sector: { equals: f.sector, mode: "insensitive" } } : {}),
    ...(f.language ? { language: { equals: f.language, mode: "insensitive" } } : {}),
  };
}

export const LIST_MAX = 100;

/** Newest first, at most LIST_MAX. */
export async function listExamples(filter: ExampleFilter = {}) {
  return prisma.trainingExample.findMany({ where: filterWhere(filter), orderBy: { createdAt: "desc" }, take: LIST_MAX });
}

/** The sectors and languages in use, for the filter menus. */
export async function filterChoices(): Promise<{ sectors: string[]; languages: string[] }> {
  const [sectors, languages] = await Promise.all([
    prisma.trainingExample.findMany({ where: { sector: { not: null } }, distinct: ["sector"], select: { sector: true }, orderBy: { sector: "asc" }, take: 100 }),
    prisma.trainingExample.findMany({ where: { language: { not: null } }, distinct: ["language"], select: { language: true }, orderBy: { language: "asc" }, take: 100 }),
  ]);
  return { sectors: sectors.map((r) => r.sector!).filter(Boolean), languages: languages.map((r) => r.language!).filter(Boolean) };
}

/** Short-lived links to the files, by path; a file that cannot be signed (gone, storage down) has none. */
export async function previewLinks(paths: (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  if (!list.length) return out;
  try {
    const { data } = await createAdminClient().storage.from(TRAINING_BUCKET).createSignedUrls(list, DOWNLOAD_SECONDS);
    for (const row of data ?? []) if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  } catch {
    /* no previews this time */
  }
  return out;
}

// ---- Writing -------------------------------------------------------------------------------------------------------

function parse(raw: unknown) {
  const parsed = exampleInputSchema.safeParse(raw);
  if (!parsed.success) throw new AdminError("invalid", parsed.error.issues[0]?.message ?? "Check the example and try again.");
  return parsed.data;
}

/** The columns the form edits (not the kind, the file or the AI notes). */
const columns = (v: ExampleInput) => ({
  title: v.title,
  sourceUrl: v.sourceUrl,
  howMade: v.howMade,
  whatIsGood: v.whatIsGood,
  neverThis: v.neverThis,
  tags: v.tags,
  sector: v.sector,
  language: v.language,
  technique: v.technique,
  rating: v.rating,
  consentGiven: v.consentGiven,
  consentName: v.consentName,
  consentNote: v.consentNote,
  engines: v.engines,
  transcript: v.transcript,
});

/** The notes a new example starts with: a posting habit's schedule, or a recording's spellings; else what was given. */
function notesForCreate(input: ExampleInput): Prisma.InputJsonValue | undefined {
  const notes = input.voiceExtras ? withVoiceExtras(input.notes, input.voiceExtras) : input.notes;
  return notes === null || notes === undefined ? undefined : (notes as Prisma.InputJsonValue);
}

function fileOf(raw: unknown): FileInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  return { name: String(f.name ?? "").slice(0, 200), type: String(f.type ?? "").toLowerCase(), size: Number(f.size) };
}

async function found(id: string) {
  const row = typeof id === "string" && id ? await prisma.trainingExample.findUnique({ where: { id } }) : null;
  if (!row) throw new AdminError("not_found", "That example is gone. Refresh the page.");
  return row;
}

async function slotFor(row: { id: string; createdById: string; kind: string }, file: FileInfo): Promise<UploadSlot> {
  const problem = fileProblem(file, row.kind as TrainingKind);
  if (problem) throw new AdminError("invalid", problem);
  const path = examplePath(row.createdById, row.id, file.name);
  try {
    return { path, token: (await createUploadSlot(path)).token };
  } catch {
    throw new AdminError("unavailable", "Storage did not give an upload address. Try again; is the \"training-lab\" bucket there?");
  }
}

/**
 * Adds an example. With a file, the row is saved first and an upload address in its folder comes back; the example
 * shows "file missing" until confirmExampleFile. `upload` is null for a link (or a posting habit without a file) and
 * `uploadError` says why when the row was saved but Storage gave no address.
 */
export async function createExample(ctx: AdminContext, identity: LabOwner, raw: unknown, rawFile?: unknown): Promise<{ id: string; upload: UploadSlot | null; uploadError?: string }> {
  assertLabOwner(ctx, identity);
  const file = fileOf(rawFile);
  const input = parse({ ...(raw as object), hasFile: !!file });
  if (file) {
    const problem = fileProblem(file, input.kind);
    if (problem) throw new AdminError("invalid", problem);
  }
  const row = await prisma.$transaction(async (tx) => {
    const row = await tx.trainingExample.create({
      data: { kind: input.kind, ...columns(input), notes: notesForCreate(input), consentAt: input.consentGiven ? new Date() : null, createdById: identity.id },
    });
    await writeAudit(tx, ctx, "create_training_example", `training:${row.id}`, null, { kind: row.kind, title: row.title, engines: row.engines, consentGiven: row.consentGiven });
    return row;
  });
  if (!file) return { id: row.id, upload: null };
  try {
    return { id: row.id, upload: await slotFor(row, file) };
  } catch (e) {
    return { id: row.id, upload: null, uploadError: e instanceof AdminError ? e.message : "Storage did not give an upload address." };
  }
}

/** An upload address for a new or replacement file on an existing example. */
export async function startExampleUpload(ctx: AdminContext, identity: LabOwner, id: string, rawFile: unknown): Promise<UploadSlot> {
  assertLabOwner(ctx, identity);
  const row = await found(id);
  const file = fileOf(rawFile);
  if (!file) throw new AdminError("invalid", "Choose a file.");
  return slotFor(row, file);
}

/**
 * The browser says the file is uploaded: the path must be in this example's folder, and the size and type Storage
 * recorded must suit the kind (a file that does not is deleted). A replaced file is deleted.
 */
export async function confirmExampleFile(ctx: AdminContext, identity: LabOwner, id: string, path: string) {
  assertLabOwner(ctx, identity);
  const row = await found(id);
  if (typeof path !== "string" || !isExamplePath(path, row.createdById, row.id)) throw new AdminError("invalid", "That upload could not be used.");
  const { data: info, error } = await createAdminClient().storage.from(TRAINING_BUCKET).info(path);
  if (error || !info?.size) throw new AdminError("not_found", "The file did not arrive. Upload it again.");
  const file = { name: path.slice(path.lastIndexOf("/") + 1), type: String(info.contentType ?? ""), size: info.size };
  const problem = fileProblem(file, row.kind as TrainingKind);
  if (problem) {
    await removeObjects([path]).catch(() => {});
    throw new AdminError("invalid", problem);
  }
  await prisma.$transaction(async (tx) => {
    await tx.trainingExample.update({ where: { id: row.id }, data: { path, mime: file.type, bytes: file.size } });
    await writeAudit(tx, ctx, "update_training_example", `training:${row.id}`, { path: row.path }, { path, mime: file.type, bytes: file.size });
  });
  if (row.path && row.path !== path) await removeObjects([row.path]).catch(() => {});
}

/** Saves the owner's edits. The kind stays (it goes with the file) and the AI notes are left alone (a posting habit's notes are its schedule). */
export async function updateExample(ctx: AdminContext, identity: LabOwner, id: string, raw: unknown) {
  assertLabOwner(ctx, identity);
  const row = await found(id);
  const input = parse({ ...(raw as object), kind: row.kind, hasFile: !!row.path || (raw as { hasFile?: unknown })?.hasFile === true });
  // A posting habit's notes are the schedule the owner typed; for every other kind the AI notes are left alone.
  // A recording keeps its AI-drafted note fields and gets the spellings the owner typed.
  const voiceNotes = row.kind === "voice" && input.voiceExtras ? withVoiceExtras(row.notes, input.voiceExtras) : undefined;
  const notes = row.kind === "schedule" ? input.notes : voiceNotes;
  const data = { ...columns(input), ...(row.kind === "schedule" || row.kind === "voice" ? { notes: notes === null || notes === undefined ? Prisma.DbNull : (notes as Prisma.InputJsonValue) } : {}) };
  const consentAt = input.consentGiven ? (row.consentGiven && row.consentAt ? row.consentAt : new Date()) : null;
  await prisma.$transaction(async (tx) => {
    await tx.trainingExample.update({ where: { id: row.id }, data: { ...data, consentAt } });
    await writeAudit(tx, ctx, "update_training_example", `training:${row.id}`, { title: row.title, engines: row.engines, consentGiven: row.consentGiven }, { title: data.title, engines: data.engines, consentGiven: data.consentGiven });
  });
}

/** 1 to 5 stars, or null to clear. */
export async function rateExample(ctx: AdminContext, identity: LabOwner, id: string, rating: number | null) {
  assertLabOwner(ctx, identity);
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new AdminError("invalid", "Rate it from 1 to 5 stars.");
  const row = await found(id);
  await prisma.$transaction(async (tx) => {
    await tx.trainingExample.update({ where: { id: row.id }, data: { rating } });
    await writeAudit(tx, ctx, "update_training_example", `training:${row.id}`, { rating: row.rating }, { rating });
  });
}

/** Switches one engine on or off for this example. */
export async function setExampleEngine(ctx: AdminContext, identity: LabOwner, id: string, engine: string, on: boolean) {
  assertLabOwner(ctx, identity);
  if (!(ENGINES as readonly string[]).includes(engine)) throw new AdminError("invalid", "That engine does not exist.");
  const row = await found(id);
  const engines = on ? [...new Set([...row.engines, engine])] : row.engines.filter((e) => e !== engine);
  await prisma.$transaction(async (tx) => {
    await tx.trainingExample.update({ where: { id: row.id }, data: { engines } });
    await writeAudit(tx, ctx, "update_training_example", `training:${row.id}`, { engines: row.engines }, { engines });
  });
  return { engines };
}

/** Deletes the example and every file in its folder (the file, and any upload that was never confirmed). */
export async function deleteExample(ctx: AdminContext, identity: LabOwner, id: string) {
  assertLabOwner(ctx, identity);
  const row = await found(id);
  await prisma.$transaction(async (tx) => {
    await tx.trainingExample.delete({ where: { id: row.id } });
    await writeAudit(tx, ctx, "delete_training_example", `training:${row.id}`, { kind: row.kind, title: row.title, path: row.path }, null);
  });
  const paths = new Set(row.path ? [row.path] : []);
  try {
    const folder = exampleFolder(row.createdById, row.id);
    const { data } = await createAdminClient().storage.from(TRAINING_BUCKET).list(folder.slice(0, -1), { limit: 100 });
    for (const f of data ?? []) if (f.id) paths.add(folder + f.name);
  } catch {
    /* the row's own file is still removed below */
  }
  if (paths.size) await removeObjects([...paths]).catch(() => {});
}

// ---- Notes (the AI-drafted analysis the owner corrects; drafting is in analyse.ts) ----------------------------------

export const NOTE_MAX = 600;

/** The note fields, most useful first (the engines read the first few: lib/training-lab/match.ts notesText). */
export const NOTE_FIELDS = ["hook", "shots", "cuts_per_second", "beat_sync", "music", "captions", "stickers", "setting", "people", "why_it_works"] as const;
export type NoteField = (typeof NOTE_FIELDS)[number];
export type LabNotes = Partial<Record<NoteField, string>>;

export const NOTE_LABELS: Record<NoteField, string> = {
  hook: "Hook (the first seconds)",
  shots: "Shots",
  cuts_per_second: "Cuts per second",
  beat_sync: "Beat sync",
  music: "Music",
  captions: "Captions and words on screen",
  stickers: "Stickers and effects",
  setting: "Setting",
  people: "People",
  why_it_works: "What makes it work",
};


/** The notes from an answer or the owner's form: each field plain text (a number or a list becomes text), empty ones dropped. Null when nothing is left. */
export function readNotes(raw: unknown): LabNotes | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: LabNotes = {};
  for (const field of NOTE_FIELDS) {
    const v = r[field];
    const text = Array.isArray(v) ? v.filter((x) => typeof x === "string" || typeof x === "number").join(", ") : typeof v === "string" || typeof v === "number" ? String(v) : "";
    const clean = text.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
    if (clean) out[field] = clean;
  }
  return Object.keys(out).length ? out : null;
}

/** Writes an example's notes (null clears them) with an audit row. */
export async function saveNotes(ctx: AdminContext, row: { id: string; notes: unknown }, notes: LabNotes | null, action: string, extra: Record<string, unknown> = {}) {
  // A recording's spellings to avoid and right words live in the same notes: drafting or correcting the AI fields keeps them.
  const kept = withVoiceExtras(notes, readVoiceExtras(row.notes));
  await prisma.$transaction(async (tx) => {
    await tx.trainingExample.update({ where: { id: row.id }, data: { notes: kept ? (kept as Prisma.InputJsonValue) : Prisma.DbNull } });
    await writeAudit(tx, ctx, action, `training:${row.id}`, { notes: row.notes ?? null }, { notes, ...extra });
  });
}

/** The owner's corrected (or hand-written) notes; every field empty clears them. */
export async function saveExampleNotes(ctx: AdminContext, identity: LabOwner, id: string, raw: unknown): Promise<LabNotes | null> {
  assertLabOwner(ctx, identity);
  const row = await found(id);
  const notes = readNotes(raw);
  await saveNotes(ctx, row, notes, "update_training_notes");
  return notes;
}

// ---- A portrait from an actor's video (docs/TRAINING_LAB.md, task 13) -------------------------------------------------

/**
 * A new actor example made from one frame of an actor's video: same person and consent as the video's example, switched on
 * for the presenters only, with `from_video` and `at_seconds` in its notes. The source must be an actor with consent. The
 * still itself goes up the usual way (the slot returned here, then confirmExampleFile). Audited.
 */
export async function createPortraitFromVideo(ctx: AdminContext, identity: LabOwner, sourceId: string, atSeconds: number, rawFile: unknown): Promise<{ id: string; upload: UploadSlot | null; uploadError?: string }> {
  assertLabOwner(ctx, identity);
  const source = await found(sourceId);
  if (source.kind !== "actor") throw new AdminError("invalid", "Only an actor's video can give a portrait.");
  if (!source.consentGiven) throw new AdminError("invalid", "This actor has no consent recorded, so no portrait can be made from it.");
  if (!String(source.mime ?? "").startsWith("video/")) throw new AdminError("invalid", "This example is not a video.");
  const at = Math.max(0, Math.round((Number.isFinite(Number(atSeconds)) ? Number(atSeconds) : 0) * 10) / 10);
  const made = await createExample(
    ctx,
    identity,
    {
      kind: "actor",
      title: `${source.title} (portrait)`.slice(0, 120),
      howMade: `A still taken ${at} s into the video "${source.title}".`,
      whatIsGood: source.whatIsGood,
      neverThis: source.neverThis ?? "",
      sector: source.sector ?? "",
      language: source.language ?? "",
      tags: source.tags,
      technique: [],
      consentGiven: true,
      consentName: source.consentName ?? "",
      consentNote: source.consentNote ?? "",
      engines: ["presenter"],
      notes: { from_video: source.id, at_seconds: at },
    },
    rawFile,
  );
  // The same person agreed on the same day: the consent date is the video's, not today's.
  await prisma.$transaction(async (tx) => {
    if (source.consentAt) await tx.trainingExample.update({ where: { id: made.id }, data: { consentAt: source.consentAt } });
    await writeAudit(tx, ctx, "create_training_portrait", `training:${made.id}`, null, { from_video: source.id, at_seconds: at, consentName: source.consentName });
  });
  return made;
}
