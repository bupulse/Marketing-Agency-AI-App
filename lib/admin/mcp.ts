import "server-only";
import { logError } from "@/lib/errors";
import { authenticateAdminRequest } from "./api-auth";
import { callTool, inputSchemaOf, toolAllowed, TOOLS, type Tool } from "./tools";
import { AdminError, type AdminContext } from "./types";

// A minimal, stateless MCP server over Streamable HTTP (spec 2025-06-18): every JSON-RPC message is a POST that is
// answered with application/json. No sessions and no SSE stream, so it runs on Cloudflare Workers as is.

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const MAX_BODY_BYTES = 256 * 1024;

const SERVER_INFO = { name: "bupulse-admin", title: "BuPulse Admin", version: "1.0.0" };
const INSTRUCTIONS =
  "BuPulse admin tools. Read tools are free to call. Action tools change production data and are written to an audit log. " +
  "issue_refund and change_plan (paid plans) only create an approval request that the owner confirms in the BuPulse admin console: " +
  "report the approval id to the owner and use get_approval to check it. suspend_user and update_plan_limits need confirm: true. " +
  "Money tools need a unique idempotencyKey; reuse it when retrying.";

type JsonRpcId = string | number | null;
type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0" as const, id, error: { code, message, ...(data === undefined ? {} : { data }) } });
const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });

const DESTRUCTIVE = new Set(["suspend_user", "update_plan_limits", "set_service_enabled", "set_ai_budget", "force_disconnect_channel", "disconnect_connector", "revoke_client_api_key", "switch_off_widget", "update_plan", "remove_company_user", "change_company_user_role", "change_user_email", "request_make_company_owner"]);
const IDEMPOTENT = new Set(["restore_user", "set_feature_flag", "set_service_enabled", "set_ai_budget", "switch_on_widget", "switch_off_widget", "test_service"]);

function annotations(t: Tool) {
  return {
    title: t.title,
    readOnlyHint: t.kind === "read",
    destructiveHint: DESTRUCTIVE.has(t.name),
    idempotentHint: t.kind === "read" || t.kind === "money" || IDEMPOTENT.has(t.name),
    openWorldHint: t.kind === "money",
  };
}

/** The tools a caller may use (all of them without a context: the docs and the console). */
export function listTools(ctx?: AdminContext) {
  return TOOLS.filter((t) => !ctx || toolAllowed(t.name, ctx)).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: inputSchemaOf(t), annotations: annotations(t) }));
}

function toolText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function handleCall(params: unknown, ctx: AdminContext) {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  if (typeof p.name !== "string") throw new AdminError("invalid", "tools/call needs params.name.");
  if (!TOOLS.some((t) => t.name === p.name)) return { protocol: true as const };
  try {
    const result = await callTool(p.name, p.arguments, ctx);
    return {
      content: [{ type: "text", text: toolText(result) }],
      ...(result && typeof result === "object" && !Array.isArray(result) ? { structuredContent: result } : {}),
      isError: false,
    };
  } catch (error) {
    if (error instanceof AdminError) {
      return { content: [{ type: "text", text: `${error.code}: ${error.message}` }], isError: true };
    }
    await logError(error, { source: "mcp:tools/call", tool: p.name });
    return { content: [{ type: "text", text: "server_error: Something went wrong on our side. Nothing was changed unless the audit log says otherwise." }], isError: true };
  }
}

/** Answers one JSON-RPC message; null for a notification (nothing to send back). */
export async function handleMessage(msg: Message, ctx: AdminContext): Promise<unknown | null> {
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null, -32600, "Invalid Request");
  const isNotification = msg.id === undefined;
  if (isNotification) return null; // notifications/initialized, notifications/cancelled ...: accepted, no reply
  if (typeof msg.id !== "string" && typeof msg.id !== "number") return rpcError(null, -32600, "Invalid Request: id must be a string or number");
  const id = msg.id;
  const params = (msg.params ?? {}) as Record<string, unknown>;

  switch (msg.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      return rpcResult(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: listTools(ctx) });
    case "tools/call": {
      try {
        const out = await handleCall(params, ctx);
        if ("protocol" in out) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
        return rpcResult(id, out);
      } catch (error) {
        if (error instanceof AdminError) return rpcError(id, -32602, error.message);
        throw error;
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

/** Browsers must not be able to drive this endpoint (DNS rebinding): an Origin header has to be this site or listed in MCP_ALLOWED_ORIGINS. */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // server-to-server clients send none
  const allowed = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  try {
    return allowed.includes(origin) || new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function handleMcpPost(request: Request): Promise<Response> {
  if (!originAllowed(request)) return json(rpcError(null, -32000, "Origin not allowed"), 403);
  const auth = await authenticateAdminRequest(request);
  if (!auth.ok) return auth.response;

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(rpcError(null, -32600, "Request too large"), 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  try {
    // Batches were removed from the spec (2025-06-18), and each HTTP request is one rate-limited call.
    if (Array.isArray(body)) return json(rpcError(null, -32600, "Invalid Request: JSON-RPC batches are not supported; send one message per request."), 400);
    if (!body || typeof body !== "object") return json(rpcError(null, -32600, "Invalid Request"), 400);
    const reply = await handleMessage(body as Message, auth.ctx);
    return reply === null ? new Response(null, { status: 202 }) : json(reply);
  } catch (error) {
    await logError(error, { source: "mcp" });
    return json(rpcError(null, -32603, "Internal error"), 500);
  }
}

/** GET (an SSE stream) and DELETE (ending a session) are not offered: this server is stateless. */
export function methodNotAllowed() {
  return json(rpcError(null, -32000, "Method not allowed: send JSON-RPC messages with POST."), 405, { allow: "POST" });
}
