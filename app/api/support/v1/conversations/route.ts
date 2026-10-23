import { sendMessageBody } from "@/lib/support/contract";
import { startConversation } from "@/lib/support/conversations";
import { json, parse, readJson, route } from "@/lib/support/http";
import { requireVisit } from "@/lib/support/visits";
import { clientIpHash } from "@/lib/widget/request";

// The first message of a chat; the AI's answer comes back in the same response.
export const maxDuration = 60;

export const POST = route(async (request) => {
  const session = await requireVisit(request.headers);
  const body = parse(sendMessageBody, await readJson(request));
  const { ip, hash } = await clientIpHash(request);
  return json(await startConversation(session, body, { ip, ipHash: hash }));
});
