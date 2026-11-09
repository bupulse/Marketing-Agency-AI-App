import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getDailySalt } from "@/lib/analytics/salt";
import { logError } from "@/lib/errors";
import { RateLimitError, rateLimit } from "@/lib/rate-limit";
import {
  COUNT_METHOD, DURATION_MAX_AGE_MS, MAX_DURATION_MS, cityFrom, classifySource, cleanSessionId, cleanViewId, clientIp, countryFrom, deviceFromUserAgent, deviceSignature,
  durationBeacon, isBot, normalizePath, parseUtm, primaryLanguage, referrerHost, visitorHash,
} from "@/lib/analytics/collect";

// Public first-party page-view collector, called by public/t.js with navigator.sendBeacon (text/plain JSON, so no CORS preflight).
// Two kinds of body: a page view, and a time-on-page beacon ({ v, e }) sent when the page is hidden or left.
// Always answers 204 whether the view was stored or ignored, so it reveals nothing to bots.
const hitBody = z.object({
  p: z.string().max(400), // path
  r: z.string().max(500).optional(), // document.referrer
  q: z.string().max(600).optional(), // location.search (only utm_* are read)
  w: z.number().int().min(0).max(20000).optional(), // screen width
  h: z.number().int().min(0).max(20000).optional(), // screen height
  l: z.string().max(40).optional(), // navigator.language
  v: z.string().max(40).optional(), // this page view's random id
  s: z.string().max(60).optional(), // session id
  d: z.boolean().optional(), // navigator.webdriver
});
const timeBody = z.object({
  v: z.string().max(40), // the page view's id, as sent with the view
  e: z.number().min(0).max(1e10), // visible (engaged) milliseconds so far
  d: z.boolean().optional(),
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

    let json: unknown;
    try {
      json = JSON.parse(await request.text());
    } catch {
      return done();
    }
    const time = json && typeof json === "object" && "e" in json ? timeBody.safeParse(json) : null;
    const hit = time ? null : hitBody.safeParse(json);
    if (time ? !time.success : !hit?.success) return done();
    const webdriver = time?.success ? time.data.d : hit?.success ? hit.data.d : undefined;

    if (isBot(userAgent, { webdriver, acceptLanguage: request.headers.get("accept-language") ?? "" })) return done();
    const path = hit?.success ? normalizePath(hit.data.p) : null;
    if (hit && !path) return done();

    // No salt (database trouble) means no hash, and so no row: never fall back to a guessable key.
    const secret = await getDailySalt();
    if (!secret) return done();
    const now = new Date();
    const ip = clientIp(request.headers);
    // Limits are keyed on the IP alone (hashed), so changing browser or device details doesn't get a fresh allowance.
    // Time beacons have their own buckets of the same size, so they never cost a page view its place.
    const ipKey = await visitorHash(ip, "", now, secret);
    const prefix = time ? "collect-time" : "collect";
    try {
      await rateLimit(`${prefix}:${ipKey}`, RULE);
      await rateLimit(`${prefix}-day:${ipKey}`, DAILY_RULE);
    } catch (error) {
      if (error instanceof RateLimitError) return done();
      throw error;
    }

    if (time?.success) {
      const beacon = durationBeacon(time.data.v, time.data.e);
      if (!beacon) return done();
      // Update only, never insert: an unknown id or a view older than DURATION_MAX_AGE_MS changes nothing. The beacon
      // sends the total so far, so a later, smaller number (a repeated beacon) never lowers it.
      await prisma.$executeRaw`
        UPDATE "PageView" SET "durationMs" = LEAST(${MAX_DURATION_MS}::int, GREATEST(COALESCE("durationMs", 0), ${beacon.ms}::int))
        WHERE "viewId" = ${beacon.viewId} AND "createdAt" >= ${new Date(now.getTime() - DURATION_MAX_AGE_MS)}`;
      return done();
    }

    if (!hit?.success || !path) return done();
    const input = hit.data;
    const device = deviceFromUserAgent(userAgent, input.w);
    // Older cached copies of t.js send no language: the browser's Accept-Language says the same thing.
    const language = primaryLanguage(input.l ?? request.headers.get("accept-language"));
    const hash = await visitorHash(ip, deviceSignature({ device, width: input.w, height: input.h, language }), now, secret);

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
        device,
        country: countryFrom(request.headers, cf?.country, process.env.NODE_ENV !== "production"),
        city: cityFrom(request.headers),
        screenWidth: input.w ?? null,
        screenHeight: input.h ?? null,
        language: language || null,
        viewId: cleanViewId(input.v),
        countMethod: COUNT_METHOD,
      },
    });
  } catch (error) {
    await logError(error, { source: "api/collect" }).catch(() => {});
  }
  return done();
}
