import { SocialError, type NetworkRules, type SocialProvider } from "../types";

// X (Twitter) has no BuPulse app of its own: accounts connect only through BuPulse-Socials (Composio) with BuPulse's
// X developer app (COMPOSIO_TWITTER_AUTH_CONFIG_ID, lib/social/composio/ways.ts), and lib/social/registry.ts sends
// their posts and numbers to lib/social/composio/networks.ts. So this provider is never "configured" and refuses the
// direct sign-in. X counts a link as 23 characters and some emoji as 2; BuPulse counts plain characters (close enough
// for captions, and X itself refuses a post that is too long).
const rules: NetworkRules = { network: "twitter", label: "X (Twitter)", maxText: 280, requiresMedia: false, maxImages: 4, formats: ["POST", "CAROUSEL"], videoOnly: false };

const ONLY_SOCIALS = () => new SocialError("X connects through BuPulse-Socials only", "invalid", "twitter");

export const twitterProvider: SocialProvider = {
  network: "twitter",
  rules,
  isConfigured: () => false,
  authorizeUrl() {
    throw ONLY_SOCIALS();
  },
  async finishOAuth() {
    throw ONLY_SOCIALS();
  },
  async publish() {
    throw ONLY_SOCIALS();
  },
};
