import { describe, expect, it } from "vitest";
import { approvalTimePassed } from "@/lib/publishing/approval-note";

describe("approving a post whose time has passed", () => {
  const now = new Date("2026-10-23T10:00:00Z");
  it("is told only for posts waiting for approval at or before now", () => {
    expect(approvalTimePassed({ status: "PENDING_APPROVAL", scheduledAt: "2026-10-20T07:00:00Z" }, now)).toBe(true);
    expect(approvalTimePassed({ status: "PENDING_APPROVAL", scheduledAt: now }, now)).toBe(true);
    expect(approvalTimePassed({ status: "PENDING_APPROVAL", scheduledAt: "2026-10-24T07:00:00Z" }, now)).toBe(false);
    expect(approvalTimePassed({ status: "SCHEDULED", scheduledAt: "2026-10-20T07:00:00Z" }, now)).toBe(false);
    expect(approvalTimePassed({ status: "PENDING_APPROVAL", scheduledAt: null }, now)).toBe(false);
  });
});
