import { prechatBody } from "@/lib/support/contract";
import { json, parse, readJson, route } from "@/lib/support/http";
import { submitPrechat } from "@/lib/support/prechat";
import { requireVisit } from "@/lib/support/visits";
import { clientIpHash } from "@/lib/widget/request";

export const POST = route(async (request) => {
  const session = await requireVisit(request.headers);
  const body = parse(prechatBody, await readJson(request));
  const { ip } = await clientIpHash(request);
  return json(await submitPrechat(session, body, { ip }));
});
