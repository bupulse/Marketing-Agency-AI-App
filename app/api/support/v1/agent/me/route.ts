import { setAvailability } from "@/lib/support/agent-account";
import { agentMe, requireSupportAgent } from "@/lib/support/agent-auth";
import { availabilityBody } from "@/lib/support/contract";
import { json, parse, readJson, route } from "@/lib/support/http";

export const GET = route(async (request) => json(agentMe(await requireSupportAgent(request))));

export const PATCH = route(async (request) => {
  const agent = await requireSupportAgent(request);
  const { availability } = parse(availabilityBody, await readJson(request));
  return json(await setAvailability(agent, availability));
});
