import "server-only";
import type { InboundEvent } from "@/lib/inbox/types";
import { handleInbound, type DispatchResult } from "./engine";

// Called by lib/inbox/ingest.ts for every new inbound message, comment or Story mention, after it is stored.
// The automation engine (lib/automations/engine.ts) decides what answers it: a waiting automation step, a new
// automation whose trigger matches, or nothing (the website chat then answers with its own AI).

export type InboundContext = {
  event: InboundEvent;
  contactId: string;
  conversationId: string;
  messageId: string;
  /** A teammate took over this conversation: automations and the AI stay quiet. */
  botPaused: boolean;
};

export type { DispatchResult };

export async function dispatchInbound(context: InboundContext): Promise<DispatchResult> {
  return handleInbound(context);
}
