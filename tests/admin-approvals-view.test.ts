import { describe, expect, it } from "vitest";
import { approvalNeedsCheck, splitApprovals } from "@/lib/admin/approvals-view";
import type { ApprovalView } from "@/lib/admin/types";

const NOW = Date.parse("2026-10-20T00:00:00Z");
const row = (id: string, status: ApprovalView["status"], daysAgo: number): ApprovalView => ({
  id, kind: "issue_refund", params: {}, status, requestedBy: "jarvis:k", idempotencyKey: id, result: null, decidedBy: null, decidedAt: null,
  createdAt: new Date(NOW - daysAgo * 86_400_000).toISOString(),
});

describe("approvals view", () => {
  it("keeps live pending requests out of history and lists expired ones as history", () => {
    const { pending, history } = splitApprovals([row("live", "pending", 1), row("old", "pending", 8)], [row("done", "executed", 2)], NOW);
    expect(pending.map((a) => a.id)).toEqual(["live"]);
    expect(history.map((a) => a.id)).toEqual(["done", "old"]);
  });

  it("shows a pending request even when 100 newer decided ones fill the history list", () => {
    const decided = Array.from({ length: 100 }, (_, i) => row(`d${i}`, "executed", 0.01));
    expect(splitApprovals([row("waiting", "pending", 3)], decided, NOW).pending).toHaveLength(1);
  });

  it("flags needs_check and a stuck approved request", () => {
    expect(approvalNeedsCheck("needs_check")).toBe(true);
    expect(approvalNeedsCheck("approved")).toBe(true);
    expect(approvalNeedsCheck("executed")).toBe(false);
  });
});
