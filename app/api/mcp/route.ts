import { handleMcpPost, methodNotAllowed } from "@/lib/admin/mcp";

// MCP server for Jarvis (Streamable HTTP, stateless). See docs/JARVIS.md.
export const dynamic = "force-dynamic";

export const POST = handleMcpPost;
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
