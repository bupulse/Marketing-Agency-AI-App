import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { bookingIcs } from "@/lib/demo/bookings";

// The calendar invite of a demo booking, by its unguessable token (linked from the booking emails and the dashboard).
// No session needed: the token is the secret, and the file holds nothing the booking emails did not already carry.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const booking = await prisma.demoBooking.findUnique({ where: { icsToken: token }, include: { business: { select: { name: true, user: { select: { email: true, name: true } } } } } });
  if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ics = await bookingIcs(booking, { name: booking.business.name, email: booking.business.user.email, contact: booking.business.user.name });
  return new NextResponse(ics, {
    headers: {
      "content-type": `text/calendar; charset=utf-8; method=${booking.status === "cancelled" ? "CANCEL" : "REQUEST"}`,
      "content-disposition": `attachment; filename="bupulse-demo.ics"`,
      "cache-control": "no-store",
    },
  });
}
