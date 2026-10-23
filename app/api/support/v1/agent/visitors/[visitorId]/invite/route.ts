import { requireSupportAgent } from "@/lib/support/agent-auth";
import { inviteVisitor } from "@/lib/support/agent-inbox";
import { inviteVisitorBody } from "@/lib/support/contract";
import { json, parse, readJson, route } from "@/lib/support/http";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/agent/visitors/[visitorId]/invite">) => {
  const agent = await requireSupportAgent(request);
  const { text } = parse(inviteVisitorBody, await readJson(request));
  return json(await inviteVisitor(agent, (await ctx.params).visitorId, text), 201);
});
