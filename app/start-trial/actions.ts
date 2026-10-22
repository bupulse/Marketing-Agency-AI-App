"use server";

import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/require-user";
import { demoLimited } from "@/lib/demo/limits";
import { logError } from "@/lib/errors";
import { requestIp } from "@/lib/request-limits";
import { startOwnTrial, TrialError } from "@/lib/trial/start";

export type StartTrialState = { error?: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

/**
 * "Start my free trial": the plan to try, and the trial starts at once (lib/trial/start.ts). Owner or admin only, like
 * choosing the plan; the service checks the plan is offered in the company's region. A trial that already started
 * (a second tap, another tab) goes to the dashboard like the first one.
 */
export async function startTrialAction(_prev: StartTrialState, formData: FormData): Promise<StartTrialState> {
  const user = await requireActiveUser("settings");
  const limited = await demoLimited(user.businessId, "trial");
  if (limited) return { error: limited };
  try {
    const ip = await requestIp().catch(() => null);
    await startOwnTrial({ businessId: user.businessId, actorId: user.actorId, planKey: String(formData.get("plan") ?? ""), ip });
  } catch (error) {
    if (!(error instanceof TrialError)) {
      await logError(error, { source: "trial.start", businessId: user.businessId });
      return { error: GENERIC };
    }
    if (error.code !== "not_pending" && error.code !== "changed") return { error: error.message };
  }
  redirect("/dashboard");
}
