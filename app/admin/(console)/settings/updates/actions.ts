"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { DEPLOY_HOSTS, deployHost } from "@/lib/admin/deploy-host";
import { AdminError } from "@/lib/admin/types";
import { installUpdate, rollbackDeploy } from "@/lib/admin/updates";

const BACK = "/admin/settings/updates";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// Each action re-checks the admin (allow-listed email, AAL2) first: server actions are public POST endpoints, so the
// layout's check is never enough. The dialog's extra step (typing the version, ticking the box) is the confirmation.

export async function installUpdateAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, "Update requested. GitHub is building and deploying it; the runs below refresh on their own.", async () => {
    const ref = text(f, "ref");
    const version = text(f, "version");
    const typed = text(f, "typed");
    if (!typed || typed.replace(/^v/i, "") !== version.replace(/^v/i, "")) throw new AdminError("invalid", `Type the version exactly as shown (${version}) to confirm.`);
    return installUpdate(ctx, { ref, version, confirm: true });
  });
}

export async function rollbackAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, `Rollback requested. GitHub is putting the previous ${DEPLOY_HOSTS[deployHost()].runtime} version back; database migrations are not undone.`, async () => {
    if (text(f, "confirm") !== "on") throw new AdminError("confirm_required", "Tick the box to confirm the rollback.");
    return rollbackDeploy(ctx, { reason: text(f, "reason"), confirm: true });
  });
}
