"use server";

import { requireAdmin } from "@/lib/admin/auth";
import { adminAction, finish } from "@/lib/admin/console";
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
