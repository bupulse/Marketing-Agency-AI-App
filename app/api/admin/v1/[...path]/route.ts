import { NextResponse } from "next/server";
import { adminError, authenticateAdminRequest } from "@/lib/admin/api-auth";
import { listTools } from "@/lib/admin/mcp";
import { callTool, findTool, inputSchemaOf } from "@/lib/admin/tools";
import { AdminError } from "@/lib/admin/types";
import { logError } from "@/lib/errors";

// Admin REST API for Jarvis. Bearer admin key. See docs/JARVIS.md.
//   GET  /api/admin/v1/tools                list tools with JSON schemas
//   POST /api/admin/v1/tools/{name}         run any tool: JSON body = arguments
//   GET  /api/admin/v1/{alias}?…            read shortcuts (query string = arguments), e.g. /overview?days=7
export const dynamic = "force-dynamic";

const ALIASES: Record<string, string> = {
  overview: "get_overview",
  metrics: "get_metrics",
  funnel: "get_funnel",
  revenue: "get_revenue",
  costs: "get_costs",
  profit: "get_profit",
  "top-content": "get_top_content",
  "whats-working": "get_whats_working",
  "weekly-report": "weekly_report",
  users: "list_users",
  companies: "list_companies",
  businesses: "list_businesses",
  posts: "list_posts",
  errors: "get_errors",
  "audit-log": "get_audit_log",
  approvals: "list_approvals",
  "feature-flags": "list_feature_flags",
};
// /users/{id}, /businesses/{id}, /approvals/{id}
const BY_ID: Record<string, { tool: string; arg: string }> = {
  users: { tool: "get_user", arg: "userId" },
  businesses: { tool: "get_business", arg: "businessId" },
  approvals: { tool: "get_approval", arg: "id" },
  companies: { tool: "get_company", arg: "businessId" },
};

const ok = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** Query strings are text: turn them into the numbers, booleans and lists the tool's schema declares. */
function coerce(toolName: string, params: URLSearchParams): Record<string, unknown> {
  const props = ((inputSchemaOf(findTool(toolName)!).properties ?? {}) as Record<string, { type?: string | string[]; anyOf?: { type?: string }[] }>);
  const out: Record<string, unknown> = {};
  for (const [key, value] of params) {
    const type = props[key]?.type ?? props[key]?.anyOf?.[0]?.type;
    if (type === "integer" || type === "number") out[key] = Number(value);
    else if (type === "boolean") out[key] = value === "true" ? true : value === "false" ? false : value;
    else if (type === "array") out[key] = value.split(",").filter(Boolean);
    else out[key] = value;
  }
  return out;
}

async function run(request: Request, path: string[], method: "GET" | "POST") {
  const auth = await authenticateAdminRequest(request);
  if (!auth.ok) return auth.response;
  try {
    if (path.length === 1 && path[0] === "tools" && method === "GET") return ok({ tools: listTools() });
    if (path[0] === "tools" && path.length === 2) {
      const name = path[1];
      if (!findTool(name)) throw new AdminError("not_found", `Unknown tool "${name}".`);
      if (method === "GET") {
        if (findTool(name)!.kind !== "read") return adminError(405, "method_not_allowed", "Actions must be sent with POST.", { allow: "POST" });
        return ok({ result: await callTool(name, coerce(name, new URL(request.url).searchParams), auth.ctx) });
      }
      let args: unknown = {};
      const text = await request.text();
      if (text.trim()) {
        try {
          args = JSON.parse(text);
        } catch {
          return adminError(400, "invalid_json", "The request body is not valid JSON.");
        }
      }
      return ok({ result: await callTool(name, args, auth.ctx) });
    }
    if (method === "GET") {
      const [head, second] = path;
      if (path.length === 1 && ALIASES[head]) return ok({ result: await callTool(ALIASES[head], coerce(ALIASES[head], new URL(request.url).searchParams), auth.ctx) });
      // Next has already URL-decoded each path segment; decoding again would turn a literal "%" into a 500.
      if (path.length === 2 && BY_ID[head]) return ok({ result: await callTool(BY_ID[head].tool, { [BY_ID[head].arg]: second }, auth.ctx) });
    }
    return adminError(404, "not_found", "Unknown endpoint. GET /api/admin/v1/tools lists what is available.");
  } catch (error) {
    if (error instanceof AdminError) return adminError(error.status, error.code, error.message);
    await logError(error, { source: "api/admin/v1", path: path.join("/") });
    return adminError(500, "server_error", "Something went wrong on our side. Please try again.");
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, { params }: Ctx) {
  return run(request, (await params).path, "GET");
}
export async function POST(request: Request, { params }: Ctx) {
  return run(request, (await params).path, "POST");
}
