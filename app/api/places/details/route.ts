import { z } from "zod";
import { PLACE_ID } from "@/lib/business-info/locations";
import { placeDetails, SESSION_TOKEN } from "@/lib/places/google";
import { json, placesFailed, placesRequest } from "@/lib/places/route";

// The chosen suggestion's address and coordinates. GET ?id=<place id>&session=<token>; ends the billing session.
const query = z.object({ id: z.string().regex(PLACE_ID), session: z.string().regex(SESSION_TOKEN).optional() });

export async function GET(request: Request) {
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  // The query is checked before the rate limit, so a malformed request never spends the company's quota.
  const ready = await placesRequest("details", parsed.success);
  if (!ready.ok) return ready.response;
  if (!parsed.success) return json({ error: "Bad request" }, 400);
  try {
    const place = await placeDetails(ready.key, { placeId: parsed.data.id, sessionToken: parsed.data.session, regionCode: ready.regionCode });
    if (!place.address) return json({ error: "That place has no address. Type it instead." }, 404);
    return json({ enabled: true, place });
  } catch (error) {
    return placesFailed(error, "details", ready.user.id);
  }
}
