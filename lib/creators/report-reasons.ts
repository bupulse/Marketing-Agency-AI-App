// Marketplace report reasons (docs/CREATOR_MARKETPLACE.md, "Safety") and their words. Pure, so the report forms (client
// components) and lib/creators/reports.ts share them.

export const CAMPAIGN_REPORT_REASONS = ["SCAM", "NOT_PAID", "SPAM", "OFFENSIVE", "OTHER"] as const;
export const CREATOR_REPORT_REASONS = ["FAKE_VIEWS", "SPAM", "OFFENSIVE", "OTHER"] as const;
export type ReportReason = (typeof CAMPAIGN_REPORT_REASONS)[number] | (typeof CREATOR_REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  SCAM: "It looks like a scam",
  NOT_PAID: "They did not pay what they owe",
  FAKE_VIEWS: "Fake or bought views",
  SPAM: "Spam",
  OFFENSIVE: "Offensive content",
  OTHER: "Something else",
};
