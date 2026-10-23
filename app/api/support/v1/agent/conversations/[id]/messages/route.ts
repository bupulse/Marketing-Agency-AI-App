import { requireSupportAgent } from "@/lib/support/agent-auth";
import { agentMessage } from "@/lib/support/agent-inbox";
import { agentMessageBody } from "@/lib/support/contract";
import { json, parse, readJson, route } from "@/lib/support/http";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/agent/conversations/[id]/messages">) => {
  const agent = await requireSupportAgent(request);
  return json(await agentMessage(agent, (await ctx.params).id, parse(agentMessageBody, await readJson(request))));
});
