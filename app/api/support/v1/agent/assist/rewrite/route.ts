import { requireSupportAgent } from "@/lib/support/agent-auth";
import { rewrite } from "@/lib/support/agent-inbox";
import { rewriteBody } from "@/lib/support/contract";
import { json, parse, readJson, route } from "@/lib/support/http";

export const maxDuration = 60;

export const POST = route(async (request) => {
  const agent = await requireSupportAgent(request);
  return json(await rewrite(agent, parse(rewriteBody, await readJson(request))));
});
