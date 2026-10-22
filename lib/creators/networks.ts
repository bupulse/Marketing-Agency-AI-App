// Every social network a campaign or a creator can name (docs/CREATOR_CAMPAIGN_WIZARD.md, "Where"). Pure.
//
// Owner decision (22 October 2026): list all the networks, and say "Coming soon" for the ones BuPulse cannot count
// views on yet. A campaign's platforms are only the tracked ones (PLATFORMS: views are read through Composio); on the
// application form a creator can still list accounts on the others, so the company sees their whole audience.

import { PLATFORMS, type Platform } from "./company-forms";

export const SOCIAL_NETWORKS = ["instagram", "facebook", "tiktok", "youtube", "x", "snapchat", "threads", "linkedin", "whatsapp", "pinterest"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_LABEL: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X (Twitter)",
  snapchat: "Snapchat",
  threads: "Threads",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp Status",
  pinterest: "Pinterest",
};

/** What the username box shows for each network. */
export const HANDLE_PLACEHOLDER: Record<SocialNetwork, string> = {
  instagram: "@yourname",
  facebook: "Page name or link",
  tiktok: "@yourname",
  youtube: "@yourchannel",
  x: "@yourname",
  snapchat: "yourname",
  threads: "@yourname",
  linkedin: "Profile link",
  whatsapp: "Number with country code",
  pinterest: "yourname",
};

export const isSocialNetwork = (v: unknown): v is SocialNetwork => typeof v === "string" && (SOCIAL_NETWORKS as readonly string[]).includes(v);

/** True when BuPulse counts views on the network, so a campaign can run on it. TikTok also needs its app (see `live`). */
export const isTracked = (n: string): n is Platform => (PLATFORMS as readonly string[]).includes(n);

/**
 * The networks a campaign can pick now, in order, and the rest marked coming soon. `tiktokReady` is false until the
 * TikTok app is set up (COMPOSIO_TIKTOK_AUTH_CONFIG_ID): then TikTok is shown "Coming soon" too.
 */
export function campaignNetworks(tiktokReady: boolean): { network: SocialNetwork; label: string; soon: boolean }[] {
  return SOCIAL_NETWORKS.map((network) => ({ network, label: SOCIAL_LABEL[network], soon: !isTracked(network) || (network === "tiktok" && !tiktokReady) }));
}
