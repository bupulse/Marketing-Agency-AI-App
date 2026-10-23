import { requireSupportAgent } from "@/lib/support/agent-auth";
import { listConversations, type ListView } from "@/lib/support/agent-inbox";
import { json, route } from "@/lib/support/http";

const VIEWS: ListView[] = ["mine", "waiting", "ai", "all"];

export const GET = route(async (request) => {
  const agent = await requireSupportAgent(request);
  const p = request.nextUrl.searchParams;
  const view = VIEWS.find((v) => v === p.get("view")) ?? "all";
  return json(await listConversations(agent, { view, q: p.get("q"), after: p.get("after"), limit: Number(p.get("limit")) || undefined }));
});
