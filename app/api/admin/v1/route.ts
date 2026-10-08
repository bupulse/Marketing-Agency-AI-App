import { adminError, authenticateAdminRequest } from "@/lib/admin/api-auth";
import { TOOL_NAMES } from "@/lib/admin/tools";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/admin/v1: who you are and what exists. */
export async function GET(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ api: "bupulse-admin", version: 1, actor: auth.ctx.actor, tools: TOOL_NAMES, docs: "docs/JARVIS.md" }, { headers: { "cache-control": "no-store" } });
}
export const POST = () => adminError(405, "method_not_allowed", "Use GET, or POST /api/admin/v1/tools/{name}.");
