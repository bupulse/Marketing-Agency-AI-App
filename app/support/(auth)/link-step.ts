import "server-only";
import { hasRecentMailboxProof } from "@/lib/support/app-access";
import { currentAgentIdentity } from "@/lib/support/app-auth";
import type { PasswordFlowState } from "./actions";

/** Where the invite and new-password pages start: at the button, or (after a reload) at the step this session reached. */
export async function linkStep(): Promise<PasswordFlowState["step"]> {
  const who = await currentAgentIdentity();
  if (!who.ok || !hasRecentMailboxProof(who.identity.methods)) return "start";
  return who.identity.hasVerifiedTotp && who.identity.aal?.currentLevel !== "aal2" ? "code" : "password";
}

export const param = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
