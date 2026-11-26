import { agentError, agentJson, agentRoute, listInbound } from "@/lib/mail/agent";
import { decodeCursor, parseLimit } from "@/lib/mail/agent-rules";

// GET /api/mail/agent/v1/messages?cursor=&since=&limit=  (docs/mail-crm/AGENT_API.md)
// Mail that arrived in the key's mailbox after the cursor, oldest first. Keep nextCursor and send it next time.
export const GET = agentRoute(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const cursor = decodeCursor(params.get("cursor"));
  if (cursor === "invalid") return agentError(400, "invalid_request", "cursor is not valid. Send the nextCursor from the last call.");
  const limit = parseLimit(params.get("limit"));
  if (limit === null) return agentError(400, "invalid_request", "limit must be a whole number from 1 to 100.");
  const sinceRaw = params.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) return agentError(400, "invalid_request", "since must be a date, for example 2026-11-26T00:00:00Z.");
  return agentJson(await listInbound(ctx, { cursor, since, limit }));
});
