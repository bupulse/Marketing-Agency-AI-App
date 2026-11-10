import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp, countryFrom, isBot } from "@/lib/analytics/collect";
import { originFor } from "@/lib/auth/site-url";
import { logError } from "@/lib/errors";
import { LINK_COOKIE, LINK_MAX_AGE, landingUrl, normalizeCode } from "@/lib/links/rules";
import { RateLimitError, rateLimit } from "@/lib/rate-limit";

// A tracked link (docs/SUPPORT_DASHBOARD.md "Tracked links"): bupulse.com/go/<code>. Counts the click, remembers the link
// for 30 days (cookie bp-link: the link's id, nothing else), and opens the link's page with utm tags, so the landing
// page view names it. Bots are not counted; visitors who opted out of tracking (GPC, Do Not Track) are counted as a
// click but get no cookie. An archived link still opens its page, counting nothing. An unknown code opens the home page.
// Never fails: anything that goes wrong still sends the visitor on.

export const dynamic = "force-dynamic";

const CLICK_RULE = { limit: 30, windowSeconds: 60 }; // clicks counted per address per minute

export async function GET(request: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const origin = originFor(request.headers);
  const code = normalizeCode((await ctx.params).code);
  const link = code
    ? await prisma.trackedLink.findUnique({ where: { code }, select: { id: true, code: true, channel: true, destination: true, archivedAt: true } }).catch(() => null)
    : null;
  if (!link) return NextResponse.redirect(new URL("/", origin), 302);
  const response = NextResponse.redirect(landingUrl(link, origin), 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex");
  if (link.archivedAt) return response;

  const userAgent = request.headers.get("user-agent") ?? "";
  if (isBot(userAgent, { acceptLanguage: request.headers.get("accept-language") ?? "" })) return response;
  const optedOut = request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1";
  if (!optedOut) {
    response.cookies.set(LINK_COOKIE, link.id, { path: "/", maxAge: LINK_MAX_AGE, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
  try {
    await rateLimit(`go:${clientIp(request.headers)}`, CLICK_RULE);
    const cf = (request as unknown as { cf?: { country?: string } }).cf;
    await prisma.trackedLinkClick.create({ data: { linkId: link.id, country: countryFrom(request.headers, cf?.country, process.env.NODE_ENV !== "production") } });
  } catch (error) {
    if (!(error instanceof RateLimitError)) await logError(error, { source: "links.go", level: "warn" });
  }
  return response;
}
