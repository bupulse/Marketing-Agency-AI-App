import { requireSupervisor, requireSupportAgent } from "@/lib/support/agent-auth";
import { SupportError, json, route } from "@/lib/support/http";
import { loadStats } from "@/lib/support/stats";

const DAY_MS = 86_400_000;

// Supervisors only. Defaults to the last 7 days; at most 366 days at once.
export const GET = route(async (request) => {
  requireSupervisor(await requireSupportAgent(request));
  const p = request.nextUrl.searchParams;
  const to = p.get("to") ? new Date(p.get("to")!) : new Date();
  const from = p.get("from") ? new Date(p.get("from")!) : new Date(to.getTime() - 7 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to || to.getTime() - from.getTime() > 366 * DAY_MS) {
    throw new SupportError(400, "invalid_range", "Choose a period of up to a year, with from before to (ISO dates).");
  }
  return json(await loadStats(from, to));
});
