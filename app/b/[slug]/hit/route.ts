import type { NextRequest } from "next/server";
import { clientIp, isBot, visitorHash } from "@/lib/analytics/collect";
import { getDailySalt } from "@/lib/analytics/salt";
import { countBioHit, liveBioBusinessId, type BioHit } from "@/lib/bio/service";
import { logError } from "@/lib/errors";
import { RateLimitError, rateLimit } from "@/lib/rate-limit";

// Counts a visit or a tap on WhatsApp or Call of a link-in-bio page, sent by public/bio.js with navigator.sendBeacon
// (text/plain, so no CORS preflight). Always answers 204, stored or not, so it tells a bot nothing. Like /api/collect:
// only our own pages, no bots, and a few hits per visitor (hashed IP) and page, so nobody can pump the numbers.
const HITS: readonly BioHit[] = ["view", "wa", "call"];
const RULES: Record<BioHit, { limit: number; windowSeconds: number }> = {
  view: { limit: 3, windowSeconds: 60 * 60 },
  wa: { limit: 10, windowSeconds: 60 * 60 },
  call: { limit: 10, windowSeconds: 60 * 60 },
};

const done = () => new Response(null, { status: 204 });

export async function POST(request: NextRequest, ctx: RouteContext<"/b/[slug]/hit">) {
  try {
    const hit = (await request.text()).trim() as BioHit;
    if (!HITS.includes(hit)) return done();
    const source = request.headers.get("origin") || request.headers.get("referer");
    if (!source) return done();
    try {
      if (new URL(source).host !== request.nextUrl.host) return done();
    } catch {
      return done();
    }
    const userAgent = request.headers.get("user-agent") ?? "";
    if (isBot(userAgent, { acceptLanguage: request.headers.get("accept-language") ?? "" })) return done();
    const { slug } = await ctx.params;
    const businessId = await liveBioBusinessId(slug.toLowerCase());
    if (!businessId) return done();
    // No salt (database trouble) means no hash and so nothing counted: never a guessable key.
    const secret = await getDailySalt();
    if (!secret) return done();
    const now = new Date();
    const ipKey = await visitorHash(clientIp(request.headers), "", now, secret);
    try {
      await rateLimit(`bio-${hit}:${businessId}:${ipKey}`, RULES[hit], now);
    } catch (error) {
      if (error instanceof RateLimitError) return done();
      throw error;
    }
    await countBioHit(businessId, hit, now);
  } catch (error) {
    await logError(error, { source: "bio.hit", level: "warn" });
  }
  return done();
}
