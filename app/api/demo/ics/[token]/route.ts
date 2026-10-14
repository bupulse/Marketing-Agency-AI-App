import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/platform/headers";
import { bookingIcs } from "@/lib/demo/bookings";
import { icsFilename } from "@/lib/demo/calendar-links";
import { rateLimit, RateLimitError } from "@/lib/rate-limit";

// The calendar invite of a demo booking or a custom plan call, by its unguessable token (linked from the booking emails,
// the dashboard and the call page). No session needed: the token is the secret (32 random bytes). Only a live booking
// that is not long past is served: cancelled, done and old ones answer 404, and each address may fetch a few dozen an hour.

/** How long after the call the invite can still be fetched. */
export const SERVE_AFTER_END_MS = 24 * 60 * 60 * 1000;
export const ICS_RATE_LIMIT = { limit: 30, windowSeconds: 60 * 60 };

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(request.headers) ?? "unknown";
  try {
    await rateLimit(`demo-ics:${ip}`, ICS_RATE_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds), "cache-control": "no-store" } });
    throw error;
  }
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return notFound();
  const booking = await prisma.demoBooking.findUnique({ where: { icsToken: token }, include: { business: { select: { name: true, user: { select: { email: true, name: true } } } } } });
  if (!booking || booking.status !== "booked" || booking.endsAt.getTime() < Date.now() - SERVE_AFTER_END_MS) return notFound();
  const ics = await bookingIcs(booking, { name: booking.business.name, email: booking.business.user.email, contact: booking.business.user.name }, "client");
  return new NextResponse(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8; method=REQUEST",
      "content-disposition": `attachment; filename="${icsFilename(booking.kind)}"`,
      "cache-control": "no-store",
    },
  });
}
