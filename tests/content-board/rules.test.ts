import { describe, expect, it } from "vitest";
import { autoDecision, REVIEW_REASONS, type AutoFacts } from "@/lib/content-board/rules";

const ok: AutoFacts = {
  network: "instagram",
  format: "POST",
  requireApproval: false,
  canSchedule: true,
  account: { usable: true },
  requiresMedia: true,
  hasMedia: true,
  hasVideo: false,
  videoPending: false,
  imagePending: false,
  issues: [],
};

describe("autoDecision", () => {
  it("schedules a finished post for an app that needs no approval", () => {
    expect(autoDecision(ok)).toEqual({ action: "schedule" });
  });

  it("leaves posts of apps that need approval waiting, with no note", () => {
    expect(autoDecision({ ...ok, requireApproval: true, account: null })).toEqual({ action: "wait" });
  });

  it("keeps a video idea in review until its video is rendered in the browser", () => {
    expect(autoDecision({ ...ok, network: "tiktok", format: "SCRIPT", hasMedia: false, videoPending: true })).toEqual({ action: "review", reason: REVIEW_REASONS.video });
    expect(autoDecision({ ...ok, network: "tiktok", format: "SCRIPT", hasMedia: true, hasVideo: true, videoPending: false })).toEqual({ action: "schedule" });
  });

  it("schedules a script reminder when no video is planned (the plan has no video)", () => {
    expect(autoDecision({ ...ok, network: "youtube", format: "SCRIPT", hasMedia: false })).toEqual({ action: "schedule" });
  });

  it("waits for a picture still being drawn, or a missing one", () => {
    expect(autoDecision({ ...ok, hasMedia: false, imagePending: true })).toEqual({ action: "review", reason: REVIEW_REASONS.picture });
    expect(autoDecision({ ...ok, hasMedia: false })).toEqual({ action: "review", reason: REVIEW_REASONS.noPicture });
    expect(autoDecision({ ...ok, network: "linkedin", requiresMedia: false, hasMedia: false })).toEqual({ action: "schedule" });
  });

  it("respects the plan and the channel connection", () => {
    expect(autoDecision({ ...ok, canSchedule: false })).toEqual({ action: "review", reason: REVIEW_REASONS.plan });
    expect(autoDecision({ ...ok, account: null })).toEqual({ action: "review", reason: REVIEW_REASONS.noAccount });
    expect(autoDecision({ ...ok, account: { usable: false } })).toEqual({ action: "review", reason: "Instagram needs to be reconnected first. Open Channels to fix it." });
  });

  it("never sends a post that breaks the network's rules", () => {
    expect(autoDecision({ ...ok, issues: ["Instagram allows up to 30 hashtags."] })).toEqual({ action: "review", reason: "Instagram allows up to 30 hashtags." });
  });
});
