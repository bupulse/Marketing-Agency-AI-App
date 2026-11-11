"use server";

import { requireAdmin } from "@/lib/admin/auth";
import { adminAction, finish } from "@/lib/admin/console";
import { AdminError } from "@/lib/admin/types";
import { AdBrainError, cancelAdJob, captureScreensNow, loadRealCaptures, runAdJobsNow, startAdJob } from "@/lib/ad-brain/service";
import { AdBrainSetupError } from "@/lib/ad-brain/facts";

// Admin -> Ad Brain (docs/AD_BRAIN.md). Each action re-checks the admin (allow-listed email, AAL2, the "ai" area):
// server actions are public POST endpoints, so the page's own check is never enough. Paid work only starts from
// "Make an ad"; the spend limits (Admin -> Settings) stop it before it passes $3 an ad or $30 a month.

const BACK = "/admin/ad-brain";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Our own plain-English errors are shown as they are. */
async function plain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AdBrainError || e instanceof AdBrainSetupError) throw new AdminError("invalid", e.message);
    throw e;
  }
}

export async function startAdAction(f: FormData) {
  await adminAction("ai");
  const identity = await requireAdmin();
  const fixture = text(f, "fixture") || null;
  await finish(BACK, fixture ? "The cached ad is queued: it renders in a minute or two (no paid assets)." : "The ad is queued. It moves on every few minutes, or press \"Move it on now\".", () => plain(() => startAdJob({ createdBy: identity.email, notes: text(f, "notes"), fixture })));
}

export async function runAdJobsNowAction() {
  await adminAction("ai");
  await finish(BACK, (r) => (r.jobs ? `Moved on: ${Object.values(r.states).join(", ")}.` : "Nothing to move on."), () => runAdJobsNow());
}

export async function cancelAdAction(f: FormData) {
  await adminAction("ai");
  await finish(BACK, "Cancelled. Nothing more is paid for this ad.", () => plain(() => cancelAdJob(text(f, "id"))));
}

export async function captureScreensAction() {
  await adminAction("ai");
  await finish(BACK, (r) => (r ? `${r.captured} real screens captured${r.skippedEmpty ? ` (${r.skippedEmpty} of empty pages are kept out of ads)` : ""}${r.failed ? `; ${r.failed} could not be captured: ${r.errors[0] ?? ""}` : ""}.` : "The screens were already fresh."), () => plain(() => captureScreensNow()));
}

export async function loadCapturesAction() {
  await adminAction("ai");
  await finish(BACK, (n) => (n ? `${n} real captures loaded.` : "The real captures were already loaded."), () => plain(() => loadRealCaptures()));
}
