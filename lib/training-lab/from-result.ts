import "server-only";
// The feedback loop (docs/TRAINING_LAB.md, "What training means here"): the owner's ratings on what the engines made go
// back into the Lab. A rating on a result (a reel, a picture batch) is written on every agent run that made it
// (runs.ts rateResult), so the Team page's averages move; "More like this" or "Never this" on a finished reel makes a
// Lab example from it, with the MP4 copied privately into the Lab. The client's reel and gallery are never changed.
// Owner only, audited, like the rest of the Lab.
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertLabOwner, type LabOwner } from "./examples";
import { rateResult } from "./runs";
import { scrubText } from "./scrub";
import { examplePath, TRAINING_BUCKET } from "./storage";

/** What a run made: "reel:<ReelJob id>", "batch:<image batch id>", "example:<id>", "presenter:<businessId>". */
const RESULT_REF = /^(reel|batch|example|presenter|design):[A-Za-z0-9_-]{1,80}$/;
export const isResultRef = (v: unknown): v is string => typeof v === "string" && RESULT_REF.test(v);

/** 1 to 5 stars (or null to clear) on every run that made this result; audited. Says how many runs it reached. */
export async function rateRun(ctx: AdminContext, identity: LabOwner, resultRef: string, rating: number | null): Promise<number> {
  assertLabOwner(ctx, identity);
  if (!isResultRef(resultRef)) throw new AdminError("invalid", "That result could not be rated.");
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new AdminError("invalid", "Rate it from 1 to 5 stars.");
  const runs = await rateResult(resultRef, rating);
  if (!runs) throw new AdminError("not_found", "No team run made that. Refresh the page.");
  await writeAudit(prisma, ctx, "rate_agent_result", `result:${resultRef}`, null, { rating, runs });
  return runs;
}

/** What each result is, in words, for the Team page: a reel by its title; anything else by what it is. Plain text. */
export async function resultLabels(refs: readonly (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(refs.filter(isResultRef))];
  const reelIds = list.filter((r) => r.startsWith("reel:")).map((r) => r.slice(5));
  const reels = reelIds.length ? await prisma.reelJob.findMany({ where: { id: { in: reelIds } }, select: { id: true, plan: true } }).catch(() => []) : [];
  const titles = new Map(reels.map((r) => [r.id, titleOf(r.plan)]));
  for (const ref of list) {
    const [kind, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
    out.set(ref, kind === "reel" ? `Reel "${titles.get(id) ?? "no longer there"}"` : kind === "batch" ? `Picture batch ${id.slice(0, 8)}` : kind === "example" ? "Notes on a Lab example" : kind === "presenter" ? "A business's presenter" : `Design ${id.slice(0, 8)}`);
  }
  return out;
}

const titleOf = (plan: unknown) => String((plan as { title?: unknown } | null)?.title ?? "").trim() || "Untitled reel";

// ---- Finished reels into the Lab ------------------------------------------------------------------------------------

export const FINISHED_MAX = 20;
const REEL_BUCKET = "gallery-videos";
const REASON_MAX = 300;
/** The tag that ties an example to the reel it was made from (so a reel goes into the Lab once). */
export const reelTag = (reelId: string) => `reel:${reelId}`;

export type FinishedReel = { id: string; business: string; title: string; language: string; createdAt: Date; inLab: boolean };

/** The 20 newest finished reels from every business, and whether each is already a Lab example. */
export async function finishedReels(): Promise<FinishedReel[]> {
  const jobs = await prisma.reelJob.findMany({ where: { status: "done" }, orderBy: { createdAt: "desc" }, take: FINISHED_MAX, select: { id: true, plan: true, language: true, createdAt: true, business: { select: { name: true } } } });
  if (!jobs.length) return [];
  const known = await prisma.trainingExample.findMany({ where: { OR: jobs.flatMap((j) => reelMatch(j.id)) }, select: { tags: true, notes: true } });
  const inLab = new Set(known.flatMap((k) => [...k.tags, ...(k.notes && typeof k.notes === "object" && !Array.isArray(k.notes) && typeof (k.notes as { rated_reel?: unknown }).rated_reel === "string" ? [reelTag((k.notes as { rated_reel: string }).rated_reel)] : [])]));
  return jobs.map((j) => ({ id: j.id, business: j.business.name, title: titleOf(j.plan), language: j.language, createdAt: j.createdAt, inLab: inLab.has(reelTag(j.id)) }));
}

/** How a reel was made, in the owner's kind of words, from its plan. */
export function reelHowMade(plan: unknown): string {
  const p = (plan && typeof plan === "object" ? plan : {}) as { title?: unknown; clips?: { kind?: string }[]; hook?: unknown; setting?: unknown };
  const clips = Array.isArray(p.clips) ? p.clips : [];
  const montage = clips.some((c) => c?.kind === "broll");
  const talks = clips.filter((c) => c?.kind !== "broll").length;
  const style = montage
    ? `a montage: ${talks} talking clips of the presenter with ${clips.length - talks} product shots cut in on the music's beat`
    : `a talking reel: ${clips.length || 4} clips of the presenter speaking to the camera`;
  const sentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);
  const extra = [typeof p.hook === "string" && p.hook.trim() ? sentence(`Hook sticker: ${scrubText(p.hook.trim())}`) : "", typeof p.setting === "string" && p.setting.trim() ? sentence(`Filmed in ${scrubText(p.setting.trim())}`) : ""].filter(Boolean).join(" ");
  return `BuPulse's AI reel "${titleOf(plan)}": ${style}, filmed by Veo and edited in the browser.${extra ? ` ${extra}` : ""}`.slice(0, 5000);
}

