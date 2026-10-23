import { requireSupportAgent } from "@/lib/support/agent-auth";
import { assign } from "@/lib/support/agent-inbox";
import { assignBody } from "@/lib/support/contract";
import { json, parse, readJson, route } from "@/lib/support/http";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/agent/conversations/[id]/assign">) => {
  const agent = await requireSupportAgent(request);
  return json(await assign(agent, (await ctx.params).id, parse(assignBody, await readJson(request))));
});
