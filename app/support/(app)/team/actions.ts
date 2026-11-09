"use server";

import { revalidatePath } from "next/cache";
import { AdminError } from "@/lib/admin/types";
import { requestIp } from "@/lib/request-limits";
import { approveJoinRequest, declineJoinRequest } from "@/lib/support/agents";
import { requireSupportAgentPage } from "@/lib/support/app-auth";

export type TeamActionState = { error?: string; done?: string };

/** admin@bupulse.com only (docs/SUPPORT_DASHBOARD.md): approve sends the invite email, decline removes the request. */
export async function answerRequest(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const me = await requireSupportAgentPage();
  if (!me.owner) return { error: "Only the admin can answer requests." };
  const id = String(formData.get("id") ?? "");
  const approve = formData.get("answer") === "approve";
  const ctx = { actor: `support:${me.email}`, ip: await requestIp(), viaApi: false };
  try {
    if (approve) {
      const r = await approveJoinRequest(ctx, id);
      revalidatePath("/support/team");
      return { done: r.emailed ? "Approved: the invite email is on its way." : "Approved, but the invite email could not be sent. Use Resend invite in Admin -> Live chat." };
    }
    await declineJoinRequest(ctx, id);
    revalidatePath("/support/team");
    return { done: "Declined." };
  } catch (e) {
    if (e instanceof AdminError) return { error: e.message };
    throw e;
  }
}
