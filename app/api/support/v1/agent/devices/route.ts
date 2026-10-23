import { saveDevice } from "@/lib/support/agent-account";
import { requireSupportAgent } from "@/lib/support/agent-auth";
import { deviceBody } from "@/lib/support/contract";
import { json, parse, readJson, route } from "@/lib/support/http";

export const POST = route(async (request) => {
  const agent = await requireSupportAgent(request);
  return json(await saveDevice(agent, parse(deviceBody, await readJson(request))), 201);
});
