import "server-only";
// The shared checks of /api/places/*, in this order: signed in, allowed to edit the brand, a key is set, the query is
// valid (so a bad request never spends quota), under the company's rate limit. Without a key the routes answer
// { enabled: false } and the form keeps working as a plain address box.
import { checkActiveUser, type SessionUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";
import { countryCodeForName } from "@/lib/region-format";
import { can } from "@/lib/team/roles";
import { PlacesError, placesKey } from "./google";

const HEADERS = { "Cache-Control": "private, no-store" };
const LIMITS = { autocomplete: RATE_LIMITS.placesAutocomplete, details: RATE_LIMITS.placesDetails };

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...HEADERS, ...extra } });
}

type Ready = { ok: true; user: SessionUser; key: string; regionCode: string | null };
type Done = { ok: false; response: Response };

export async function placesRequest(kind: keyof typeof LIMITS, validQuery: boolean): Promise<Ready | Done> {
  const check = await checkActiveUser();
  if (check.status === "signed_out") return { ok: false, response: json({ error: "Sign in first." }, 401) };
  if (check.status !== "ok") return { ok: false, response: json({ error: "Not allowed." }, 403) };
  const user = check.user;
  if (!can(user.role, "settings")) return { ok: false, response: json({ error: "Not allowed." }, 403) };
  const key = placesKey();
  if (!key) return { ok: false, response: json({ enabled: false }) };
  if (!validQuery) return { ok: false, response: json({ error: "Bad request" }, 400) };
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true, country: true } });
  if (!business) return { ok: false, response: json({ error: "Not allowed." }, 403) };
  try {
    // Per company: every teammate searching for the same business shares one budget.
    await rateLimit(`places:${kind}:${business.id}`, LIMITS[kind]);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, response: json({ error: "Too many searches. Type the address instead, or try again later." }, 429, { "Retry-After": String(error.retryAfterSeconds) }) };
    }
    throw error;
  }
  return { ok: true, user, key, regionCode: countryCodeForName(business.country)?.toLowerCase() ?? null };
}

/** Google failed or timed out: the person can still type the address. Logs the status only, never the key. */
export async function placesFailed(error: unknown, source: string, userId: string): Promise<Response> {
  const status = error instanceof PlacesError ? error.status : 0;
  await logError(new Error(`Places ${source} failed${status ? ` (HTTP ${status})` : ""}`), { source: `places.${source}`, userId });
  return json({ error: "Address search is not available right now. Type the address instead." }, 502);
}
