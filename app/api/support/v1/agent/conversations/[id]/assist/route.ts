import { requireSupportAgent } from "@/lib/support/agent-auth";
import { assist } from "@/lib/support/agent-inbox";
import { json, route } from "@/lib/support/http";

export const maxDuration = 60;

export const GET = route(async (request, ctx: RouteContext<"/api/support/v1/agent/conversations/[id]/assist">) => {
  const agent = await requireSupportAgent(request);
  return json(await assist(agent, (await ctx.params).id));
});
