import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { checkActiveUser } from "@/lib/auth/require-user";
import { exportCsv } from "@/lib/contacts/service";
import { isChannelKind } from "@/lib/inbox/labels";

// The contacts list as a CSV file, with the same filters as the page (q, tag, channel). Not gated by the inbox feature:
// the contacts a company already has are its own data, exportable on any plan (like the leads export).
export async function GET(request: NextRequest) {
  const check = await checkActiveUser();
  if (check.status !== "ok") return NextResponse.json({ error: "Please sign in." }, { status: check.status === "signed_out" ? 401 : 403 });
  const business = await prisma.business.findUnique({ where: { userId: check.user.id }, select: { id: true } });
  if (!business) return NextResponse.json({ error: "No business found." }, { status: 404 });
  const sp = request.nextUrl.searchParams;
  const channel = sp.get("channel");
  const csv = await exportCsv(business.id, { q: sp.get("q")?.slice(0, 100), tag: sp.get("tag")?.slice(0, 40), channel: isChannelKind(channel) ? channel : null });
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bupulse-contacts-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
