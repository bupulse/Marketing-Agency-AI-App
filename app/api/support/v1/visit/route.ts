import { visitBody } from "@/lib/support/contract";
import { json, parse, readJson, route } from "@/lib/support/http";
import { startVisit } from "@/lib/support/visits";
import { clientIpHash, ownHostsFor } from "@/lib/widget/request";

// Starts or continues a visit (docs/api/support-v1.md). The only visitor route without X-Support-Visit.
export const POST = route(async (request) => {
  const body = parse(visitBody, await readJson(request));
  const { hash } = await clientIpHash(request);
  return json(await startVisit(body, { headers: request.headers, ownHosts: ownHostsFor(request), ipHash: hash }));
});
