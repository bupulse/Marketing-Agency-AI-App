import { NextResponse, type NextRequest } from "next/server";
import { getActivity } from "@/lib/admin/activity";
import { isAdminSession } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

// Polled every 5 seconds by the live feed. Same gate as the pages: anyone else gets a plain 404.
export async function GET(request: NextRequest) {
  if (!(await isAdminSession(["system", "overview"]))) return new NextResponse("Not found", { status: 404 });
  const q = request.nextUrl.searchParams;
  const page = await getActivity({
    before: q.get("before"),
    after: q.get("after"),
    types: (q.get("types") ?? "").split(",").filter(Boolean),
    limit: Number(q.get("limit")) || 40,
  });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
