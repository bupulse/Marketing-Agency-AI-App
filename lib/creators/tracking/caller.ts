import "server-only";
import { proxyRequest, runTool } from "@/lib/social/composio/client";
import { reserveComposioCalls } from "@/lib/social/inbox/budget";
import type { Network } from "@/lib/social/types";
import type { Caller } from "./types";

// The Composio calls of the creators' side, each reserved first against the month's limit (lib/social/inbox/budget.ts,
// the same limit as the inbox check), so reading views can never push BuPulse past Composio's free calls. A refused
// reservation throws BudgetError: the job stops there, without failing, and goes on next run.

export class BudgetError extends Error {
  constructor() {
    super("This month's Composio calls are used up");
    this.name = "BudgetError";
  }
}

/** A Caller for one connected account of one creator (Composio user "creator_<profileId>"). */
export function composioCaller(network: Network, connectedAccountId: string, composioUserId: string, limit: number): Caller & { calls: () => number } {
  let calls = 0;
  const reserve = async () => {
    if (!(await reserveComposioCalls(1, limit))) throw new BudgetError();
    calls++;
  };
  return {
    async tool<T>(slug: string, args: Record<string, unknown>) {
      await reserve();
      return runTool<T>(network, slug, connectedAccountId, composioUserId, args, { reserved: true });
    },
    async proxy<T>(request: { endpoint: string; method: "GET" | "POST"; body?: Record<string, unknown> }) {
      await reserve();
      return proxyRequest<T>(network, connectedAccountId, composioUserId, request, { reserved: true });
    },
    calls: () => calls,
  };
}

/** A Caller that counts its calls without a reservation: the creator's own sign-in, which must not wait for the budget. */
export function countedCaller(network: Network, connectedAccountId: string, composioUserId: string): Caller {
  return {
    tool: <T>(slug: string, args: Record<string, unknown>) => runTool<T>(network, slug, connectedAccountId, composioUserId, args),
    proxy: <T>(request: { endpoint: string; method: "GET" | "POST"; body?: Record<string, unknown> }) => proxyRequest<T>(network, connectedAccountId, composioUserId, request),
  };
}
