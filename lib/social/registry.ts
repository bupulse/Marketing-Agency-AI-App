import { facebookProvider } from "./providers/facebook";
import { instagramProvider } from "./providers/instagram";
import { linkedinProvider } from "./providers/linkedin";
import { tiktokProvider } from "./providers/tiktok";
import { youtubeProvider } from "./providers/youtube";
import { COMPOSIO_NETWORKS } from "./composio/client";
import { composioNetwork } from "./composio/networks";
import { NETWORKS, type ConnectionCredentials, type Network, type SocialProvider } from "./types";

const DIRECT: Record<Network, SocialProvider> = {
  instagram: instagramProvider,
  facebook: facebookProvider,
  linkedin: linkedinProvider,
  tiktok: tiktokProvider,
  youtube: youtubeProvider,
};

const isComposio = (c: ConnectionCredentials) => c.method === "COMPOSIO";
const hasComposioMetrics = (network: Network) => viaComposioPossible(network) && !!composioNetwork(network).metrics;

/**
 * Each network's provider. Publishing, metrics and revoke follow how the account was connected (credentials.method):
 * BuPulse-Socials accounts go through Composio (lib/social/composio), the rest through BuPulse's own app.
 * isConfigured stays about BuPulse's own app; the Channels page and the connect route add BuPulse-Socials (viaComposio).
 */
const viaComposioPossible = (network: Network) => COMPOSIO_NETWORKS.includes(network);

function withComposio(direct: SocialProvider): SocialProvider {
  return {
    ...direct,
    publish: (c, post) => (isComposio(c) ? composioNetwork(direct.network).publish(c, post) : direct.publish(c, post)),
    // Only where one of the ways can read numbers; an account whose way cannot gives an empty snapshot (not saved).
    metrics: direct.metrics || hasComposioMetrics(direct.network)
      ? async (c, externalId) => {
          if (isComposio(c)) return hasComposioMetrics(direct.network) ? composioNetwork(direct.network).metrics!(c, externalId) : {};
          return direct.metrics ? direct.metrics(c, externalId) : {};
        }
      : undefined,
    // Composio accounts are removed from Composio by lib/social/connections.ts (several Pages can share one sign-in).
    revoke: direct.revoke ? async (c) => (isComposio(c) ? undefined : direct.revoke!(c)) : undefined,
  };
}

const PROVIDERS = Object.fromEntries(NETWORKS.map((n) => [n, withComposio(DIRECT[n])])) as Record<Network, SocialProvider>;

export function isNetwork(value: string): value is Network {
  return (NETWORKS as readonly string[]).includes(value);
}

export function getProvider(network: Network): SocialProvider {
  return PROVIDERS[network];
}

export function allProviders(): SocialProvider[] {
  return NETWORKS.map((n) => PROVIDERS[n]);
}
