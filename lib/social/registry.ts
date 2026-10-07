import { facebookProvider } from "./providers/facebook";
import { instagramProvider } from "./providers/instagram";
import { linkedinProvider } from "./providers/linkedin";
import { tiktokProvider } from "./providers/tiktok";
import { youtubeProvider } from "./providers/youtube";
import { NETWORKS, type Network, type SocialProvider } from "./types";

const PROVIDERS: Record<Network, SocialProvider> = {
  instagram: instagramProvider,
  facebook: facebookProvider,
  linkedin: linkedinProvider,
  tiktok: tiktokProvider,
  youtube: youtubeProvider,
};

export function isNetwork(value: string): value is Network {
  return (NETWORKS as readonly string[]).includes(value);
}

export function getProvider(network: Network): SocialProvider {
  return PROVIDERS[network];
}

export function allProviders(): SocialProvider[] {
  return NETWORKS.map((n) => PROVIDERS[n]);
}
