import { agentError, agentJson, agentMessageStatus, agentRoute } from "@/lib/mail/agent";

// GET /api/mail/agent/v1/messages/:id: whether an email this key sent went out (queued | sending | sent | failed).
export const GET = agentRoute(async (ctx, _request, route: { params: Promise<{ id: string }> }) => {
  const { id } = await route.params;
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return agentError(400, "invalid_request", "id is not valid.");
  const status = await agentMessageStatus(ctx, id);
  return status ? agentJson(status) : agentError(404, "not_found", "This key sent no message with that id.");
});
