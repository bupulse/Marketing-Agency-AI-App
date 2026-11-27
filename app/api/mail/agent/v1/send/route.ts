import { after } from "next/server";
import { agentError, agentJson, agentRoute, sendAsAgent } from "@/lib/mail/agent";
import { parseSendInput } from "@/lib/mail/agent-rules";
import { deliverDue } from "@/lib/mail/send";

// POST /api/mail/agent/v1/send  { to, subject, text, inReplyTo? }  (docs/mail-crm/AGENT_API.md)
// Queues one plain-text email from the key's mailbox and delivers it right after the response. 202 with the message's
// id and RFC Message-ID; GET /messages/:id tells whether it went out.
export const POST = agentRoute(async (ctx, request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return agentError(400, "invalid_request", "Send a JSON body.");
  }
  const parsed = parseSendInput(body);
  if (!parsed.ok) return agentError(400, "invalid_request", parsed.error);
  const r = await sendAsAgent(ctx, parsed.input);
  if (!r.ok) return r.code === "limit" ? agentError(429, "daily_limit", r.error) : agentError(422, "not_sent", r.error);
  after(async () => {
    await deliverDue();
  });
  return agentJson({ id: r.id, threadId: r.threadId, messageId: r.messageId, status: "queued" }, 202);
});
