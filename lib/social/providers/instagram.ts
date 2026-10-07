import { SocialError, type NetworkRules, type SocialProvider } from "../types";

// Placeholder until the Instagram provider is built: not configured, so its Connect button stays hidden.
const rules: NetworkRules = { network: "instagram", label: "Instagram", maxText: 2200, maxHashtags: 30, requiresMedia: true, maxImages: 10, formats: ["POST", "CAROUSEL", "SCRIPT"], videoOnly: false };

export const instagramProvider: SocialProvider = {
  network: "instagram",
  rules,
  isConfigured: () => false,
  authorizeUrl: () => {
    throw new SocialError("Instagram is not set up yet", "invalid", "instagram");
  },
  finishOAuth: async () => {
    throw new SocialError("Instagram is not set up yet", "invalid", "instagram");
  },
  publish: async () => {
    throw new SocialError("Instagram is not set up yet", "invalid", "instagram");
  },
};
