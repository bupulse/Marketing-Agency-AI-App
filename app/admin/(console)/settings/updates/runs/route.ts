import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/admin/auth";
import { listDeployRuns } from "@/lib/admin/updates";

export const dynamic = "force-dynamic";

// Polled every 10 seconds by the Updates page while a deploy is queued or running. Same gate as the pages: anyone
// else gets a plain 404.
export async function GET() {
  if (!(await isAdminSession())) return new NextResponse("Not found", { status: 404 });
  try {
    const page = await listDeployRuns();
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "GitHub could not be reached." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
