import "server-only";
// Withdrawing an actor's consent (docs/TRAINING_LAB.md, "Actors"). An actor without consent stays in the Lab but is never
// used (match.ts usable, reader.ts labPresenters, the Team page's counts). The copies reach further: a business whose
// reel presenter is a copy of this actor's portrait (reel-engine/engine.ts labPresenter) loses that presenter, so its
// next reel paints a new one, and portraits taken from this actor's video lose their consent too. A copy is named after
// its source ("<userId>/designs/lab-<exampleId>-<uuid>.<ext>", labCopyPath), so finding them is one query with no
// download. Copies made before that name (a plain uuid) are found from the painter's runs and kept only when the file
// is byte for byte the actor's portrait; that check downloads, so it runs only when the owner withdraws or deletes.
// Reels already made are not changed.
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminContext } from "@/lib/admin/types";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { TRAINING_BUCKET } from "./storage";

const DESIGNS_BUCKET = "designs";
const PRESENTER_REF = "presenter:";
const LAB_COPY = "/designs/lab-";

/** Where a business's copy of a Lab actor's portrait goes: in its own designs folder, named after the example. */
export const labCopyPath = (userId: string, exampleId: string, ext: string) => `${userId}${LAB_COPY}${exampleId}-${globalThis.crypto.randomUUID()}.${ext}`;
/** The part of a copy's path that names its source example. */
export const labCopyMark = (exampleId: string) => `${LAB_COPY}${exampleId}-`;

type Actor = { id: string; path: string | null };
export type PresenterCopy = { businessId: string; path: string };

async function sha256Of(bucket: string, path: string): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient().storage.from(bucket).download(path);
    if (error || !data) return null;
    return createHash("sha256").update(new Uint8Array(await data.arrayBuffer())).digest("hex");
  } catch {
    return null;
  }
}

/** Portraits taken from this actor's video (notes.from_video), whatever their consent says now. */
async function portraitsOf(id: string): Promise<{ id: string; path: string | null; consentGiven: boolean }[]> {
  return prisma.trainingExample.findMany({ where: { kind: "actor", notes: { path: ["from_video"], equals: id } }, select: { id: true, path: true, consentGiven: true } });
}

/**
 * The businesses whose presenter is still a copy of this actor's portrait: every presenter whose path names the example
 * (no download). With `older`, also the presenters of the businesses the painter's runs name whose file has no Lab name,
 * kept only when its bytes are the actor's file (a copy made before the name; this downloads both files).
 */
export async function presenterCopies(actor: Actor, opts: { older?: boolean } = {}): Promise<PresenterCopy[]> {
  const named = await prisma.reelPresenter.findMany({ where: { path: { contains: labCopyMark(actor.id) } }, select: { businessId: true, path: true } });
  if (!opts.older) return named;
  const runs = await prisma.agentRun.findMany({ where: { agentId: "painter", resultRef: { startsWith: PRESENTER_REF }, exampleIds: { has: actor.id } }, select: { resultRef: true } });
  const have = new Set(named.map((c) => c.businessId));
  const businessIds = [...new Set(runs.map((r) => r.resultRef?.slice(PRESENTER_REF.length) ?? "").filter((b) => b && !have.has(b)))];
  if (!businessIds.length || !actor.path) return named;
  const unnamed = (await prisma.reelPresenter.findMany({ where: { businessId: { in: businessIds } }, select: { businessId: true, path: true } })).filter((p) => !p.path.includes(LAB_COPY));
  if (!unnamed.length) return named;
  const source = await sha256Of(TRAINING_BUCKET, actor.path);
  if (!source) return named;
  const older: PresenterCopy[] = [];
  for (const p of unnamed) if ((await sha256Of(DESIGNS_BUCKET, p.path)) === source) older.push(p);
  return [...named, ...older];
}

/** How many businesses lose a presenter if this actor's consent goes: its own copies and its portraits' (for the confirm; no download, so copies made before the Lab name are not counted). */
export async function presenterUses(actor: Actor): Promise<number> {
  try {
    const portraits = await portraitsOf(actor.id);
    const all = await Promise.all([actor, ...portraits].map((a) => presenterCopies(a)));
    return new Set(all.flat().map((c) => c.businessId)).size;
  } catch (error) {
    await logError(error, { source: "training-lab.consent.count", level: "warn" });
    return 0;
  }
}

export type Withdrawn = { businesses: string[]; portraits: string[] };

/**
 * The actor's consent is gone (unticked or the example deleted; the caller changes the example itself): every business
 * presenter that is still its copy is removed, row and file, and the portraits from its video lose their consent the same
 * way. Audited as "revoke_actor_consent" with the businesses affected. The caller checks that this is the owner.
 */
export async function withdrawActorConsent(ctx: AdminContext, actor: Actor, seen: Set<string> = new Set()): Promise<Withdrawn> {
  if (seen.has(actor.id)) return { businesses: [], portraits: [] };
  seen.add(actor.id);
  const copies = await presenterCopies(actor, { older: true });
  const businesses: string[] = [];
  for (const c of copies) {
    // Only while the presenter is still that file: a presenter changed in the meantime stays.
    const { count } = await prisma.reelPresenter.deleteMany({ where: { businessId: c.businessId, path: c.path } });
    if (!count) continue;
    businesses.push(c.businessId);
    await createAdminClient().storage.from(DESIGNS_BUCKET).remove([c.path]).catch(() => undefined);
  }
  const portraits = (await portraitsOf(actor.id)).filter((p) => !seen.has(p.id));
  const fromPortraits: Withdrawn[] = [];
  for (const p of portraits) {
    if (p.consentGiven) await prisma.trainingExample.update({ where: { id: p.id }, data: { consentGiven: false, consentAt: null } });
    fromPortraits.push(await withdrawActorConsent(ctx, p, seen));
  }
  const result: Withdrawn = {
    businesses: [...new Set([...businesses, ...fromPortraits.flatMap((w) => w.businesses)])],
    portraits: [...portraits.map((p) => p.id), ...fromPortraits.flatMap((w) => w.portraits)],
  };
  await writeAudit(prisma, ctx, "revoke_actor_consent", `training:${actor.id}`, null, { businesses: businesses, portraits: portraits.map((p) => p.id) });
  return result;
}
