import type { Network } from "@/lib/social/types";

/** What the Connections page knows about one network, computed on the server. */
export type ChannelInfo = {
  network: Network;
  label: string;
  note: string;
  /** App keys are set; otherwise the card says "Coming soon". */
  configured: boolean;
  /** Instagram only: "Connect through Facebook" is available. */
  viaFacebook?: boolean;
};

export type AccountInfo = {
  id: string;
  network: Network;
  displayName: string | null;
  externalAccountId: string;
  accountType: string | null;
  avatarUrl: string | null;
  status: "ACTIVE" | "EXPIRING" | "EXPIRED" | "REVOKED" | "ERROR";
  postingMode: "AUTO" | "NOTIFY";
};

/** Personal Instagram is reminder posting and needs no Meta app, so Instagram can always be added; other networks need their keys. */
export const canConnect = (c: ChannelInfo) => c.configured || c.network === "instagram";

export const NEXT = "/dashboard/connections";
export const connectHref = (network: Network, variant?: string) =>
  `/api/social/${network}/connect?${variant ? `variant=${variant}&` : ""}next=${encodeURIComponent(NEXT)}`;
