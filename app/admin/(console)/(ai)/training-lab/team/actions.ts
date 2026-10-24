"use server";

import { requireAdmin } from "@/lib/admin/auth";
import { adminAction, finish } from "@/lib/admin/console";
import { rateRun } from "@/lib/training-lab/from-result";
import { setAgentBrain } from "./data";

// The Team page (docs/TRAINING_LAB.md). Each action re-checks the admin (allow-listed email, AAL2, the "ai" area) and
// setAgentBrain then refuses anyone but the owner from ADMIN_EMAILS: server actions are public POST endpoints.

const BACK = "/admin/training-lab/team";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** The owner's brain for one team member. */
export async function setBrainAction(f: FormData) {
  const ctx = await adminAction("ai");
  const identity = await requireAdmin();
  const agentId = text(f, "agentId");
  await finish(`${BACK}#agent-${encodeURIComponent(agentId)}`, (message: string) => message, () => setAgentBrain(ctx, identity, agentId, text(f, "brain")));
}

/** 1 to 5 stars (or none) on what a run made: every run that made it gets the rating, so the averages move. */
export async function rateRunAction(f: FormData) {
  const ctx = await adminAction("ai");
  const identity = await requireAdmin();
  const agentId = text(f, "agentId");
  const raw = text(f, "rating");
  await finish(`${BACK}#agent-${encodeURIComponent(agentId)}`, (runs: number) => (raw ? `Rated ${raw} of 5, on ${runs} run${runs === 1 ? "" : "s"}.` : "Rating cleared."), () => rateRun(ctx, identity, text(f, "resultRef"), raw ? Number(raw) : null));
}
