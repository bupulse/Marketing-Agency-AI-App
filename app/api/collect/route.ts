import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getDailySalt } from "@/lib/analytics/salt";
import { logError } from "@/lib/errors";
import { RateLimitError, rateLimit } from "@/lib/rate-limit";
import {
  classifySource, cleanSessionId, clientIp, countryFrom, deviceFromUserAgent, isBot, normalizePath, parseUtm, referrerHost, visitorHash,
} from "@/lib/analytics/collect";

// Public first-party page-view collector, called by public/t.js with navigator.sendBeacon (text/plain JSON, so no CORS preflight).
// Always answers 204 whether the view was stored or ignored, so it reveals nothing to bots.
const body = z.object({
  p: z.string().max(400), // path
  r: z.string().max(500).optional(), // document.referrer
  q: z.string().max(600).optional(), // location.search (only utm_* are read)
  w: z.number().int().min(0).max(20000).optional(), // screen width
  s: z.string().max(60).optional(), // session id
  d: z.boolean().optional(), // navigator.webdriver
});

const done = () => new NextResponse(null, { status: 204 });
const RULE = { limit: 120, windowSeconds: 60 };
const DAILY_RULE = { limit: 1500, windowSeconds: 24 * 60 * 60 }; // page views per IP per day

export async function POST(request: NextRequest) {
  try {
    const userAgent = request.headers.get("user-agent") ?? "";
    if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return done();

    // Only our own pages count: a beacon always carries Origin; a Referer is accepted as a fallback. Neither = not a browser on our site.
    const siteHost = (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").hostname.replace(/^www\./, "");
      } catch {
        return null;
      }
    })();
    const ownHost = request.nextUrl.hostname.replace(/^www\./, "");
    const source = request.headers.get("origin") || request.headers.get("referer");
    if (!source) return done();
    try {
      const host = new URL(source).hostname.replace(/^www\./, "");
      if (host !== ownHost && host !== siteHost) return done();
    } catch {
      return done();
    }

    let parsed;
    try {
      parsed = body.safeParse(JSON.parse(await request.text()));
    } catch {
      return done();
    }
    if (!parsed.success) return done();
    const input = parsed.data;

    if (isBot(userAgent, { webdriver: input.d, acceptLanguage: request.headers.get("accept-language") ?? "" })) return done();
    const path = normalizePath(input.p);
    if (!path) return done();

    // No salt (database trouble) means no hash, and so no row: never fall back to a guessable key.
    const secret = await getDailySalt();
    if (!secret) return done();
    const now = new Date();
    const ip = clientIp(request.headers);
    const hash = await visitorHash(ip, userAgent, now, secret);
    // Limits are keyed on the IP alone (hashed), so rotating the user agent doesn't get a fresh allowance.
    const ipKey = await visitorHash(ip, "", now, secret);
    try {
      await rateLimit(`collect:${ipKey}`, RULE);
      await rateLimit(`collect-day:${ipKey}`, DAILY_RULE);
    } catch (error) {
      if (error instanceof RateLimitError) return done();
      throw error;
    }

    const utm = parseUtm(input.q);
    const host = referrerHost(input.r, siteHost ?? request.nextUrl.hostname.replace(/^www\./, ""));
    const cf = (request as unknown as { cf?: { country?: string } }).cf;
    await prisma.pageView.create({
      data: {
        sessionId: cleanSessionId(input.s),
        visitorHash: hash,
        path,
        referrerHost: host,
        source: classifySource(utm.source, host),
        utmSource: utm.source,
        utmMedium: utm.medium,
        utmCampaign: utm.campaign,
        device: deviceFromUserAgent(userAgent, input.w),
        country: countryFrom(request.headers, cf?.country, process.env.NODE_ENV !== "production"),
        screenWidth: input.w ?? null,
      },
    });
  } catch (error) {
    await logError(error, { source: "api/collect" }).catch(() => {});
  }
  return done();
}
