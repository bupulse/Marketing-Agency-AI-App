import { z } from "zod";
import { autocomplete, SESSION_TOKEN } from "@/lib/places/google";
import { json, placesFailed, placesRequest } from "@/lib/places/route";

// Address suggestions for the Brand page and onboarding location fields. GET ?q=<text>&session=<token>.
const query = z.object({ q: z.string().trim().min(2).max(200), session: z.string().regex(SESSION_TOKEN) });

export async function GET(request: Request) {
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  // The query is checked before the rate limit, so a malformed request never spends the company's quota.
  const ready = await placesRequest("autocomplete", parsed.success);
  if (!ready.ok) return ready.response;
  if (!parsed.success) return json({ error: "Bad request" }, 400);
  try {
    const suggestions = await autocomplete(ready.key, { q: parsed.data.q, sessionToken: parsed.data.session, regionCode: ready.regionCode });
    return json({ enabled: true, suggestions });
  } catch (error) {
    return placesFailed(error, "autocomplete", ready.user.id);
  }
}
