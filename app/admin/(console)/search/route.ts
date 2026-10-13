import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminSession } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

// The console search (Cmd/Ctrl+K) asks here for companies by name or any member's email. Same gate as the pages
// (admin email, AAL2): anyone else gets a plain 404.
export async function GET(request: NextRequest) {
  if (!(await isAdminSession())) return new NextResponse("Not found", { status: 404 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ companies: [] }, { headers: { "Cache-Control": "no-store" } });
  const rows = await prisma.business.findMany({
    where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { memberships: { some: { user: { email: { contains: q, mode: "insensitive" } } } } }] },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, name: true, user: { select: { email: true, subscription: { select: { plan: true, status: true } } } } },
  });
  const companies = rows.map((b) => ({ id: b.id, name: b.name, email: b.user.email, plan: b.user.subscription?.plan ?? null, status: b.user.subscription?.status ?? null }));
  return NextResponse.json({ companies }, { headers: { "Cache-Control": "no-store" } });
}
