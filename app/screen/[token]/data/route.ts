import { NextResponse, type NextRequest } from "next/server";
import { screenData } from "@/lib/screen/data";
import { isScreenTokenFormat, screenByToken, touchScreen } from "@/lib/screen/links";
import { clientIpFrom, publicLimited } from "@/lib/request-limits";
import { logError } from "@/lib/errors";

// What the sales room TV shows, polled every 10 s by /screen/<token>. Same check as the page: an unknown or revoked
// token is a 404. ?after= is the cursor of the last money event the screen saw (new payments are celebrated).

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };

export async function GET(request: NextRequest, ctx: RouteContext<"/screen/[token]/data">) {
  const { token } = await ctx.params;
  // A malformed token costs nothing; then at most 30 requests a minute per address (a TV polls 6).
  if (!isScreenTokenFormat(token)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const limited = await publicLimited("screen", null, clientIpFrom(request.headers)).catch(() => null);
  if (limited) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  const link = await screenByToken(token).catch(() => undefined);
  if (link === undefined) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  try {
    const [data] = await Promise.all([screenData(request.nextUrl.searchParams.get("after")), touchScreen(link)]);
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    void logError(error, { source: "screen.data" });
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
