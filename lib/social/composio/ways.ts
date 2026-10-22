import type { Network } from "../types";

// Which networks BuPulse-Socials (lib/social/composio/client.ts) can connect, from the environment only. Pure (no
// database, no server-only import) so the networks' rules (lib/social/providers) can read it too.

/** Networks whose toolkit has Composio-managed sign-in: BuPulse makes their auth configs itself (authConfigFor). */
export const MANAGED_NETWORKS: readonly Network[] = ["facebook", "instagram", "linkedin", "youtube"];

/**
 * Networks without Composio-managed sign-in (docs.composio.dev/toolkits/tiktok and /twitter: "Composio-managed OAuth
 * available? No"). Each needs an auth config made in Composio with BuPulse's own developer app; its id (ac_...) goes in
 * this variable (Admin -> Services keys or the host's variables). Without it the network shows "Coming soon" in Channels.
 * docs/PLATFORM_APPS.md has the steps.
 */
export const OWN_APP_CONFIG: Partial<Record<Network, string>> = { tiktok: "COMPOSIO_TIKTOK_AUTH_CONFIG_ID", twitter: "COMPOSIO_TWITTER_AUTH_CONFIG_ID" };

/** Every network BuPulse-Socials can post to (lib/social/composio/networks.ts has each one's tools). */
export const COMPOSIO_NETWORKS: readonly Network[] = [...MANAGED_NETWORKS, "tiktok", "twitter"];

/** The auth config made with BuPulse's own app for a network that needs one, or null while it is not set. */
export function ownAuthConfig(network: Network): string | null {
  const name = OWN_APP_CONFIG[network];
  return (name && process.env[name]?.trim()) || null;
}

/** True when BuPulse-Socials can sign this network in: Composio's own app, or BuPulse's app's auth config is set. */
export const composioCanSignIn = (network: Network) => MANAGED_NETWORKS.includes(network) || !!ownAuthConfig(network);

/** Networks switched back to BuPulse's own apps, e.g. "facebook,instagram" once Meta has verified BuPulse. */
function directNetworks(): Set<string> {
  return new Set((process.env.SOCIALS_DIRECT ?? "").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean));
}

/**
 * True when new connections of this network go through BuPulse-Socials: the Composio key is set (saved keys are
 * loaded into process.env by lib/admin/service-keys.ts), Composio can sign the network in (managed, or BuPulse's own
 * TikTok or X app is set up) and it is not listed in SOCIALS_DIRECT. Existing connections keep their own method either way.
 */
export function viaComposio(network: Network): boolean {
  return !!process.env.COMPOSIO_API_KEY && composioCanSignIn(network) && !directNetworks().has(network);
}

/** TikTok videos can go out through BuPulse-Socials: the Composio key and BuPulse's TikTok app's auth config are set. */
export const tiktokVideoPosts = () => !!process.env.COMPOSIO_API_KEY && !!ownAuthConfig("tiktok");

/**
 * Direct posting needs TikTok's audit to be public (posts made before it stay private for good, docs/PLATFORM_APPS.md
 * section 2), so until TIKTOK_DIRECT_POST=true a video goes to the account's TikTok inbox: the owner gets a TikTok
 * notification, adds the caption and posts it there (TikTok's inbox upload takes no caption).
 */
export const tiktokDirectPost = () => process.env.TIKTOK_DIRECT_POST === "true";
