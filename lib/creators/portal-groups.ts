// The portal's Campaigns page (docs/CREATOR_MARKETPLACE.md, "The creator's dashboard"): every campaign a creator is in,
// by status. Pure, so the grouping has tests; lib/creators/portal.ts reads the rows.

import { OFFER_DAYS, offerExpired, offerExpiresAt } from "./company-forms";

const OFFER_MS = OFFER_DAYS * 86_400_000;

export type CampaignGroup = "joined" | "waiting" | "invitations" | "ended";

export type PortalRow = { status: string; source: string; offeredAt: Date | null; campaign: { status: string } };

// One rule for when an invitation expires, shared with the company side (lib/creators/company-forms.ts).
export { OFFER_DAYS, offerExpired } from "./company-forms";

/** The moment an invitation stops working. */
export const offerEndsAt = (offeredAt: Date) => offerExpiresAt(offeredAt);

/** Which group a row goes in. */
export function groupOf(row: PortalRow, now = new Date()): CampaignGroup {
  const ended = row.campaign.status === "ENDED";
  if (row.status === "JOINED") return ended ? "ended" : "joined";
  if (row.status === "APPLIED" || row.status === "SELECTED") return ended ? "ended" : "waiting";
  if (row.status === "OFFERED") {
    if (ended) return "ended";
    if (!offerExpired(row.offeredAt, now)) return "invitations";
    // Expired: still shown (marked Expired) for another 14 days, then under Ended.
    return row.offeredAt && now.getTime() - row.offeredAt.getTime() <= 2 * OFFER_MS ? "invitations" : "ended";
  }
  return "ended"; // REMOVED, DECLINED
}

/** The rows in their groups, in the order the page shows them. */
export function groupCampaigns<T extends PortalRow>(rows: T[], now = new Date()): Record<CampaignGroup, T[]> {
  const out: Record<CampaignGroup, T[]> = { invitations: [], joined: [], waiting: [], ended: [] };
  for (const r of rows) out[groupOf(r, now)].push(r);
  return out;
}

/** The short label of a row on the page. */
export function rowLabel(row: PortalRow, now = new Date()): string {
  switch (row.status) {
    case "JOINED":
      return row.campaign.status === "ENDED" ? "Ended" : row.campaign.status === "PAUSED" ? "Paused" : row.campaign.status === "DRAFT" ? "Not started" : "Live";
    case "APPLIED":
      return row.campaign.status === "ENDED" ? "Ended" : "Applied";
    case "SELECTED":
      return row.campaign.status === "ENDED" ? "Ended" : "Picked";
    case "OFFERED":
      return row.campaign.status === "ENDED" ? "Ended" : offerExpired(row.offeredAt, now) ? "Expired" : "Invitation";
    case "REMOVED":
      return "Left";
    case "DECLINED":
      return row.source === "OFFER" ? "You said no" : "Not picked";
    default:
      return row.status;
  }
}
