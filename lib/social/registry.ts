import { facebookProvider } from "./providers/facebook";
import { instagramProvider } from "./providers/instagram";
import { linkedinProvider } from "./providers/linkedin";
import { tiktokProvider } from "./providers/tiktok";
import { twitterProvider } from "./providers/twitter";
import { youtubeProvider } from "./providers/youtube";
import { COMPOSIO_NETWORKS } from "./composio/client";
import { composioNetwork } from "./composio/networks";
import { publishLinkedIn } from "./uploadpost/linkedin";
import { publishTikTok } from "./uploadpost/tiktok";
import { NETWORKS, SocialError, type ConnectionCredentials, type Network, type SocialProvider } from "./types";

const DIRECT: Record<Network, SocialProvider> = {
  instagram: instagramProvider,
  facebook: facebookProvider,
  linkedin: linkedinProvider,
  tiktok: tiktokProvider,
  youtube: youtubeProvider,
  // X has no app of its own: BuPulse-Socials only (lib/social/providers/twitter.ts).
  twitter: twitterProvider,
};

const isComposio = (c: ConnectionCredentials) => c.method === "COMPOSIO";
const isUploadPost = (c: ConnectionCredentials) => !!c.uploadPostProfile;
/** Upload-Post's posting for each network it connects (lib/social/uploadpost). */
const UPLOAD_POST_PUBLISH: Partial<Record<Network, SocialProvider["publish"]>> = { linkedin: publishLinkedIn, tiktok: publishTikTok };
const uploadPostPublish = (network: Network): SocialProvider["publish"] =>
  UPLOAD_POST_PUBLISH[network] ?? (async () => { throw new SocialError(`${network} cannot post through Upload-Post`, "invalid", network); });
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
    // Upload-Post accounts (LinkedIn and TikTok through Upload-Post: lib/social/uploadpost) post through Upload-Post.
    publish: (c, post) => (isUploadPost(c) ? uploadPostPublish(direct.network)(c, post) : isComposio(c) ? composioNetwork(direct.network).publish(c, post) : direct.publish(c, post)),
    // Only where one of the ways can read numbers; an account whose way cannot gives an empty snapshot (not saved).
    // Upload-Post accounts have no numbers yet.
    metrics: direct.metrics || hasComposioMetrics(direct.network)
      ? async (c, externalId) => {
          if (isUploadPost(c)) return {};
          if (isComposio(c)) return hasComposioMetrics(direct.network) ? composioNetwork(direct.network).metrics!(c, externalId) : {};
          return direct.metrics ? direct.metrics(c, externalId) : {};
        }
      : undefined,
    // Composio and Upload-Post accounts are removed there by lib/social/connections.ts (several Pages can share one sign-in).
    revoke: direct.revoke ? async (c) => (isComposio(c) || isUploadPost(c) ? undefined : direct.revoke!(c)) : undefined,
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
