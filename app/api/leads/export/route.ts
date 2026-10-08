import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { checkActiveUser } from "@/lib/auth/require-user";
import { leadsToCsv } from "@/lib/leads/csv";
import { MAX_EXPORT, leadWhere, parseFilters } from "@/lib/leads/filters";

// The leads inbox as a CSV file. Respects the same filters as the page (status, source, q).
export async function GET(request: NextRequest) {
  const check = await checkActiveUser();
  if (check.status !== "ok") return NextResponse.json({ error: "Please sign in." }, { status: check.status === "signed_out" ? 401 : 403 });
  const business = await prisma.business.findUnique({ where: { userId: check.user.id }, select: { id: true } });
  if (!business) return NextResponse.json({ error: "No business found." }, { status: 404 });

  const leads = await prisma.lead.findMany({
    where: leadWhere(business.id, parseFilters(request.nextUrl.searchParams)),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_EXPORT,
  });
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(leadsToCsv(leads), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bupulse-leads-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