const ALREADY = "This reel is already in the Lab. Change its example in the list instead.";
/** The example rows that stand for this reel: tagged with it, or with its id in the notes. */
const reelMatch = (reelId: string) => [{ tags: { has: reelTag(reelId) } }, { notes: { path: ["rated_reel"], equals: reelId } }];
const reelInLab = async (reelId: string) => !!(await prisma.trainingExample.findFirst({ where: { OR: reelMatch(reelId) }, select: { id: true } }));

export type FromReel = { id: string; copied: boolean; runs: number };

/**
 * "More like this" (rating 5) or "Never this" (rating 1, with the owner's one-line reason) on a finished reel: a Lab
 * example of kind reel for the reel and video engines, its MP4 copied with the server's key from the gallery-videos
 * bucket into the private Lab folder (never public; the client's file stays as it is). A failed copy keeps the example
 * without a file and says so. The rating also goes on the runs that made the reel.
 */
export async function exampleFromReel(ctx: AdminContext, identity: LabOwner, reelId: string, verdict: "more" | "never", reason?: string | null): Promise<FromReel> {
  assertLabOwner(ctx, identity);
  const why = (reason ?? "").replace(/\s+/g, " ").trim();
  if (verdict === "never" && !why) throw new AdminError("invalid", "Say in one line what the engines must never do again.");
  if (why.length > REASON_MAX) throw new AdminError("invalid", `Keep the reason under ${REASON_MAX} letters.`);
  const job = typeof reelId === "string" && reelId ? await prisma.reelJob.findFirst({ where: { id: reelId, status: "done" }, select: { id: true, plan: true, language: true, path: true } }) : null;
  if (!job) throw new AdminError("not_found", "That reel is not finished or is gone. Refresh the page.");
  if (await reelInLab(job.id)) throw new AdminError("conflict", ALREADY);
  const rating = verdict === "more" ? 5 : 1;
  const row = await prisma.$transaction(async (tx) => {
    const row = await tx.trainingExample.create({
      data: {
        kind: "reel",
        title: `Reel: ${titleOf(job.plan)}`.slice(0, 120),
        howMade: reelHowMade(job.plan),
        whatIsGood: verdict === "more" ? "The owner rated this reel: more like this" : "The owner rated this reel: never this",
        neverThis: verdict === "never" ? why : null,
        language: job.language,
        tags: [reelTag(job.id)],
        rating,
        engines: ["reel", "video"],
        // The reel's id twice: the tag (the owner can edit it) and the notes (the guard checks either).
        notes: { rated_reel: job.id },
        createdById: identity.id,
      },
    });
    await writeAudit(tx, ctx, "create_training_example", `training:${row.id}`, null, { kind: "reel", fromReel: job.id, verdict, rating });
    return row;
  });
  // Two quick clicks both pass the check above and both create an example: after creating, the oldest one (by time, then
  // id) stays and any newer one is removed again, so exactly one survives whatever the order.
  const first = await prisma.trainingExample.findFirst({ where: { id: { not: row.id }, OR: reelMatch(job.id) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, createdAt: true } });
  if (first && (first.createdAt < row.createdAt || (first.createdAt.getTime() === row.createdAt.getTime() && first.id < row.id))) {
    await prisma.trainingExample.deleteMany({ where: { id: row.id } });
    throw new AdminError("conflict", ALREADY);
  }
  const copied = await copyReel(job.path, examplePath(identity.id, row.id, "reel.mp4"), row.id);
  const runs = await rateResult(`reel:${job.id}`, rating).catch(() => 0);
  return { id: row.id, copied, runs };
}

/** The finished MP4 into the Lab, server side; true when the example now has its file. */
async function copyReel(from: string | null, to: string, exampleId: string): Promise<boolean> {
  if (!from) return false;
  try {
    const storage = createAdminClient().storage;
    const { data, error } = await storage.from(REEL_BUCKET).download(from);
    if (error || !data) return false;
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (!bytes.length) return false;
    const { error: failed } = await storage.from(TRAINING_BUCKET).upload(to, bytes, { contentType: "video/mp4", upsert: false });
    if (failed) return false;
    await prisma.trainingExample.update({ where: { id: exampleId }, data: { path: to, mime: "video/mp4", bytes: bytes.length } });
    return true;
  } catch {
    return false;
  }
}
