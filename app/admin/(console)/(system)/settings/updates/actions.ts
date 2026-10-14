"use server";

import { requireAdmin } from "@/lib/admin/auth";
import { actionMessage, adminAction, finish } from "@/lib/admin/console";
import { installRelease, restoreRelease, startReleaseUpload, verifyUploadedRelease } from "@/lib/updates/releases";
import { DEPLOY_HOSTS, deployHost } from "@/lib/admin/deploy-host";
import { AdminError } from "@/lib/admin/types";
import { installUpdate, rollbackDeploy } from "@/lib/admin/updates";

const BACK = "/admin/settings/updates";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// Each action re-checks the admin (allow-listed email, AAL2) first: server actions are public POST endpoints, so the
// layout's check is never enough. The dialog's extra step (typing the version, ticking the box) is the confirmation.

export async function installUpdateAction(f: FormData) {
  const ctx = await adminAction("system");
  await finish(BACK, "Update requested. GitHub is building and deploying it; the runs below refresh on their own.", async () => {
    const ref = text(f, "ref");
    const version = text(f, "version");
    const typed = text(f, "typed");
    if (!typed || typed.replace(/^v/i, "") !== version.replace(/^v/i, "")) throw new AdminError("invalid", `Type the version exactly as shown (${version}) to confirm.`);
    return installUpdate(ctx, { ref, version, confirm: true });
  });
}

export async function rollbackAction(f: FormData) {
  const ctx = await adminAction("system");
  await finish(BACK, `Rollback requested. GitHub is putting the previous ${DEPLOY_HOSTS[deployHost()].runtime} version back; database migrations are not undone.`, async () => {
    if (text(f, "confirm") !== "on") throw new AdminError("confirm_required", "Tick the box to confirm the rollback.");
    return rollbackDeploy(ctx, { reason: text(f, "reason"), confirm: true });
  });
}

// ---- Install from a signed zip (owner only; lib/updates/releases.ts) ----------------------------------------------

export type ReleaseStep = { ok: true; path?: string; token?: string; version?: string } | { ok: false; error: string };

async function owner() {
  const ctx = await adminAction("system");
  return { ctx, identity: await requireAdmin() };
}

/** Step 1 of an upload: a signed upload address in the private "releases" bucket. */
export async function startReleaseUploadAction(input: { bytes: number }): Promise<ReleaseStep> {
  const { ctx, identity } = await owner();
  try {
    const { path, token } = await startReleaseUpload(ctx, identity, input);
    return { ok: true, path, token };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

/** Step 2: check the uploaded zip against its .sig and record the version. */
export async function verifyReleaseAction(input: { path: string; sig: string; notes?: string }): Promise<ReleaseStep> {
  const { ctx, identity } = await owner();
  try {
    const row = await verifyUploadedRelease(ctx, identity, input);
    return { ok: true, version: row.version };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}

export async function installReleaseAction(f: FormData) {
  const { ctx, identity } = await owner();
  await finish(BACK, (r: { version: string; dryRun: boolean }) => (r.dryRun ? `Dry run: ${r.version} passed every check; the workflow was not started (UPDATES_DRY_RUN=1).` : `Installing ${r.version}. GitHub checks the zip again, backs up the database, migrates and deploys; the runs below refresh on their own.`), () =>
    installRelease(ctx, identity, { id: text(f, "id"), typed: text(f, "typed") }),
  );
}

export async function restoreReleaseAction(f: FormData) {
  const { ctx, identity } = await owner();
  await finish(BACK, (r: { version: string; via: string; dryRun: boolean }) => (r.dryRun ? `Dry run: restoring ${r.version} passed every check; the workflow was not started.` : `Restoring ${r.version} (${r.via === "cloudflare" ? "the kept Cloudflare version" : "from its zip"}). Database changes are not undone.`), () =>
    restoreRelease(ctx, identity, { id: text(f, "id"), typed: text(f, "typed") }),
  );
}
